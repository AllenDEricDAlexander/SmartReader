import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDocumentNotesPdf, exportPaperNotesPdf } from './exportPaperNotes';
import { emptyLibrary } from './libraryModels';
import { createLibraryPersistence } from './libraryPersistence';
import { LibraryService } from './libraryService';
import { libraryUiFixture, paperFixture } from './libraryUiTestUtils';
import type { LibraryStorage } from './libraryStorage';
import type { PersistenceApi, PersistedAnnotation } from '../persistence/persistenceApi';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function outputIo() {
  const file = { write: vi.fn().mockResolvedValue(undefined), flush: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  const io = { choosePath: vi.fn().mockResolvedValue('/tmp/notes.pdf'),
    createPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), openPdf: vi.fn().mockResolvedValue(file) };
  return { io, file };
}

function annotation(documentKey: string, text = '新笔记'): PersistedAnnotation {
  return { id: null, documentKey, page: 3, type: 'note', color: '#facc15', text, quote: '原文', areas: [], tagIds: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' };
}

describe('notes PDF export', () => {
  it('exports each selected paper once and writes all bytes to the new output', async () => {
    const { library, ai } = await libraryUiFixture([paperFixture(), paperFixture('paper-2', '第二篇')]);
    const { io, file } = outputIo();
    const bytes = new Uint8Array(1024 * 1024 + 7).fill(42);
    io.createPdf.mockResolvedValue(bytes);
    expect(await exportPaperNotesPdf(library, ['paper-2', 'paper-1', 'paper-2'], io)).toBe(true);
    expect(io.choosePath).toHaveBeenCalledWith('文献笔记.pdf');
    expect(io.createPdf.mock.calls[0][0].map((paper: { fileName: string }) => paper.fileName)).toEqual(['paper-2.pdf', 'paper-1.pdf']);
    expect(io.openPdf).toHaveBeenCalledExactlyOnceWith('/tmp/notes.pdf');
    expect(file.write.mock.calls.map(([chunk]) => chunk.length)).toEqual([1024 * 1024, 7]);
    expect(file.flush).toHaveBeenCalledOnce();
    expect(file.finish).toHaveBeenCalledOnce();
    expect(file.release).toHaveBeenCalledOnce();
    expect(file.abort).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('combines selected library and legacy notes, bookmarks, and tag names', async () => {
    const { library, ai } = await libraryUiFixture();
    const record = { ...annotation('desktop:/old.pdf', '旧笔记'), id: 2, tagIds: [9] };
    const bookmark = { id: 3, documentKey: 'desktop:/old.pdf', page: 4, title: '旧书签', note: '旧备注', createdAt: '2026-10-01', updatedAt: '2026-10-01' };
    const persistence = { listAnnotations: vi.fn().mockResolvedValue([record]), listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listTags: vi.fn().mockResolvedValue([{ id: 9, name: '重点' }]) } as unknown as PersistenceApi;
    const { io, file } = outputIo();
    await exportDocumentNotesPdf(library, persistence, [
      { documentKey: 'paper:paper-1', displayName: '认知研究' },
      { documentKey: 'desktop:/old.pdf', displayName: '旧文献.pdf' },
    ], io);
    expect(persistence.listAnnotations).toHaveBeenCalledExactlyOnceWith('desktop:/old.pdf');
    expect(persistence.listBookmarks).toHaveBeenCalledExactlyOnceWith('desktop:/old.pdf');
    expect(io.createPdf.mock.calls[0][0]).toEqual([
      expect.objectContaining({ fileName: 'paper-1.pdf' }),
      expect.objectContaining({ fileName: '旧文献.pdf', annotations: [record], bookmarks: [bookmark], tagNames: { 9: '重点' } }),
    ]);
    expect(file.finish).toHaveBeenCalledOnce();
    ai.dispose();
  });

  it('does not open an output when a legacy read or tag lookup fails', async () => {
    const { library, ai } = await libraryUiFixture();
    const persistence = { listAnnotations: vi.fn().mockRejectedValue(new Error('读取失败')), listBookmarks: vi.fn().mockResolvedValue([]) } as unknown as PersistenceApi;
    const { io } = outputIo();
    await expect(exportDocumentNotesPdf(library, persistence, [{ documentKey: 'desktop:/old.pdf', displayName: 'old.pdf' }], io)).rejects.toThrow('读取失败');
    expect(io.createPdf).not.toHaveBeenCalled();
    expect(io.openPdf).not.toHaveBeenCalled();

    const tagsFail = { listAnnotations: vi.fn().mockResolvedValue([{ ...annotation('desktop:/old.pdf'), tagIds: [9] }]),
      listBookmarks: vi.fn().mockResolvedValue([]), listTags: vi.fn().mockRejectedValue(new Error('标签读取失败')) } as unknown as PersistenceApi;
    const next = outputIo();
    await expect(exportDocumentNotesPdf(library, tagsFail, [{ documentKey: 'desktop:/old.pdf', displayName: 'old.pdf' }], next.io)).rejects.toThrow('标签读取失败');
    expect(next.io.openPdf).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('uses a safe filename and leaves files alone when the dialog is cancelled', async () => {
    const { library, ai } = await libraryUiFixture([paperFixture('paper-1', '论文/测试:一')]);
    const { io } = outputIo();
    io.choosePath.mockResolvedValue(null);
    expect(await exportPaperNotesPdf(library, ['paper-1'], io)).toBe(false);
    expect(io.choosePath).toHaveBeenCalledWith('论文 测试 一-笔记.pdf');
    expect(io.createPdf).not.toHaveBeenCalled();
    expect(io.openPdf).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('waits for a previously submitted library transaction before building the PDF', async () => {
    const paper = paperFixture();
    const snapshot = emptyLibrary();
    snapshot.papers = [{ id: paper.id, kind: 'plain', paper }];
    const entered = deferred(), release = deferred();
    const storage: LibraryStorage = { load: async () => ({ revision: 0, data: snapshot }),
      commit: async () => { entered.resolve(); await release.promise; return 1; }, readFile: async () => new Uint8Array() };
    const library = new LibraryService(storage);
    await library.initialize();
    const saving = library.saveAnnotation(paper.id, annotation('paper:paper-1'));
    await entered.promise;
    const { io } = outputIo();
    const exporting = exportPaperNotesPdf(library, [paper.id], io);
    await vi.waitFor(() => expect(io.choosePath).toHaveBeenCalledOnce());
    expect(io.createPdf).not.toHaveBeenCalled();
    release.resolve();
    await saving;
    await exporting;
    expect(io.createPdf.mock.calls[0][0][0].annotations).toEqual([expect.objectContaining({ text: '新笔记' })]);
  });

  it('waits for reader saves still queued before their library transaction begins', async () => {
    const { library, ai } = await libraryUiFixture();
    const entered = deferred(), tags = deferred<[]>();
    const base = { listTags: vi.fn(() => { entered.resolve(); return tags.promise; }) } as unknown as PersistenceApi;
    const persistence = createLibraryPersistence(base, library);
    const saving = persistence.saveAnnotation(annotation('paper:paper-1'));
    await entered.promise;
    const { io } = outputIo();
    const exporting = exportPaperNotesPdf(library, ['paper-1'], io, persistence);
    await vi.waitFor(() => expect(io.choosePath).toHaveBeenCalledOnce());
    expect(io.createPdf).not.toHaveBeenCalled();
    tags.resolve([]);
    await saving;
    await exporting;
    expect(io.createPdf.mock.calls[0][0][0].annotations).toEqual([expect.objectContaining({ text: '新笔记' })]);
    ai.dispose();
  });

  it('waits for an already submitted legacy save and rejects if that save fails', async () => {
    const { library, ai } = await libraryUiFixture();
    const pending = deferred<PersistedAnnotation>();
    const record = annotation('desktop:/old.pdf', '旧文献的新笔记');
    const base = { saveAnnotation: vi.fn(() => pending.promise), listAnnotations: vi.fn().mockImplementation(async () => [await pending.promise]),
      listBookmarks: vi.fn().mockResolvedValue([]) } as unknown as PersistenceApi;
    const persistence = createLibraryPersistence(base, library);
    const saving = persistence.saveAnnotation(record);
    const { io } = outputIo();
    const exporting = exportDocumentNotesPdf(library, persistence, [{ documentKey: record.documentKey, displayName: 'old.pdf' }], io);
    await vi.waitFor(() => expect(io.choosePath).toHaveBeenCalledOnce());
    expect(io.createPdf).not.toHaveBeenCalled();
    pending.resolve(record);
    await saving;
    await exporting;
    expect(io.createPdf.mock.calls[0][0][0].annotations).toEqual([record]);

    const failure = deferred<PersistedAnnotation>();
    vi.mocked(base.saveAnnotation).mockReturnValueOnce(failure.promise);
    const failingSave = persistence.saveAnnotation(record);
    const saveRejected = expect(failingSave).rejects.toThrow('保存失败');
    const next = outputIo();
    const failedExport = exportDocumentNotesPdf(library, persistence, [{ documentKey: record.documentKey, displayName: 'old.pdf' }], next.io);
    const exportRejected = expect(failedExport).rejects.toThrow('保存失败');
    await vi.waitFor(() => expect(next.io.choosePath).toHaveBeenCalledOnce());
    failure.reject(new Error('保存失败'));
    await Promise.all([saveRejected, exportRejected]);
    expect(next.io.openPdf).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('rejects a document removed while the save dialog is open', async () => {
    const { library, ai } = await libraryUiFixture();
    const choice = deferred<string>();
    const { io } = outputIo();
    io.choosePath.mockReturnValue(choice.promise);
    const pending = exportPaperNotesPdf(library, ['paper-1'], io);
    await library.deletePapers(['paper-1']);
    choice.resolve('/tmp/notes.pdf');
    await expect(pending).rejects.toThrow('访问状态已变化');
    expect(io.createPdf).not.toHaveBeenCalled();
    expect(io.openPdf).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('rejects locked papers and invalidates exports across lock and unlock', async () => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-1'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    await library.lockVault(vault.id);
    const locked = outputIo();
    await expect(exportPaperNotesPdf(library, ['paper-1'], locked.io)).rejects.toThrow('已锁定');
    expect(locked.io.choosePath).not.toHaveBeenCalled();

    await library.unlockVault(vault.id, 'a strong password');
    const choice = deferred<string>();
    const { io } = outputIo();
    io.choosePath.mockReturnValue(choice.promise);
    const pending = exportPaperNotesPdf(library, ['paper-1'], io);
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'a strong password');
    choice.resolve('/tmp/notes.pdf');
    await expect(pending).rejects.toThrow('访问状态已变化');
    expect(io.createPdf).not.toHaveBeenCalled();
    expect(io.openPdf).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('locks immediately during PDF generation and aborts the whole batch', async () => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-1'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    const entered = deferred(), release = deferred<Uint8Array>();
    const { io } = outputIo();
    io.createPdf.mockImplementation(() => { entered.resolve(); return release.promise; });
    const pending = exportPaperNotesPdf(library, ['paper-1', 'paper-2'], io);
    await entered.promise;
    await library.lockVault(vault.id);
    expect(library.getView().papers.some((paper) => paper.id === 'paper-1')).toBe(false);
    release.resolve(new Uint8Array([1]));
    await expect(pending).rejects.toThrow('访问状态已变化');
    expect(io.openPdf).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('hides a locked paper immediately and discards a new output if locking begins during writing', async () => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-1'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    const entered = deferred(), release = deferred();
    const { io, file } = outputIo();
    file.write.mockImplementation(() => { entered.resolve(); return release.promise; });
    const pending = exportPaperNotesPdf(library, ['paper-1'], io);
    const rejected = expect(pending).rejects.toThrow('访问状态已变化');
    await entered.promise;
    const locking = library.lockVault(vault.id);
    expect(library.getView().papers.some((paper) => paper.id === 'paper-1')).toBe(false);
    expect(library.getPaper('paper-1')).toBeUndefined();
    expect(library.getView().unlockedVaultIds).not.toContain(vault.id);
    expect(library.isVaultLocking(vault.id)).toBe(true);
    await expect(library.unlockVault(vault.id, 'a strong password')).rejects.toThrow('正在锁定');
    release.resolve();
    await Promise.all([locking, rejected]);
    expect(library.isVaultLocking(vault.id)).toBe(false);
    expect(file.abort).toHaveBeenCalledOnce();
    expect(file.finish).not.toHaveBeenCalled();
    ai.dispose();
  });

  it.each(['open', 'flush', 'finish'] as const)('discards the output when locking begins during %s', async (stage) => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-1'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    const entered = deferred(), release = deferred();
    const { io, file } = outputIo();
    if (stage === 'open') io.openPdf.mockImplementation(async () => { entered.resolve(); await release.promise; return file; });
    else if (stage === 'flush') file.flush.mockImplementation(() => { entered.resolve(); return release.promise; });
    else file.finish.mockImplementation(() => { entered.resolve(); return release.promise; });
    const pending = exportPaperNotesPdf(library, ['paper-1'], io);
    const rejected = expect(pending).rejects.toThrow('访问状态已变化');
    await entered.promise;
    const locking = library.lockVault(vault.id);
    expect(library.getPaper('paper-1')).toBeUndefined();
    release.resolve();
    await Promise.all([locking, rejected]);
    expect(file.abort).toHaveBeenCalledOnce();
    expect(file.release).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('reports cleanup failure instead of hiding it behind the lock cancellation', async () => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-1'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    const entered = deferred(), release = deferred();
    const { io, file } = outputIo();
    file.write.mockImplementation(() => { entered.resolve(); return release.promise; });
    file.abort.mockRejectedValue(new Error('无法清理'));
    const pending = exportPaperNotesPdf(library, ['paper-1'], io);
    const rejected = expect(pending).rejects.toThrow('清理新文件失败（/tmp/notes.pdf）');
    await entered.promise;
    const locking = library.lockVault(vault.id);
    release.resolve();
    await Promise.all([locking, rejected]);
    expect(file.finish).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('does not block an unrelated vault lock while exporting legacy documents', async () => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-1'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    const entered = deferred(), release = deferred<Uint8Array>();
    const { io } = outputIo();
    io.createPdf.mockImplementation(() => { entered.resolve(); return release.promise; });
    const persistence = { listAnnotations: vi.fn().mockResolvedValue([]), listBookmarks: vi.fn().mockResolvedValue([]) } as unknown as PersistenceApi;
    const pending = exportDocumentNotesPdf(library, persistence, [{ documentKey: 'desktop:/old.pdf', displayName: 'old.pdf' }], io);
    await entered.promise;
    await library.lockVault(vault.id);
    release.resolve(new Uint8Array([1]));
    expect(await pending).toBe(true);
    ai.dispose();
  });

  it('does not block an unrelated vault lock while writing another library paper', async () => {
    const { library, ai } = await libraryUiFixture();
    const folder = await library.createFolder('私有文献');
    await library.categorize(['paper-2'], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'a strong password');
    const entered = deferred(), release = deferred();
    const { io, file } = outputIo();
    file.write.mockImplementation(() => { entered.resolve(); return release.promise; });
    const pending = exportPaperNotesPdf(library, ['paper-1'], io);
    await entered.promise;
    await library.lockVault(vault.id);
    expect(library.getView().papers.some((paper) => paper.id === 'paper-2')).toBe(false);
    release.resolve();
    expect(await pending).toBe(true);
    expect(file.finish).toHaveBeenCalledOnce();
    ai.dispose();
  });

  it('does not delete a pre-existing destination, and reports write and cleanup errors', async () => {
    const { library, ai } = await libraryUiFixture();
    const existing = outputIo();
    existing.io.openPdf.mockRejectedValue(new Error('目标文件已存在'));
    await expect(exportPaperNotesPdf(library, ['paper-1'], existing.io)).rejects.toThrow('目标文件已存在');
    expect(existing.file.abort).not.toHaveBeenCalled();

    const failed = outputIo();
    failed.file.write.mockRejectedValue(new Error('写入失败'));
    await expect(exportPaperNotesPdf(library, ['paper-1'], failed.io)).rejects.toThrow('写入失败');
    expect(failed.file.abort).toHaveBeenCalledOnce();
    expect(failed.file.finish).not.toHaveBeenCalled();

    const cleanup = outputIo();
    cleanup.file.write.mockRejectedValue(new Error('写入失败'));
    cleanup.file.abort.mockRejectedValue(new Error('清理失败'));
    await expect(exportPaperNotesPdf(library, ['paper-1'], cleanup.io)).rejects.toThrow('清理新文件失败');
    ai.dispose();
  });
});
