import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPersistenceApi, type PersistedAnnotation, type PersistedBookmark, type PersistedDocument,
  type PersistedReaderSession,
} from '../persistence/persistenceApi';
import type { Tag, TagDashboard } from '../tags/tagModels';
import { emptyMetadata, paperDocumentKey, type LibrarySnapshot } from './libraryModels';
import { createLibraryPersistence, paperToPersistedDocument } from './libraryPersistence';
import { LibraryService } from './libraryService';
import type { LibraryStorage } from './libraryStorage';

const time = '2026-10-11T10:00:00.000Z';
const legacyDocument: PersistedDocument = {
  documentKey: 'path:/legacy.pdf', path: '/legacy.pdf', displayName: 'legacy.pdf',
  fileSize: 123, modifiedAt: time, pageCount: 5, lastPage: 2, progress: 0.4,
  missing: false, lastOpenedAt: time, tagIds: [1],
};
const bookmark = (key: string): PersistedBookmark => ({
  id: null, documentKey: key, page: 2, title: 'Private bookmark', note: 'Private note', createdAt: time, updatedAt: time,
});
const annotation = (key: string): PersistedAnnotation => ({
  id: null, documentKey: key, page: 3, type: 'note', color: '#fff', text: 'Private annotation',
  quote: 'Private quote', areas: [], tagIds: [], createdAt: time, updatedAt: time,
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function memoryStorage() {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const storage: LibraryStorage = {
    load: vi.fn(async () => ({ revision, data: structuredClone(data) })),
    commit: vi.fn(async (expected, next, writes) => {
      if (expected !== revision) throw new Error('LIBRARY_CONFLICT');
      for (const write of writes) {
        if (write.bytes) files.set(write.id, write.bytes.slice());
        else files.delete(write.id);
      }
      data = structuredClone(next);
      return ++revision;
    }),
    readFile: vi.fn(async (id) => files.get(id)!.slice()),
  };
  return { storage, snapshot: () => structuredClone(data) };
}

function fakeBase() {
  let tags: Tag[] = [1, 2, 3].map((id) => ({
    id, name: `Tag ${id}`, color: '#fff', documentCount: id === 1 ? 1 : 0,
    annotationCount: id === 1 ? 2 : 0, createdAt: time, updatedAt: time,
  }));
  let session: PersistedReaderSession | null = null;
  const base = {
    ...createPersistenceApi(async () => { throw new Error('Unexpected native call'); }),
    getDocument: vi.fn(async (key: string) => key === legacyDocument.documentKey ? legacyDocument : null),
    saveDocument: vi.fn(async (_document: PersistedDocument) => undefined),
    listRecentDocuments: vi.fn(async () => [legacyDocument]),
    removeRecentDocument: vi.fn(async (_key: string) => undefined),
    clearRecentDocuments: vi.fn(async () => undefined),
    saveReaderSession: vi.fn(async (value: PersistedReaderSession) => { session = structuredClone(value); }),
    loadReaderSession: vi.fn(async () => structuredClone(session)),
    saveBookmark: vi.fn(async (value: PersistedBookmark) => ({ ...value, id: value.id ?? 100 })),
    listBookmarks: vi.fn(async (_key: string) => [] as PersistedBookmark[]),
    listAllBookmarks: vi.fn(async () => []),
    loadBookmarkDashboard: vi.fn(async () => ({ totalBookmarks: 0, groups: [] })),
    deleteBookmark: vi.fn(async (_id: number) => undefined),
    saveAnnotation: vi.fn(async (value: PersistedAnnotation) => ({ ...value, id: value.id ?? 101 })),
    listAnnotations: vi.fn(async (_key: string) => [] as PersistedAnnotation[]),
    listAllAnnotations: vi.fn(async () => []),
    deleteAnnotation: vi.fn(async (_id: number) => undefined),
    setDocumentFavorite: vi.fn(async (_key: string, _favorite: boolean) => undefined),
    listFavoriteDocuments: vi.fn(async () => [legacyDocument]),
    listTags: vi.fn(async () => structuredClone(tags)),
    deleteTag: vi.fn(async (id: number) => { tags = tags.filter((tag) => tag.id !== id); }),
    mergeTags: vi.fn(async ({ sourceTagId, targetTagId }: { sourceTagId: number; targetTagId: number }) => {
      const source = tags.find((tag) => tag.id === sourceTagId)!;
      const target = tags.find((tag) => tag.id === targetTagId)!;
      target.documentCount += source.documentCount;
      target.annotationCount += source.annotationCount;
      tags = tags.filter((tag) => tag.id !== sourceTagId);
      return structuredClone(target);
    }),
    loadTagDashboard: vi.fn(async (): Promise<TagDashboard> => {
      const rows = tags.map((tag) => ({ ...tag, usageCount: tag.documentCount + tag.annotationCount,
        recentUsedAt: time, description: 'Native description' }));
      return {
        overview: { totalTags: tags.length, activeTags: 1, totalUsage: 3, orphanTags: tags.length - 1 },
        tags: rows,
        details: rows.map((tag) => ({
          tag, documents: tag.documentCount ? [{ ...legacyDocument, relationCount: 3 }] : [],
          activities: [{ id: 1, tagId: tag.id, tagName: tag.name, action: 'create', targetType: null,
            targetId: null, targetLabel: null, createdAt: time }],
          folderDistribution: tag.documentCount ? [{ folder: '/', count: 1, percent: 100, color: '#fff' }] : [],
        })),
        recommendations: [{ id: 'orphan-tags', title: 'Old orphan count', description: '', tagIds: [2, 3], severity: 'warning' }],
      };
    }),
    attachDocumentTag: vi.fn(async (_key: string, _tag: number) => undefined),
    detachDocumentTag: vi.fn(async (_key: string, _tag: number) => undefined),
    attachAnnotationTag: vi.fn(async (_id: number, _tag: number) => undefined),
    detachAnnotationTag: vi.fn(async (_id: number, _tag: number) => undefined),
  };
  return base;
}

async function fixture() {
  const backend = memoryStorage();
  const extract = async () => ({ metadata: emptyMetadata('Extracted title'),
    pages: [{ page: 1, text: 'Research content' }], pageCount: 10 });
  const library = new LibraryService(backend.storage, extract);
  const paper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nresearch'), 'research.pdf');
  const base = fakeBase();
  const api = createLibraryPersistence(base, library);
  const key = paperDocumentKey(paper.id);
  async function encrypt() {
    const folder = await library.createFolder('Private');
    await library.categorize([paper.id], [folder.id], 'move');
    return library.encryptFolder(folder.id, 'strong password');
  }
  return { backend, extract, library, paper, base, api, key, encrypt };
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('library reader persistence adapter', () => {
  it('shows zero progress for an unread import and page-based progress after its first read', async () => {
    const { paper } = await fixture();
    expect(paperToPersistedDocument(paper).progress).toBe(0);
    expect(paperToPersistedDocument({ ...paper, lastReadAt: time }).progress).toBe(0.1);
    expect(paperToPersistedDocument({ ...paper, lastReadAt: time, pageCount: 0 }).progress).toBe(0);
  });

  it('maps managed documents without exposing file paths or overwriting edited metadata', async () => {
    const { api, base, library, paper, key } = await fixture();
    await library.editMetadata(paper.id, { title: 'User title', year: '2026' });
    const document = paperToPersistedDocument(library.getPaper(paper.id)!);
    expect(document).toMatchObject({ documentKey: key, path: null, displayName: 'research.pdf', pageCount: 10, fileSize: paper.fileSize });
    await api.saveDocument({ ...document, displayName: 'Ignored title', pageCount: 99, lastPage: 7, lastOpenedAt: time });
    expect(library.getPaper(paper.id)).toMatchObject({
      lastPage: 7, lastReadAt: time, pageCount: 10, metadata: { title: 'User title', year: '2026' },
    });
    expect(base.saveDocument).not.toHaveBeenCalled();
    expect((await api.listRecentDocuments()).find((item) => item.documentKey === key)?.progress).toBe(0.7);
    await api.saveDocument(legacyDocument);
    expect(base.saveDocument).toHaveBeenCalledWith(legacyDocument);
  });

  it('looks up hidden managed documents without delegating paper keys to native storage', async () => {
    const { api, base, library, paper, key, encrypt } = await fixture();
    await api.removeRecentDocument(key);
    expect(await api.getDocument!(key)).toMatchObject({ documentKey: key, displayName: paper.fileName, path: null });
    expect(await api.getDocument!('paper:missing')).toBeNull();
    const vault = await encrypt();
    await library.lockVault(vault.id);
    expect(await api.getDocument!(key)).toBeNull();
    expect(base.getDocument).not.toHaveBeenCalled();
    expect(await api.getDocument!(legacyDocument.documentKey)).toEqual(legacyDocument);
    expect(base.getDocument).toHaveBeenCalledWith(legacyDocument.documentKey);
    expect(await createLibraryPersistence({ ...base, getDocument: undefined }, library).getDocument!('desktop:unknown')).toBeNull();
  });

  it('rejects a queued favorite change after a vault locks and unlocks', async () => {
    const { api, base, library, paper, key, encrypt } = await fixture();
    const vault = await encrypt();
    const entered = deferred();
    const release = deferred();
    base.clearRecentDocuments.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const clearing = api.clearRecentDocuments();
    await entered.promise;
    const changing = api.setDocumentFavorite(key, true);
    const rejected = expect(changing).rejects.toThrow('访问状态已变化');
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'strong password');
    release.resolve();
    await Promise.all([clearing, rejected]);
    expect(library.getPaper(paper.id)?.favorite).toBe(false);
  });

  it('does not return a managed document lookup that spans locking and unlocking', async () => {
    const { api, base, library, key, encrypt } = await fixture();
    const vault = await encrypt();
    const tags = await base.listTags();
    const lookup = deferred<Tag[]>();
    base.listTags.mockReturnValueOnce(lookup.promise);
    const reading = api.getDocument!(key);
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'strong password');
    lookup.resolve(tags);
    expect(await reading).toBeNull();
    expect(await api.getDocument!(key)).toMatchObject({ documentKey: key });
  });

  it('saves bookmarks, annotations and favorites inside the encrypted paper with globally negative IDs', async () => {
    const { api, base, library, paper, key, backend, encrypt } = await fixture();
    await encrypt();
    const savedBookmark = await api.saveBookmark(bookmark(key));
    const savedAnnotation = await api.saveAnnotation(annotation(key));
    await api.setDocumentFavorite(key, true);
    await api.attachAnnotationTag(savedAnnotation.id!, 1);
    await api.saveAnnotation({ ...savedAnnotation, text: 'Revised annotation', tagIds: undefined });
    expect(savedBookmark.id).toBe(-1);
    expect(savedAnnotation.id).toBe(-2);
    expect(await api.listAnnotations(key)).toMatchObject([{ text: 'Revised annotation', tagIds: [1] }]);
    expect(library.getPaper(paper.id)?.favorite).toBe(true);
    expect(base.saveBookmark).not.toHaveBeenCalled();
    expect(base.saveAnnotation).not.toHaveBeenCalled();
    expect(base.setDocumentFavorite).not.toHaveBeenCalled();
    expect(base.attachAnnotationTag).not.toHaveBeenCalled();
    const persisted = JSON.stringify(backend.snapshot());
    expect(persisted).not.toContain('Private bookmark');
    expect(persisted).not.toContain('Revised annotation');
    expect(persisted).not.toContain('Private quote');
    await expect(api.saveAnnotation({ ...savedAnnotation, documentKey: legacyDocument.documentKey })).rejects.toThrow('外部文档');
    await expect(api.saveBookmark({ ...savedBookmark, id: 55 })).rejects.toThrow('编号');
  });

  it.each(['bookmark', 'annotation'] as const)('does not return a saved %s after a lock request during its commit', async (kind) => {
    const { api, library, paper, key, backend, encrypt } = await fixture();
    const vault = await encrypt();
    const entered = deferred();
    const release = deferred();
    const commit = vi.mocked(backend.storage.commit).getMockImplementation()!;
    vi.mocked(backend.storage.commit).mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return commit(...args);
    });
    const returned = vi.fn();
    const saving = (kind === 'bookmark' ? api.saveBookmark(bookmark(key)) : api.saveAnnotation(annotation(key)))
      .then((record) => { returned(record); return record; });
    const rejected = expect(saving).rejects.toThrow('锁定');
    await entered.promise;
    const locking = library.lockVault(vault.id);
    release.resolve();
    await Promise.all([locking, rejected]);
    expect(returned).not.toHaveBeenCalled();
    expect(library.getPaper(paper.id)).toBeUndefined();
    await library.unlockVault(vault.id, 'strong password');
    const records = kind === 'bookmark' ? library.getPaper(paper.id)?.bookmarks : library.getPaper(paper.id)?.annotations;
    expect(records).toHaveLength(1);
    expect(JSON.stringify(backend.snapshot())).not.toContain(kind === 'bookmark' ? 'Private bookmark' : 'Private annotation');
  });

  it('rejects an annotation save that crosses lock and unlock during tag lookup before writing', async () => {
    const { api, base, library, key, paper, encrypt } = await fixture();
    const vault = await encrypt();
    const tags = await base.listTags();
    const entered = deferred();
    const lookup = deferred<Tag[]>();
    base.listTags.mockImplementationOnce(() => { entered.resolve(); return lookup.promise; });
    const saving = api.saveAnnotation(annotation(key));
    const rejected = expect(saving).rejects.toThrow('访问状态已变化');
    await entered.promise;
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'strong password');
    lookup.resolve(tags);
    await rejected;
    expect(library.getPaper(paper.id)?.annotations).toEqual([]);
  });

  it('omits managed data from a delayed aggregate request even after the paper is unlocked again', async () => {
    const { api, base, library, key, encrypt } = await fixture();
    await api.saveAnnotation(annotation(key));
    const vault = await encrypt();
    const legacy = deferred<[]>();
    base.listAllAnnotations.mockReturnValueOnce(legacy.promise);
    const reading = api.listAllAnnotations();
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'strong password');
    legacy.resolve([]);
    expect(await reading).toEqual([]);
    expect(await api.listAllAnnotations()).toHaveLength(1);
  });

  it('filters a lock request before the queued storage write lets the locked view finish publishing', async () => {
    const { api, base, library, paper, key, backend, encrypt } = await fixture();
    await api.saveAnnotation(annotation(key));
    const vault = await encrypt();
    const entered = deferred();
    const release = deferred();
    const commit = vi.mocked(backend.storage.commit).getMockImplementation()!;
    vi.mocked(backend.storage.commit).mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return commit(...args);
    });
    const writing = library.updatePaper(paper.id, { pinned: true });
    await entered.promise;
    const legacy = deferred<[]>();
    base.listAllAnnotations.mockReturnValueOnce(legacy.promise);
    const reading = api.listAllAnnotations();
    const locking = library.lockVault(vault.id);
    legacy.resolve([]);
    expect(await reading).toEqual([]);
    release.resolve();
    await Promise.all([writing, locking]);
  });

  it('hides locked papers from every dashboard and rejects managed keys without native fallback', async () => {
    const { api, base, library, paper, key, encrypt } = await fixture();
    const savedBookmark = await api.saveBookmark(bookmark(key));
    const savedAnnotation = await api.saveAnnotation({ ...annotation(key), tagIds: [2] });
    await api.attachDocumentTag(key, 2);
    await api.setDocumentFavorite(key, true);
    const vault = await encrypt();
    expect((await api.listAllAnnotations()).length).toBe(1);
    expect((await api.loadBookmarkDashboard()).totalBookmarks).toBe(1);
    await library.lockVault(vault.id);
    expect(await api.listRecentDocuments()).toEqual([legacyDocument]);
    expect(await api.listFavoriteDocuments()).toEqual([legacyDocument]);
    expect(await api.listAllAnnotations()).toEqual([]);
    expect(await api.listAllBookmarks()).toEqual([]);
    expect(await api.loadBookmarkDashboard()).toEqual({ totalBookmarks: 0, groups: [] });
    expect((await api.listTags()).find((tag) => tag.id === 2)?.documentCount).toBe(0);
    expect((await api.loadTagDashboard()).details.find((detail) => detail.tag.id === 2)?.documents).toEqual([]);
    await expect(api.listBookmarks(key)).rejects.toThrow('锁定');
    await expect(api.listAnnotations(key)).rejects.toThrow('锁定');
    await expect(api.saveDocument(paperToPersistedDocument(paper))).rejects.toThrow('锁定');
    await expect(api.setDocumentFavorite('paper:deleted', true)).rejects.toThrow('不存在');
    await expect(api.deleteBookmark(savedBookmark.id!)).rejects.toThrow('锁定');
    await expect(api.attachAnnotationTag(savedAnnotation.id!, 1)).rejects.toThrow('锁定');
    expect(base.saveDocument).not.toHaveBeenCalled();
    expect(base.setDocumentFavorite).not.toHaveBeenCalled();
    expect(base.deleteBookmark).not.toHaveBeenCalled();
    expect(base.attachAnnotationTag).not.toHaveBeenCalled();
  });

  it('checks visibility after asynchronous native reads complete', async () => {
    const { api, base, library, key, encrypt } = await fixture();
    await api.saveBookmark(bookmark(key));
    const vault = await encrypt();
    let finish: (value: PersistedDocument[]) => void = () => undefined;
    base.listRecentDocuments.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const reading = api.listRecentDocuments();
    await library.lockVault(vault.id);
    finish([legacyDocument]);
    expect(await reading).toEqual([legacyDocument]);
  });

  it('routes negative decoration IDs and tag relations without losing concurrent annotations', async () => {
    const { api, base, library, paper, key } = await fixture();
    const first = await api.saveAnnotation(annotation(key));
    const savedBookmark = await api.saveBookmark(bookmark(key));
    await Promise.all([
      api.attachAnnotationTag(first.id!, 1),
      api.saveAnnotation({ ...annotation(key), text: 'Second annotation' }),
      api.attachDocumentTag(key, 2),
      api.attachDocumentTag(key, 3),
    ]);
    expect(library.getPaper(paper.id)?.annotations).toHaveLength(2);
    expect(library.getPaper(paper.id)?.tagIds).toEqual([2, 3]);
    await api.detachAnnotationTag(first.id!, 1);
    await api.detachDocumentTag(key, 3);
    await api.deleteAnnotation(first.id!);
    await api.deleteBookmark(savedBookmark.id!);
    expect(library.getPaper(paper.id)?.annotations).toMatchObject([{ text: 'Second annotation' }]);
    expect(library.getPaper(paper.id)?.bookmarks).toEqual([]);
    expect(base.deleteAnnotation).not.toHaveBeenCalled();
    expect(base.deleteBookmark).not.toHaveBeenCalled();
    await api.deleteAnnotation(11);
    await api.attachAnnotationTag(12, 2);
    expect(base.deleteAnnotation).toHaveBeenCalledWith(11);
    expect(base.attachAnnotationTag).toHaveBeenCalledWith(12, 2);
    await expect(api.deleteAnnotation(-999)).rejects.toThrow('不存在');
    await expect(api.attachDocumentTag(key, 99)).rejects.toThrow('标签不存在');
  });

  it('persists recent hiding separately from favorites, annotations, and library deletion', async () => {
    const { api, base, library, paper, key, backend, extract } = await fixture();
    await api.setDocumentFavorite(key, true);
    await api.saveAnnotation(annotation(key));
    await api.removeRecentDocument(key);
    expect(await api.listRecentDocuments()).toEqual([legacyDocument]);
    expect((await api.listFavoriteDocuments()).map((item) => item.documentKey)).toContain(key);
    const reopened = new LibraryService(backend.storage, extract);
    await reopened.initialize();
    expect(reopened.getPaper(paper.id)).toMatchObject({ recentHidden: true, favorite: true });
    await api.saveDocument({ ...paperToPersistedDocument(paper), lastOpenedAt: time });
    expect((await api.listRecentDocuments()).map((item) => item.documentKey)).toContain(key);
    await api.clearRecentDocuments();
    expect(library.getPaper(paper.id)).toMatchObject({ recentHidden: true, favorite: true });
    expect(await api.listAnnotations(key)).toHaveLength(1);
    expect(base.clearRecentDocuments).toHaveBeenCalledOnce();
    expect(base.removeRecentDocument).not.toHaveBeenCalled();
  });

  it('splits sessions and restores managed pages from encrypted paper state without plaintext history', async () => {
    const { api, base, library, paper, key, backend, encrypt } = await fixture();
    const vault = await encrypt();
    const session: PersistedReaderSession = {
      activeDocumentKey: key, sidebarOpen: false,
      tabs: [
        { documentKey: legacyDocument.documentKey, tabOrder: 0, page: 2, zoom: 1, history: { currentPage: 2, backStack: [1], forwardStack: [] } },
        { documentKey: key, tabOrder: 1, page: 7, zoom: 1.5, history: { currentPage: 7, backStack: [2, 4], forwardStack: [9] } },
      ],
    };
    await api.saveReaderSession(session);
    expect(base.saveReaderSession).toHaveBeenCalledWith({ ...session, activeDocumentKey: null, tabs: [session.tabs[0]] });
    expect(library.getPaper(paper.id)).toMatchObject({ lastPage: 7, zoom: 1.5 });
    expect(backend.snapshot()?.readerSession).toEqual({ activePaperId: paper.id, openPaperIds: [paper.id] });
    expect(JSON.stringify(backend.snapshot()?.readerSession)).not.toContain('backStack');
    const restored = await api.loadReaderSession();
    expect(restored?.activeDocumentKey).toBe(key);
    expect(restored?.tabs[1]).toMatchObject({ documentKey: key, page: 7, zoom: 1.5,
      history: { currentPage: 7, backStack: [], forwardStack: [] } });
    await library.lockVault(vault.id);
    expect(await api.loadReaderSession()).toEqual({ ...session, activeDocumentKey: legacyDocument.documentKey, tabs: [session.tabs[0]] });
  });

  it('keeps a legacy active tab selected when managed papers are open in the background', async () => {
    const { api, key } = await fixture();
    const session: PersistedReaderSession = {
      activeDocumentKey: legacyDocument.documentKey, sidebarOpen: true,
      tabs: [
        { documentKey: key, tabOrder: 0, page: 4, zoom: 1.2, history: { currentPage: 4, backStack: [], forwardStack: [] } },
        { documentKey: legacyDocument.documentKey, tabOrder: 1, page: 2, zoom: 1, history: { currentPage: 2, backStack: [1], forwardStack: [] } },
      ],
    };
    await api.saveReaderSession(session);
    const restored = await api.loadReaderSession();
    expect(restored?.activeDocumentKey).toBe(legacyDocument.documentKey);
    expect(restored?.tabs.map((tab) => tab.documentKey)).toEqual([legacyDocument.documentKey, key]);
    expect(restored?.tabs[1]).toMatchObject({ page: 4, zoom: 1.2 });
  });

  it('adds managed tag usage once and preserves native document details and activities', async () => {
    const { api, key } = await fixture();
    await api.attachDocumentTag(key, 1);
    await api.saveAnnotation({ ...annotation(key), tagIds: [1, 2] });
    const tags = await api.listTags();
    expect(tags[0]).toMatchObject({ documentCount: 2, annotationCount: 3 });
    expect(tags[1]).toMatchObject({ documentCount: 0, annotationCount: 1 });
    const dashboard = await api.loadTagDashboard();
    expect(dashboard.overview).toEqual({ totalTags: 3, activeTags: 2, orphanTags: 1, totalUsage: 6 });
    expect(dashboard.tags[0]).toMatchObject({ documentCount: 2, annotationCount: 3, usageCount: 5 });
    expect(dashboard.details[0].documents).toMatchObject([
      { documentKey: legacyDocument.documentKey, relationCount: 3 }, { documentKey: key, relationCount: 2, path: null },
    ]);
    expect(dashboard.details[0].activities).toHaveLength(1);
    expect(dashboard.details[0].folderDistribution.map((item) => item.percent)).toEqual([50, 50]);
    expect(dashboard.recommendations.find((item) => item.id === 'orphan-tags')?.tagIds).toEqual([3]);
  });

  it('merges and deletes document and annotation tags while retaining annotation contents', async () => {
    const { api, library, paper, key } = await fixture();
    await api.attachDocumentTag(key, 1);
    await api.attachDocumentTag(key, 2);
    await api.saveAnnotation({ ...annotation(key), tagIds: [1, 2, 3] });
    const merged = await api.mergeTags({ sourceTagId: 1, targetTagId: 2 });
    expect(merged).toMatchObject({ id: 2, documentCount: 2, annotationCount: 3 });
    expect(library.getPaper(paper.id)?.tagIds).toEqual([2]);
    expect(library.getPaper(paper.id)?.annotations[0]).toMatchObject({ text: 'Private annotation', tagIds: [2, 3] });
    await api.deleteTag(2);
    expect(library.getPaper(paper.id)?.tagIds).toEqual([]);
    expect(library.getPaper(paper.id)?.annotations[0]).toMatchObject({ text: 'Private annotation', tagIds: [3] });
  });

  it('rolls back only affected relations when the native tag write fails, preserving newer annotation edits', async () => {
    const { api, base, library, paper, key } = await fixture();
    await api.attachDocumentTag(key, 1);
    await api.saveAnnotation({ ...annotation(key), tagIds: [1, 3] });
    base.mergeTags.mockImplementationOnce(async () => {
      await library.updatePaper(paper.id, (current) => ({ annotations: current.annotations.map((item) => ({ ...item, text: 'Concurrent edit' })) }));
      throw new Error('native disk full');
    });
    await expect(api.mergeTags({ sourceTagId: 1, targetTagId: 2 })).rejects.toThrow('native disk full');
    expect(library.getPaper(paper.id)?.tagIds).toEqual([1]);
    expect(library.getPaper(paper.id)?.annotations[0]).toMatchObject({ text: 'Concurrent edit', tagIds: [3, 1] });
    expect((await api.listTags()).map((tag) => tag.id)).toEqual([1, 2, 3]);
  });

  it('allocates IDs across papers and refuses to move an existing decoration to another paper', async () => {
    const { api, library, key, base } = await fixture();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond paper'), 'second.pdf');
    const secondKey = paperDocumentKey(second.id);
    const first = await api.saveAnnotation(annotation(key));
    const next = await api.saveBookmark(bookmark(secondKey));
    expect([first.id, next.id]).toEqual([-1, -2]);
    await expect(api.saveAnnotation({ ...first, documentKey: secondKey })).rejects.toThrow('编号');
    expect(await api.listAnnotations(secondKey)).toEqual([]);
    const returned = await api.listAnnotations(key);
    returned[0].text = 'Mutated caller copy';
    expect((await api.listAnnotations(key))[0].text).toBe('Private annotation');
    await api.saveBookmark(bookmark(legacyDocument.documentKey));
    await api.saveAnnotation(annotation(legacyDocument.documentKey));
    expect(base.saveBookmark).toHaveBeenCalledOnce();
    expect(base.saveAnnotation).toHaveBeenCalledOnce();
  });

  it('restores earlier papers when a library write fails before a tag merge reaches native storage', async () => {
    const { api, library, key, paper, base, backend } = await fixture();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond paper'), 'second.pdf');
    await api.attachDocumentTag(key, 1);
    await api.saveAnnotation({ ...annotation(paperDocumentKey(second.id)), tagIds: [1] });
    const originalCommit = vi.mocked(backend.storage.commit).getMockImplementation()!;
    let commits = 0;
    vi.mocked(backend.storage.commit).mockImplementation(async (...args) => {
      commits += 1;
      if (commits === 2) throw new Error('library disk full');
      return originalCommit(...args);
    });
    await expect(api.mergeTags({ sourceTagId: 1, targetTagId: 2 })).rejects.toThrow('library disk full');
    expect(base.mergeTags).not.toHaveBeenCalled();
    expect(library.getPaper(paper.id)?.tagIds).toEqual([1]);
    expect(library.getPaper(second.id)?.annotations[0]).toMatchObject({ tagIds: [1], text: 'Private annotation' });
  });

  it.each(['merge', 'delete'] as const)('restores encrypted tag relations before completing a requested lock when native %s fails', async (kind) => {
    const { api, base, library, paper, key, encrypt } = await fixture();
    await api.attachDocumentTag(key, 1);
    await api.saveAnnotation({ ...annotation(key), tagIds: [1] });
    const vault = await encrypt();
    const entered = deferred();
    const native = deferred<never>();
    if (kind === 'merge') base.mergeTags.mockImplementationOnce(() => { entered.resolve(); return native.promise; });
    else base.deleteTag.mockImplementationOnce(() => { entered.resolve(); return native.promise; });
    const saving = kind === 'merge' ? api.mergeTags({ sourceTagId: 1, targetTagId: 2 }) : api.deleteTag(1);
    const rejected = expect(saving).rejects.toThrow('native disk full');
    await entered.promise;
    const locking = library.lockVault(vault.id);
    native.reject(new Error('native disk full'));
    await Promise.all([rejected, locking]);
    expect(library.getPaper(paper.id)).toBeUndefined();
    await library.unlockVault(vault.id, 'strong password');
    expect(library.getPaper(paper.id)?.tagIds).toEqual([1]);
    expect(library.getPaper(paper.id)?.annotations[0]).toMatchObject({ tagIds: [1], text: 'Private annotation' });
  });

  it('blocks tag deletion and merging while any paper is locked and filters obsolete references on unlock', async () => {
    const { api, base, library, paper, key, encrypt } = await fixture();
    await api.attachDocumentTag(key, 1);
    await api.saveAnnotation({ ...annotation(key), tagIds: [1] });
    const vault = await encrypt();
    await library.lockVault(vault.id);
    await expect(api.deleteTag(1)).rejects.toThrow('解锁所有');
    await expect(api.mergeTags({ sourceTagId: 1, targetTagId: 2 })).rejects.toThrow('解锁所有');
    expect(base.deleteTag).not.toHaveBeenCalled();
    expect(base.mergeTags).not.toHaveBeenCalled();
    await base.deleteTag(1);
    await library.unlockVault(vault.id, 'strong password');
    expect(library.getPaper(paper.id)?.tagIds).toEqual([1]);
    expect((await api.listRecentDocuments()).find((item) => item.documentKey === key)?.tagIds).toEqual([]);
    expect((await api.listAnnotations(key))[0].tagIds).toEqual([]);
  });
});
