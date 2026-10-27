import type {
  BookmarkDashboard, PersistedAnnotation, PersistedBookmark, PersistedDocument,
  PersistenceApi, PersistedReaderSession,
} from '../persistence/persistenceApi';
import type { Tag, TagDashboard, TagDashboardTagRow } from '../tags/tagModels';
import { paperDocumentKey, paperIdFromDocumentKey, type Paper } from './libraryModels';
import type { LibraryService } from './libraryService';

export function paperToPersistedDocument(paper: Paper): PersistedDocument {
  return {
    documentKey: paperDocumentKey(paper.id), path: null,
    displayName: paper.fileName || paper.metadata.title,
    fileSize: paper.fileSize, modifiedAt: paper.updatedAt, pageCount: paper.pageCount || null,
    lastPage: paper.lastPage, progress: paper.lastReadAt && paper.pageCount ? Math.min(1, paper.lastPage / paper.pageCount) : 0,
    missing: false, lastOpenedAt: paper.lastReadAt, tagIds: [...paper.tagIds],
  };
}

/** Keeps library reader data inside its encrypted storage boundary. */
export function createLibraryPersistence(base: PersistenceApi, library: LibraryService): PersistenceApi {
  let writes: Promise<unknown> = Promise.resolve();
  const pendingWrites = new Set<Promise<unknown>>();
  function track<T>(operation: Promise<T>): Promise<T> {
    pendingWrites.add(operation);
    void operation.then(() => pendingWrites.delete(operation), () => pendingWrites.delete(operation));
    return operation;
  }
  function write<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(async () => { await library.initialize(); return operation(); });
    writes = result.catch(() => undefined);
    return track(result);
  }
  function requirePaper(key: string): Paper {
    const id = paperIdFromDocumentKey(key);
    const paper = id === null ? undefined : library.getPaper(id);
    if (!paper) throw new Error('文献已锁定或不存在，请解锁后重试。');
    return paper;
  }
  function requireAccess(id: string, access: number): void {
    if (!library.canAccess(id, access)) throw new Error('文献已锁定或访问状态已变化，请解锁后重新打开。');
  }
  function visiblePapers(access: number): Paper[] {
    return library.getView().papers.filter((paper) => library.canAccess(paper.id, access));
  }
  function findDecoration(id: number, kind: 'annotations' | 'bookmarks'): Paper {
    const paper = library.getView().papers.find((item) => item[kind].some((record) => record.id === id));
    if (!paper) throw new Error('批注或书签已锁定或不存在，请解锁后重试。');
    return paper;
  }
  async function validTagIds(): Promise<Set<number>> {
    return new Set((await base.listTags()).map((tag) => tag.id));
  }
  async function requireTag(id: number): Promise<void> {
    if (!(await validTagIds()).has(id)) throw new Error('标签不存在或已删除。');
  }
  function document(paper: Paper, tags: Set<number>): PersistedDocument {
    return { ...paperToPersistedDocument(paper), tagIds: filterTags(paper.tagIds, tags) };
  }
  function annotation(record: PersistedAnnotation, tags: Set<number>): PersistedAnnotation {
    return { ...structuredClone(record), tagIds: filterTags(record.tagIds ?? [], tags) };
  }
  async function rewriteTags<T>(sourceId: number, targetId: number | undefined, finish: () => Promise<T>): Promise<T> {
    return library.withStableAccess(async () => {
      if (library.getView().lockedPaperIds.length) {
        throw new Error('请先解锁所有加密文件夹，再删除或合并标签，以保留文献和批注关联。');
      }
      const originals = library.getView().papers.filter((paper) => paper.tagIds.includes(sourceId)
        || paper.annotations.some((item) => item.tagIds?.includes(sourceId)));
      const changed: Paper[] = [];
      const rewrite = (ids: number[]) => [...new Set(ids.flatMap((id) =>
        id !== sourceId ? [id] : targetId === undefined ? [] : [targetId],
      ))];
      try {
        for (const paper of originals) {
          await library.updatePaper(paper.id, (current) => ({
            tagIds: rewrite(current.tagIds),
            annotations: current.annotations.map((item) => ({ ...item, tagIds: rewrite(item.tagIds ?? []) })),
          }));
          changed.push(paper);
        }
        return await finish();
      } catch (error) {
        let rollbackFailed = false;
        const restore = (current: number[], before: number[]) => [...new Set([
          ...current.filter((id) => id !== sourceId && id !== targetId),
          ...before.filter((id) => id === sourceId || id === targetId),
        ])];
        for (const original of changed.reverse()) {
          try {
            await library.updatePaper(original.id, (current) => ({
              tagIds: restore(current.tagIds, original.tagIds),
              annotations: current.annotations.map((item) => {
                const previous = original.annotations.find((before) => before.id === item.id);
                return previous ? { ...item, tagIds: restore(item.tagIds ?? [], previous.tagIds ?? []) } : item;
              }),
            }));
          } catch { rollbackFailed = true; }
        }
        if (rollbackFailed) throw new Error('标签操作失败，部分文献关联未能恢复；请解锁文件夹并检查标签关联。', { cause: error });
        throw error;
      }
    });
  }
  async function changeDocumentTag(key: string, tagId: number, attach: boolean): Promise<void> {
    if (!managed(key)) return track(attach ? base.attachDocumentTag(key, tagId) : base.detachDocumentTag(key, tagId));
    return write(async () => {
      if (attach) await requireTag(tagId);
      const paper = requirePaper(key);
      await library.updatePaper(paper.id, (current) => ({
        tagIds: attach ? [...new Set([...current.tagIds, tagId])] : current.tagIds.filter((id) => id !== tagId),
      }));
    });
  }
  async function changeAnnotationTag(id: number, tagId: number, attach: boolean): Promise<void> {
    if (id >= 0) return track(attach ? base.attachAnnotationTag(id, tagId) : base.detachAnnotationTag(id, tagId));
    return write(async () => {
      if (attach) await requireTag(tagId);
      const paper = findDecoration(id, 'annotations');
      await library.updatePaper(paper.id, (current) => ({
        annotations: current.annotations.map((record) => record.id === id ? {
          ...record, tagIds: attach ? [...new Set([...(record.tagIds ?? []), tagId])]
            : (record.tagIds ?? []).filter((item) => item !== tagId),
        } : record),
      }));
    });
  }

  return {
    ...base,
    async flushPendingWrites() {
      await Promise.all([...pendingWrites]);
      await library.waitForPendingWrites();
    },
    async getDocument(key) {
      if (!managed(key)) return base.getDocument?.(key) ?? null;
      const access = library.captureAccess();
      const [tags] = await Promise.all([validTagIds(), library.initialize()]);
      const paper = library.getPaper(paperIdFromDocumentKey(key)!);
      return paper && library.canAccess(paper.id, access) ? document(paper, tags) : null;
    },
    saveDocument(record) {
      if (!managed(record.documentKey)) return base.saveDocument(record);
      return write(async () => {
        const paper = requirePaper(record.documentKey);
        await library.updatePaper(paper.id, {
          lastPage: boundedPage(record.lastPage, paper.pageCount),
          lastReadAt: record.lastOpenedAt ?? paper.lastReadAt, recentHidden: false,
        });
      });
    },
    async listRecentDocuments() {
      const access = library.captureAccess();
      const [legacy, tags] = await Promise.all([base.listRecentDocuments(), validTagIds(), library.initialize()]);
      return [...legacy.filter((item) => !managed(item.documentKey)), ...visiblePapers(access)
        .filter((paper) => !paper.recentHidden).map((paper) => document(paper, tags))]
        .sort((left, right) => (right.lastOpenedAt ?? right.modifiedAt ?? '').localeCompare(left.lastOpenedAt ?? left.modifiedAt ?? ''));
    },
    removeRecentDocument(key) {
      if (!managed(key)) return base.removeRecentDocument(key);
      return write(async () => { await library.updatePaper(requirePaper(key).id, { recentHidden: true }); });
    },
    clearRecentDocuments() {
      return write(async () => {
        for (const id of library.getView().papers.filter((paper) => !paper.recentHidden).map((paper) => paper.id)) {
          await library.updatePaper(id, { recentHidden: true });
        }
        await base.clearRecentDocuments();
      });
    },
    saveReaderSession(session) {
      return write(async () => {
        const libraryTabs = session.tabs.filter((tab) => managed(tab.documentKey));
        for (const tab of libraryTabs) {
          const paper = requirePaper(tab.documentKey);
          await library.updatePaper(paper.id, {
            lastPage: boundedPage(tab.page, paper.pageCount), zoom: Number.isFinite(tab.zoom) && tab.zoom > 0 ? tab.zoom : paper.zoom,
          });
        }
        const openPaperIds = [...new Set(libraryTabs.map((tab) => requirePaper(tab.documentKey).id))];
        const activeId = session.activeDocumentKey && managed(session.activeDocumentKey)
          ? requirePaper(session.activeDocumentKey).id : null;
        await library.saveReaderSession({ activePaperId: activeId && openPaperIds.includes(activeId) ? activeId : null, openPaperIds });
        const tabs = session.tabs.filter((tab) => !managed(tab.documentKey)).map((tab, tabOrder) => ({ ...tab, tabOrder }));
        await base.saveReaderSession({
          ...session, tabs,
          activeDocumentKey: session.activeDocumentKey && !managed(session.activeDocumentKey) ? session.activeDocumentKey : null,
        });
      });
    },
    async loadReaderSession() {
      const access = library.captureAccess();
      const [legacy] = await Promise.all([base.loadReaderSession(), library.initialize()]);
      const session = library.getView().snapshot.readerSession;
      const tabs = (legacy?.tabs ?? []).filter((tab) => !managed(tab.documentKey));
      for (const id of new Set(session?.openPaperIds ?? [])) {
        const paper = library.getPaper(id);
        if (!paper || !library.canAccess(id, access)) continue;
        tabs.push({
          documentKey: paperDocumentKey(id), tabOrder: tabs.length, page: paper.lastPage, zoom: paper.zoom,
          history: { currentPage: paper.lastPage, backStack: [], forwardStack: [] },
        });
      }
      if (!legacy && !tabs.length) return null;
      const managedActive = session?.activePaperId ? paperDocumentKey(session.activePaperId) : null;
      const activeDocumentKey = tabs.some((tab) => tab.documentKey === managedActive) ? managedActive
        : tabs.some((tab) => tab.documentKey === legacy?.activeDocumentKey) ? legacy!.activeDocumentKey : tabs[0]?.documentKey ?? null;
      return {
        activeDocumentKey, sidebarOpen: legacy?.sidebarOpen ?? true,
        tabs: tabs.map((tab, tabOrder) => ({ ...tab, tabOrder })),
      } satisfies PersistedReaderSession;
    },
    async saveBookmark(record) {
      if (!managed(record.documentKey)) {
        if (record.id !== null && record.id < 0) return Promise.reject(new Error('库内书签不能保存到外部文档。'));
        return track(base.saveBookmark(record));
      }
      const access = library.captureAccess();
      const saved = await write(async () => {
        const paper = requirePaper(record.documentKey);
        requireAccess(paper.id, access);
        verifyDecorationId(record.id, paper.bookmarks);
        return library.saveBookmark(paper.id, record);
      });
      requireAccess(paperIdFromDocumentKey(record.documentKey)!, access);
      return saved;
    },
    async listBookmarks(key) {
      if (!managed(key)) return base.listBookmarks(key);
      const access = library.captureAccess();
      await library.initialize();
      const paper = requirePaper(key);
      requireAccess(paper.id, access);
      return structuredClone(paper.bookmarks);
    },
    async listAllBookmarks() {
      const access = library.captureAccess();
      const [legacy] = await Promise.all([base.listAllBookmarks(), library.initialize()]);
      return [...legacy.filter((item) => !managed(item.documentKey)), ...visiblePapers(access).flatMap((paper) =>
        paper.bookmarks.map((item) => ({ ...structuredClone(item), ...recordDocument(paper) })),
      )];
    },
    async loadBookmarkDashboard() {
      const access = library.captureAccess();
      const [legacy] = await Promise.all([base.loadBookmarkDashboard(), library.initialize()]);
      const groups = [...legacy.groups.filter((group) => !managed(group.document.documentKey)),
        ...visiblePapers(access).filter((paper) => paper.bookmarks.length > 0).map((paper) => ({
          document: paperToPersistedDocument(paper), bookmarkCount: paper.bookmarks.length,
          bookmarks: structuredClone(paper.bookmarks),
        })),
      ];
      return { totalBookmarks: groups.reduce((total, group) => total + group.bookmarkCount, 0), groups } satisfies BookmarkDashboard;
    },
    deleteBookmark(id) {
      if (id >= 0) return track(base.deleteBookmark(id));
      return write(async () => {
        const paper = findDecoration(id, 'bookmarks');
        await library.updatePaper(paper.id, (current) => ({ bookmarks: current.bookmarks.filter((item) => item.id !== id) }));
      });
    },
    async saveAnnotation(record) {
      if (!managed(record.documentKey)) {
        if (record.id !== null && record.id < 0) return Promise.reject(new Error('库内批注不能保存到外部文档。'));
        return track(base.saveAnnotation(record));
      }
      const access = library.captureAccess();
      const saved = await write(async () => {
        const tags = await validTagIds();
        const paper = requirePaper(record.documentKey);
        requireAccess(paper.id, access);
        verifyDecorationId(record.id, paper.annotations);
        const previous = paper.annotations.find((item) => item.id === record.id);
        return library.saveAnnotation(paper.id, annotation({ ...record, tagIds: record.tagIds ?? previous?.tagIds ?? [] }, tags));
      });
      requireAccess(paperIdFromDocumentKey(record.documentKey)!, access);
      return saved;
    },
    async listAnnotations(key) {
      if (!managed(key)) return base.listAnnotations(key);
      const access = library.captureAccess();
      const [tags] = await Promise.all([validTagIds(), library.initialize()]);
      const paper = requirePaper(key);
      requireAccess(paper.id, access);
      return paper.annotations.map((item) => annotation(item, tags));
    },
    async listAllAnnotations() {
      const access = library.captureAccess();
      const [legacy, tags] = await Promise.all([base.listAllAnnotations(), validTagIds(), library.initialize()]);
      return [...legacy.filter((item) => !managed(item.documentKey)), ...visiblePapers(access).flatMap((paper) =>
        paper.annotations.map((item) => ({ ...annotation(item, tags), ...recordDocument(paper) })),
      )];
    },
    deleteAnnotation(id) {
      if (id >= 0) return track(base.deleteAnnotation(id));
      return write(async () => {
        const paper = findDecoration(id, 'annotations');
        await library.updatePaper(paper.id, (current) => ({ annotations: current.annotations.filter((item) => item.id !== id) }));
      });
    },
    setDocumentFavorite(key, favorite) {
      if (!managed(key)) return base.setDocumentFavorite(key, favorite);
      return write(async () => { await library.updatePaper(requirePaper(key).id, { favorite }); });
    },
    async listFavoriteDocuments() {
      const access = library.captureAccess();
      const [legacy, tags] = await Promise.all([base.listFavoriteDocuments(), validTagIds(), library.initialize()]);
      return [...legacy.filter((item) => !managed(item.documentKey)), ...visiblePapers(access)
        .filter((paper) => paper.favorite).map((paper) => document(paper, tags))];
    },
    async listTags() {
      const access = library.captureAccess();
      const [tags] = await Promise.all([base.listTags(), library.initialize()]);
      return tags.map((tag) => ({ ...tag, ...countTagUsage(tag, visiblePapers(access)) }));
    },
    createTag(input) { return track(base.createTag(input)); },
    renameTag(id, name) { return track(base.renameTag(id, name)); },
    deleteTag(id) {
      return write(() => rewriteTags(id, undefined, () => base.deleteTag(id)));
    },
    async mergeTags(input) {
      const access = library.captureAccess();
      const tag = await write(async () => {
        if (input.sourceTagId === input.targetTagId) throw new Error('不能合并同一个标签。');
        await requireTag(input.sourceTagId);
        await requireTag(input.targetTagId);
        return rewriteTags(input.sourceTagId, input.targetTagId, () => base.mergeTags(input));
      });
      return { ...tag, ...countTagUsage(tag, visiblePapers(access)) };
    },
    async loadTagDashboard() {
      const access = library.captureAccess();
      const [dashboard, tags] = await Promise.all([base.loadTagDashboard(), base.listTags(), library.initialize()]);
      return mergeTagDashboard(dashboard, tags, visiblePapers(access));
    },
    attachDocumentTag: (key, id) => changeDocumentTag(key, id, true),
    detachDocumentTag: (key, id) => changeDocumentTag(key, id, false),
    attachAnnotationTag: (id, tagId) => changeAnnotationTag(id, tagId, true),
    detachAnnotationTag: (id, tagId) => changeAnnotationTag(id, tagId, false),
  };
}

