import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { PersistenceApi } from '../persistence/persistenceApi';
import { isTauriRuntimeAvailable } from '../platform/tauriRuntime';
import fontUrl from './assets/NotoSansSC-Regular.ttf?url';
import { emptyMetadata, paperDocumentKey, paperIdFromDocumentKey } from './libraryModels';
import type { LibraryService } from './libraryService';
import type { NotesPdfDocument } from './notesPdf';

export type NotesExportSource = { documentKey: string; displayName: string; detail?: string | null };

type NotesExportFile = {
  write(bytes: Uint8Array): Promise<void>;
  flush(): Promise<void>;
  finish(): Promise<void>;
  release(): Promise<void>;
  abort(): Promise<void>;
};

type NotesExportIo = {
  choosePath(defaultPath: string): Promise<string | null>;
  createPdf(papers: NotesPdfDocument[], signal: AbortSignal): Promise<Uint8Array>;
  openPdf(path: string): Promise<NotesExportFile>;
};

const desktopIo: NotesExportIo = {
  async choosePath(defaultPath) {
    if (!isTauriRuntimeAvailable()) throw new Error('导出 PDF 需要在桌面应用中使用。');
    return save({ defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  },
  async createPdf(papers, signal) {
    const [response, { createNotesPdf }] = await Promise.all([fetch(fontUrl, { signal }), import('./notesPdf')]);
    if (!response.ok) throw new Error('导出字体加载失败，请重试。');
    return createNotesPdf(papers, new Uint8Array(await response.arrayBuffer()), signal);
  },
  async openPdf(path) {
    const id = await invoke<number>('begin_notes_export', { path });
    return {
      write: (bytes) => invoke<void>('write_notes_export', bytes, { headers: { 'x-smartreader-export': String(id) } }),
      flush: () => invoke<void>('flush_notes_export', { id }),
      finish: () => invoke<void>('finish_notes_export', { id }),
      release: () => invoke<void>('release_notes_export', { id }),
      abort: () => invoke<void>('abort_notes_export', { id }),
    };
  },
};

function suggestedFileName(names: string[]): string {
  if (names.length !== 1) return '文献笔记.pdf';
  const raw = names[0].replace(/\.pdf$/i, '');
  const cleaned = [...raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().replace(/[. ]+$/g, '')].slice(0, 80).join('');
  const name = !cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? '文献' : cleaned;
  return `${name}-笔记.pdf`;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class NotesExportCleanupError extends Error {
  constructor(path: string, failure: unknown) {
    super(`导出未完成，清理新文件失败（${path}）：${asError(failure).message}`, { cause: failure });
    this.name = 'NotesExportCleanupError';
  }
}

/** Export library papers and legacy path-based documents in one report. */
export async function exportDocumentNotesPdf(
  library: LibraryService,
  persistence: PersistenceApi | null,
  documents: NotesExportSource[],
  io: NotesExportIo = desktopIo,
): Promise<boolean> {
  const sources = [...new Map(documents.map((source) => [source.documentKey, source])).values()];
  if (!sources.length) throw new Error('请先选择要导出的文献。');
  const access = library.captureAccess();
  const ids = new Set(sources.map((source) => paperIdFromDocumentKey(source.documentKey)).filter((id): id is string => id !== null));
  const controller = new AbortController();
  const denied = () => new Error('文献已锁定、删除或访问状态已变化，请重新选择后导出。');
  const dispose = library.onLocked((lockedIds) => {
    if (lockedIds.some((id) => ids.has(id))) controller.abort(denied());
  });
  const requireAccess = () => {
    if (controller.signal.aborted) throw asError(controller.signal.reason);
    for (const id of ids) if (!library.canAccess(id, access)) throw denied();
  };
  const requirePaper = (id: string) => {
    requireAccess();
    const paper = library.getPaper(id);
    if (!paper) throw denied();
    return paper;
  };
  try {
    const names = sources.map((source) => {
      const id = paperIdFromDocumentKey(source.documentKey);
      if (id === null) return source.displayName;
      const paper = requirePaper(id);
      return paper.metadata.title || paper.fileName;
    });
    const path = await io.choosePath(suggestedFileName(names));
    if (!path) return false;
    requireAccess();
    await persistence?.flushPendingWrites?.();
    await library.waitForPendingWrites();
    requireAccess();
    const papers = await Promise.all(sources.map(async (source): Promise<NotesPdfDocument> => {
      const id = paperIdFromDocumentKey(source.documentKey);
      if (id !== null) {
        const paper = requirePaper(id);
        return structuredClone({ fileName: paper.fileName, metadata: paper.metadata, annotations: paper.annotations, bookmarks: paper.bookmarks });
      }
      if (!persistence) throw new Error('无法读取旧文档笔记，请重试。');
      const [annotations, bookmarks] = await Promise.all([
        persistence.listAnnotations(source.documentKey), persistence.listBookmarks(source.documentKey),
      ]);
      return { fileName: source.displayName, metadata: emptyMetadata(source.displayName), annotations, bookmarks };
    }));
    requireAccess();
    if (papers.some((paper) => paper.annotations.some((annotation) => annotation.tagIds?.length)) && persistence) {
      const tags = await persistence.listTags();
      const tagNames = Object.fromEntries(tags.map((tag) => [tag.id, tag.name]));
      for (const paper of papers) paper.tagNames = tagNames;
    }
    requireAccess();
    const bytes = await io.createPdf(papers, controller.signal);
    requireAccess();
    const write = async () => {
      let file: NotesExportFile | undefined;
      try {
        requireAccess();
        file = await io.openPdf(path);
        requireAccess();
        for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
          await file.write(bytes.slice(offset, offset + 1024 * 1024));
          requireAccess();
        }
        await file.flush();
        requireAccess();
        await file.finish();
        requireAccess();
        // Releasing the already-flushed file is the export's commit point.
        await file.release();
        file = undefined;
        return true;
      } catch (failure) {
        if (file) {
          try { await file.abort(); }
          catch (cleanup) { throw new NotesExportCleanupError(path, cleanup); }
        }
        throw asError(failure);
      }
    };
    return ids.size ? await library.withStableAccess(write, [...ids]) : await write();
  } catch (failure) {
    if (failure instanceof NotesExportCleanupError) throw failure;
    if (controller.signal.aborted) throw asError(controller.signal.reason);
    throw asError(failure);
  } finally {
    dispose();
  }
}

export function exportPaperNotesPdf(library: LibraryService, paperIds: string[], io: NotesExportIo = desktopIo, persistence: PersistenceApi | null = null): Promise<boolean> {
  return exportDocumentNotesPdf(library, persistence, paperIds.map((id) => ({ documentKey: paperDocumentKey(id), displayName: '' })), io);
}
