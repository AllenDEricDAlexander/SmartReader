import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyLibrary, emptyMetadata, type LibrarySnapshot } from './libraryModels';
import { LibraryService } from './libraryService';
import type { LibraryStorage } from './libraryStorage';

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
    readFile: vi.fn(async (id) => {
      const bytes = files.get(id);
      if (!bytes) throw new Error('LIBRARY_FILE_MISSING');
      return bytes.slice();
    }),
  };
  return { storage, files, snapshot: () => structuredClone(data) };
}

const pdf = () => new TextEncoder().encode('%PDF-1.7\nresearch paper');
const extracted = () => ({
  metadata: {
    ...emptyMetadata('Attention and learning'),
    year: '2025',
    researchFields: ['人工智能'],
    disciplines: ['计算机科学'],
    journalType: '期刊论文',
    researchTopics: ['机器学习'],
  },
  pages: [{ page: 1, text: 'Attention models improve machine learning.' }],
  pageCount: 1,
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});

describe('desktop library workflows', () => {
  it('backfills the source path on duplicate import without losing notes or reading progress', async () => {
    const backend = memoryStorage();
    const extract = vi.fn(async () => ({ ...extracted(), pageCount: 5 }));
    const library = new LibraryService(backend.storage, extract);
    const first = await library.importPdf(pdf(), 'paper.pdf');
    await library.editMetadata(first.id, { title: 'My research title' });
    await library.recordReading(first.id, 10, 3, 1.5);
    await library.saveAnnotation(first.id, {
      id: null, documentKey: `paper:${first.id}`, page: 1, type: 'note', color: '#fff',
      text: 'Keep my note', quote: null, areas: [], createdAt: '', updatedAt: '',
    });
    const before = structuredClone(library.getPaper(first.id)!);
    const sourcePath = '/research/研究 notes.pdf';
    const duplicate = await library.importPdf(pdf(), 'renamed.pdf', { sourcePath });
    expect(duplicate).toMatchObject({ ...before, updatedAt: expect.any(String), sourcePath });
    expect(library.getView().papers).toHaveLength(1);
    expect(extract).toHaveBeenCalledOnce();
    await library.importPdf(pdf(), 'browser-copy.pdf');
    const reloaded = new LibraryService(backend.storage, async () => extracted());
    await reloaded.initialize();
    expect(reloaded.getPaper(first.id)).toMatchObject({ sourcePath, lastPage: 3, zoom: 1.5 });
    expect(reloaded.getPaper(first.id)?.annotations[0].text).toBe('Keep my note');
  });

  it('keeps original source paths inside the encrypted paper metadata', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'private.pdf', { sourcePath: '/private/original.pdf' });
    const folder = await library.createFolder('Private');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'strong password');
    await library.importPdf(pdf(), 'private.pdf', { sourcePath: '/private/moved.pdf' });
    expect(JSON.stringify(backend.snapshot())).not.toContain('/private/');
    await library.lockVault(vault.id);
    expect(library.getPaper(paper.id)).toBeUndefined();
    await library.unlockVault(vault.id, 'strong password');
    expect(library.getPaper(paper.id)?.sourcePath).toBe('/private/moved.pdf');
  });

  it('deduplicates PDF contents across filenames, indexes and classifies without copying files', async () => {
    const backend = memoryStorage();
    const extract = vi.fn(async () => extracted());
    const library = new LibraryService(backend.storage, extract);
    const first = await library.importPdf(pdf(), 'first.pdf');
    const second = await library.importPdf(pdf(), 'renamed.pdf');

    expect(first.id).toBe(second.id);
    expect(backend.files.size).toBe(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(library.getView().papers).toHaveLength(1);
    expect(library.getView().snapshot.memberships[first.id]).toHaveLength(5);
    expect(library.search('machine learning')[0]).toMatchObject({ paperId: first.id, page: 1 });
  });

  it('preserves manual metadata through reindex and persists it across library instances', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    await library.editMetadata(paper.id, { title: 'My title', year: '', abstract: 'My notes' });
    await library.retryIndex(paper.id);
    const reopened = new LibraryService(backend.storage, async () => extracted());
    await reopened.initialize();

    expect(reopened.getPaper(paper.id)?.metadata).toMatchObject({
      title: 'My title', year: '', abstract: 'My notes',
    });
    expect(reopened.getPaper(paper.id)?.manualFields).toEqual(expect.arrayContaining(['title', 'year', 'abstract']));
  });

  it('prunes obsolete automatic topics only after their last paper receives new AI metadata', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const first = await library.importPdf(pdf(), 'first.pdf');
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond paper'), 'second.pdf');
    const originalTopic = library.getView().snapshot.folders.find((folder) => folder.name === '机器学习')!;
    const manual = await library.createFolder('手工空分类');

    await library.applyAiMetadata(first.id, { researchTopics: ['注意力与记忆'] });
    expect(library.getView().snapshot.folders.some((folder) => folder.id === originalTopic.id)).toBe(true);
    expect(library.getView().snapshot.memberships[second.id]).toContain(originalTopic.id);
    await library.applyAiMetadata(second.id, { researchTopics: ['注意力与记忆'] });

    const snapshot = library.getView().snapshot;
    expect(snapshot.folders.some((folder) => folder.id === originalTopic.id)).toBe(false);
    expect(snapshot.folders.some((folder) => folder.id === manual.id)).toBe(true);
    const replacement = snapshot.folders.find((folder) => folder.name === '注意力与记忆')!;
    expect(snapshot.folders.some((folder) => folder.id === replacement.parentId && folder.name === '论文主题')).toBe(true);
    expect(snapshot.memberships[first.id]).toContain(replacement.id);
    expect(snapshot.memberships[second.id]).toContain(replacement.id);
    expect(backend.snapshot()?.folders).toEqual(snapshot.folders);
    await library.applyAiMetadata(second.id, { researchTopics: ['注意力与记忆'] });
    expect(library.getView().snapshot.folders).toEqual(snapshot.folders);
  });

  it.each(['reindex', 'manual edit'] as const)('prunes unused automatic folders after %s updates', async (operation) => {
    const backend = memoryStorage();
    const extract = vi.fn(async () => extracted());
    const library = new LibraryService(backend.storage, extract);
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const oldTopic = library.getView().snapshot.folders.find((folder) => folder.name === '机器学习')!;
    if (operation === 'reindex') {
      extract.mockResolvedValueOnce({ ...extracted(), metadata: { ...extracted().metadata, researchTopics: ['重新识别的主题'] } });
      await library.retryIndex(paper.id);
      expect(library.getView().snapshot.folders.some((folder) => folder.name === '重新识别的主题')).toBe(true);
    } else {
      await library.editMetadata(paper.id, { researchTopics: [] });
      expect(library.getView().snapshot.folders.some((folder) => folder.id === oldTopic.parentId)).toBe(false);
    }
    expect(library.getView().snapshot.folders.some((folder) => folder.id === oldTopic.id)).toBe(false);
  });

  it('keeps empty automatic vault roots and manual folders during subsequent classification cleanup', async () => {
    const backend = memoryStorage();
    const extract = vi.fn(async () => extracted());
    const library = new LibraryService(backend.storage, extract);
    const privatePaper = await library.importPdf(pdf(), 'private.pdf');
    const vaultFolder = library.getView().snapshot.folders.find((folder) => folder.name === '机器学习')!;
    const vault = await library.encryptFolder(vaultFolder.id, 'strong password');
    await library.deletePapers([privatePaper.id]);
    const manual = await library.createFolder('手工空分类');
    extract.mockResolvedValueOnce({ ...extracted(), metadata: { ...extracted().metadata, researchTopics: ['公开主题'] } });
    const publicPaper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\npublic paper'), 'public.pdf');

    const snapshot = library.getView().snapshot;
    expect(snapshot.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: vaultFolder.id, automatic: true }),
      expect.objectContaining({ id: manual.id, automatic: false }),
    ]));
    expect(snapshot.vaults).toEqual([vault]);
    expect(snapshot.folders.some((folder) => folder.id === vaultFolder.parentId)).toBe(true);
    expect(snapshot.memberships[publicPaper.id]).not.toContain(vaultFolder.id);
  });

  it('does not publish automatic folder cleanup when its metadata transaction fails', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const previous = structuredClone(library.getView().snapshot);
    vi.mocked(backend.storage.commit).mockRejectedValueOnce(new Error('disk full'));

    await expect(library.applyAiMetadata(paper.id, { researchTopics: ['待保存的新主题'] })).rejects.toThrow('disk full');
    const attempted = vi.mocked(backend.storage.commit).mock.calls.at(-1)![1];
    expect(attempted.folders.some((folder) => folder.name === '机器学习')).toBe(false);
    expect(library.getView().snapshot).toEqual(previous);
    expect(backend.snapshot()).toEqual(previous);
  });

  it('keeps an imported file when extraction fails and supports a later successful retry', async () => {
    const backend = memoryStorage();
    const extract = vi.fn().mockRejectedValueOnce(new Error('PDF 需要密码')).mockResolvedValue(extracted());
    const library = new LibraryService(backend.storage, extract);
    const paper = await library.importPdf(pdf(), 'locked.pdf');
    expect(paper.indexStatus).toBe('error');
    expect(backend.files.size).toBe(1);
    await library.retryIndex(paper.id, 'password');
    expect(library.getPaper(paper.id)?.indexStatus).toBe('ready');
    expect(extract).toHaveBeenLastCalledWith(expect.any(Uint8Array), expect.objectContaining({ password: 'password' }));
  });

  it('does not publish failed saves or lose concurrent mutations', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    vi.mocked(backend.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    await expect(library.updatePaper(paper.id, { favorite: true })).rejects.toThrow('disk full');
    expect(library.getPaper(paper.id)?.favorite).toBe(false);
    await Promise.all([
      library.updatePaper(paper.id, { favorite: true }),
      library.updatePaper(paper.id, { pinned: true }),
    ]);
    expect(library.getPaper(paper.id)).toMatchObject({ favorite: true, pinned: true });
  });

  it('moves or adds categories in a batch while deleting a folder preserves its papers', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const project = await library.createFolder('项目');
    const review = await library.createFolder('文献综述', project.id);
    await library.categorize([paper.id], [project.id], 'move');
    await library.categorize([paper.id], [review.id], 'add');
    expect(library.getView().snapshot.memberships[paper.id]).toEqual([project.id, review.id]);
    await library.deleteFolder(project.id);
    expect(library.getPaper(paper.id)).toBeDefined();
    expect(library.getView().snapshot.memberships[paper.id]).toEqual([]);
    expect(backend.files.size).toBe(1);
  });

  it('encrypts metadata and bytes, hides every cross-folder reference on lock, and unlocks after restart', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'private.pdf');
    const vaultFolder = await library.createFolder('私人项目');
    const shared = await library.createFolder('研究方向');
    await library.categorize([paper.id], [vaultFolder.id, shared.id], 'move');
    const vault = await library.encryptFolder(vaultFolder.id, 'my strong password');
    expect(JSON.stringify(backend.snapshot())).not.toContain('Attention and learning');
    expect(new TextDecoder().decode(backend.files.get(paper.id))).not.toContain('%PDF');
    expect(Array.from(await library.readPdf(paper.id))).toEqual(Array.from(pdf()));

    const onLock = vi.fn();
    library.onLocked(onLock);
    await library.lockVault(vault.id);
    expect(onLock).toHaveBeenCalledWith([paper.id]);
    expect(library.getPaper(paper.id)).toBeUndefined();
    expect(library.search('attention')).toEqual([]);
    await expect(library.readPdf(paper.id)).rejects.toThrow('解锁');
    await expect(library.updatePaper(paper.id, { favorite: true })).rejects.toThrow('解锁');

    const reopened = new LibraryService(backend.storage, async () => extracted());
    await reopened.initialize();
    expect(reopened.getView().papers).toHaveLength(0);
    await expect(reopened.unlockVault(vault.id, 'wrong password')).rejects.toThrow();
    await reopened.unlockVault(vault.id, 'my strong password');
    expect(reopened.getPaper(paper.id)?.metadata.title).toBe('Attention and learning');
    expect(Array.from(await reopened.readPdf(paper.id))).toEqual(Array.from(pdf()));
    await reopened.updatePaper(paper.id, { favorite: true });
    expect(JSON.stringify(backend.snapshot())).not.toContain('Attention and learning');
    await reopened.decryptFolder(vault.id);
    expect(Array.from(backend.files.get(paper.id)!)).toEqual(Array.from(pdf()));
    expect(reopened.getView().snapshot.vaults).toHaveLength(0);
  });

  it('adds papers to an unlocked vault using encryption and rolls back a failed encryption save', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const folder = await library.createFolder('机密');
    const vault = await library.encryptFolder(folder.id, 'secret password');
    vi.mocked(backend.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    await expect(library.categorize([paper.id], [folder.id], 'add')).rejects.toThrow('disk full');
    expect(library.getView().snapshot.papers[0].kind).toBe('plain');
    expect(Array.from(backend.files.get(paper.id)!)).toEqual(Array.from(pdf()));
    await library.categorize([paper.id], [folder.id], 'add');
    expect(library.getView().snapshot.papers[0].kind).toBe('encrypted');
    await library.lockVault(vault.id);
    expect(library.getView().papers).toHaveLength(0);
  });

  it('fails closed on an unsupported schema without overwriting existing data', async () => {
    const backend = memoryStorage();
    const data = { ...emptyLibrary(), schemaVersion: 9 };
    vi.mocked(backend.storage.load).mockResolvedValue({ revision: 1, data: data as unknown as LibrarySnapshot });
    const library = new LibraryService(backend.storage, async () => extracted());
    await expect(library.initialize()).rejects.toThrow('版本');
    expect(backend.storage.commit).not.toHaveBeenCalled();
  });

  it('removes inferred topic names and associations when encrypting, then restores classification on decryption', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => ({
      ...extracted(), metadata: { ...extracted().metadata, researchTopics: ['保密实验名称'] },
    }));
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'add');
    const vault = await library.encryptFolder(folder.id, 'strong password');
    expect(JSON.stringify(backend.snapshot())).not.toContain('保密实验名称');
    expect(library.getView().snapshot.memberships[paper.id]).toEqual([folder.id]);
    await library.decryptFolder(vault.id);
    expect(library.getView().snapshot.folders.some((item) => item.name === '保密实验名称')).toBe(true);
  });

  it('rejects a pending PDF open after locking and invalidates the caller access token', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'strong password');
    const token = library.captureAccess();
    const read = library.readPdf(paper.id);
    const rejected = expect(read).rejects.toThrow('锁定');
    await library.lockVault(vault.id);
    await rejected;
    await library.unlockVault(vault.id, 'strong password');
    expect(library.canAccess(paper.id, token)).toBe(false);
    await expect(library.importPdf(pdf(), 'renamed.pdf')).resolves.toMatchObject({ id: paper.id });
  });

  it('cancels indexing when locked and recovers a retryable state without publishing its late result', async () => {
    const backend = memoryStorage();
    const extract = vi.fn(async () => extracted());
    const library = new LibraryService(backend.storage, extract);
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'strong password');
    let finish: (result: ReturnType<typeof extracted>) => void = () => undefined;
    extract.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const retry = library.retryIndex(paper.id);
    const cancelled = expect(retry).rejects.toThrow('索引已中断');
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'strong password');
    expect(library.getPaper(paper.id)?.indexStatus).toBe('error');
    finish({ ...extracted(), metadata: { ...extracted().metadata, title: 'Late result' } });
    await cancelled;
    expect(library.getPaper(paper.id)?.metadata.title).toBe('Attention and learning');
    await library.retryIndex(paper.id);
    expect(library.getPaper(paper.id)?.indexStatus).toBe('ready');
  });

  it('encrypts newly saved annotations and bookmarks and never accepts an AI indexing-status claim', async () => {
    const backend = memoryStorage();
    const library = new LibraryService(backend.storage, async () => extracted());
    const paper = await library.importPdf(pdf(), 'paper.pdf');
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    await library.encryptFolder(folder.id, 'strong password');
    await library.saveBookmark(paper.id, {
      id: null, documentKey: '', page: 1, title: 'Secret bookmark', note: 'Private note', createdAt: '', updatedAt: '',
    });
    await library.saveAnnotation(paper.id, {
      id: null, documentKey: '', page: 1, type: 'note', color: '#fff', text: 'Sensitive annotation',
      quote: null, areas: [], createdAt: '', updatedAt: '',
    });
    await library.applyAiMetadata(paper.id, { indexingStatus: 'SCIE', keywords: ['attention'] });
    const persisted = JSON.stringify(backend.snapshot());
    expect(persisted).not.toContain('Secret bookmark');
    expect(persisted).not.toContain('Sensitive annotation');
    expect(library.getPaper(paper.id)?.metadata.indexingStatus).toBe('未知');
    expect(library.getPaper(paper.id)?.bookmarks[0].id).toBe(-1);
    expect(library.getPaper(paper.id)?.annotations[0].id).toBe(-2);
  });
});