function managed(key: string): boolean { return paperIdFromDocumentKey(key) !== null; }
function filterTags(ids: number[], valid: Set<number>): number[] { return [...new Set(ids.filter((id) => valid.has(id)))]; }
function boundedPage(page: number, count: number): number {
  return Number.isFinite(page) ? Math.max(1, Math.min(Math.floor(page), count || page)) : 1;
}
function recordDocument(paper: Paper) {
  return { documentDisplayName: paper.fileName || paper.metadata.title, documentPath: null, documentMissing: false };
}
function verifyDecorationId(id: number | null, records: Array<PersistedAnnotation | PersistedBookmark>): void {
  if (id !== null && (id >= 0 || !records.some((item) => item.id === id))) {
    throw new Error('库内批注或书签编号无效，请重新打开文献后重试。');
  }
}
function countTagUsage(tag: Tag, papers: Paper[]) {
  return {
    documentCount: tag.documentCount + papers.filter((paper) => paper.tagIds.includes(tag.id)).length,
    annotationCount: tag.annotationCount + papers.reduce((count, paper) =>
      count + paper.annotations.filter((item) => item.tagIds?.includes(tag.id)).length, 0),
  };
}

function mergeTagDashboard(base: TagDashboard, nativeTags: Tag[], papers: Paper[]): TagDashboard {
  const tags: TagDashboardTagRow[] = nativeTags.map((native) => {
    const row = base.tags.find((tag) => tag.id === native.id);
    const counts = countTagUsage(native, papers);
    const recent = papers.filter((paper) => paper.tagIds.includes(native.id)
      || paper.annotations.some((item) => item.tagIds?.includes(native.id))).map((paper) => paper.updatedAt);
    return {
      ...native, ...row, ...counts, usageCount: counts.documentCount + counts.annotationCount,
      recentUsedAt: [row?.recentUsedAt ?? '', ...recent].sort().at(-1) || null,
      description: row?.description ?? `${native.name} 相关文献与批注`,
    };
  });
  const details = tags.map((tag) => {
    const existing = base.details.find((detail) => detail.tag.id === tag.id);
    const managedDocuments = papers.flatMap((paper) => {
      const relationCount = Number(paper.tagIds.includes(tag.id))
        + paper.annotations.filter((item) => item.tagIds?.includes(tag.id)).length;
      return relationCount ? [{ ...paperToPersistedDocument(paper), relationCount }] : [];
    });
    const documents = [...(existing?.documents ?? []).filter((item) => !managed(item.documentKey)), ...managedDocuments];
    const folders = [...(existing?.folderDistribution ?? []), ...(managedDocuments.length
      ? [{ folder: '本地文献库', count: managedDocuments.length, percent: 0, color: tag.color }] : [])];
    const total = folders.reduce((count, folder) => count + folder.count, 0);
    return {
      tag, documents, activities: existing?.activities ?? [],
      folderDistribution: folders.map((folder) => ({ ...folder, percent: total ? Math.round(folder.count * 100 / total) : 0 })),
    };
  });
  const orphans = tags.filter((tag) => tag.usageCount === 0).map((tag) => tag.id);
  const lowUsage = tags.filter((tag) => tag.usageCount > 0 && tag.usageCount <= 2).map((tag) => tag.id);
  return {
    tags, details,
    overview: {
      totalTags: tags.length, activeTags: tags.length - orphans.length, orphanTags: orphans.length,
      totalUsage: tags.reduce((count, tag) => count + tag.usageCount, 0),
    },
    recommendations: [
      ...base.recommendations.filter((item) => !['orphan-tags', 'low-usage-tags'].includes(item.id)),
      ...(orphans.length ? [{ id: 'orphan-tags', title: `发现 ${orphans.length} 个孤立标签`,
        description: '这些标签尚未关联文档或批注，可考虑删除或合并。', tagIds: orphans, severity: 'warning' as const }] : []),
      ...(lowUsage.length ? [{ id: 'low-usage-tags', title: `发现 ${lowUsage.length} 个低频标签`,
        description: '低频标签可能适合与相近主题合并。', tagIds: lowUsage, severity: 'info' as const }] : []),
    ],
  };
}
