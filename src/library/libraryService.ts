import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import {
  createVaultKey, decryptFile, decryptJson, deriveVaultKey,
  encryptFile, encryptJson,
} from './libraryCrypto';
import {
  classifyPaper, createFolder, deleteFolder, descendantFolderIds,
  folderVaultId, mergeFolders, moveFolder, renameFolder,
} from './libraryFolders';
import {
  emptyLibrary, emptyMetadata, paperDocumentKey,
  type AiSettings, type FolderVault, type LibraryPreferences, type LibrarySnapshot,
  type MetadataField, type Paper, type PaperMetadata,
} from './libraryModels';
import { LibrarySearchIndex } from './librarySearch';
import type { LibraryFileWrite, LibraryStorage } from './libraryStorage';
import type { PdfExtraction } from './pdfExtraction';

type PdfExtractor = (bytes: Uint8Array, options?: { password?: string; signal?: AbortSignal }) => Promise<PdfExtraction>;
type PaperUpdates = Partial<Pick<Paper,
  'favorite' | 'pinned' | 'lastPage' | 'zoom' | 'lastReadAt' | 'recentHidden' |
  'readingSeconds' | 'annotations' | 'bookmarks' | 'tagIds' | 'aiStatus' | 'aiError'
>>;
type LibraryTransaction = {
  snapshot: LibrarySnapshot;
  decrypted: Map<string, Paper>;
  blobs: LibraryFileWrite[];
};

export type LibraryView = {
  loaded: boolean;
  error: string | null;
  snapshot: LibrarySnapshot;
  papers: Paper[];
  lockedPaperIds: string[];
  unlockedVaultIds: string[];
};

const MAX_PDF_BYTES = 128 * 1024 * 1024;
const defaultExtractor: PdfExtractor = async (bytes, options) =>
  (await import('./pdfExtraction')).extractPdf(bytes, options);

/** Owns local library transactions; UI, PDF parsing and AI never write storage directly. */
export class LibraryService {
  private snapshot = emptyLibrary();
  private revision = 0;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private decrypted = new Map<string, Paper>();
  private keys = new Map<string, CryptoKey>();
  private listeners = new Set<() => void>();
  private lockedListeners = new Set<(paperIds: string[]) => void>();
  private indexedListeners = new Set<(paperId: string) => void>();
  private indexing = new Map<string, { promise: Promise<Paper>; controller: AbortController }>();
  private accessEpoch = 0;
  private searchIndex = new LibrarySearchIndex();
  private view: LibraryView = {
    loaded: false, error: null, snapshot: this.snapshot,
    papers: [], lockedPaperIds: [], unlockedVaultIds: [],
  };

  constructor(private storage: LibraryStorage, private extract: PdfExtractor = defaultExtractor) {}

  getView = (): LibraryView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  onLocked(listener: (paperIds: string[]) => void): () => void {
    this.lockedListeners.add(listener);
    return () => { this.lockedListeners.delete(listener); };
  }

  onIndexed(listener: (paperId: string) => void): () => void {
    this.indexedListeners.add(listener);
    return () => { this.indexedListeners.delete(listener); };
  }

  initialize(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.storage.load().then(async ({ revision, data }) => {
      if (data && (data.schemaVersion !== 1 || !Array.isArray(data.papers) || !Array.isArray(data.folders))) {
        throw new Error('文献库版本不受支持，请升级客户端；现有数据未修改。');
      }
      this.snapshot = data ?? emptyLibrary();
      this.snapshot.automaticMemberships ??= {};
      this.revision = revision;
      let interrupted = false;
      for (const record of this.snapshot.papers) {
        if (record.kind === 'plain') interrupted = recoverInterruptedWork(record.paper) || interrupted;
      }
      if (interrupted) this.revision = await this.storage.commit(this.revision, this.snapshot, []);
      this.loaded = true;
      this.publish();
    }).catch((error: unknown) => {
      this.publish(errorMessage(error));
      throw error;
    }).finally(() => { this.loading = null; });
    return this.loading;
  }

  async reload(): Promise<void> {
    await this.exclusive(async () => {
      this.invalidateAccess(this.snapshot.papers.map((paper) => paper.id));
      this.notifyLocked(this.snapshot.papers.map((paper) => paper.id));
      this.keys.clear();
      this.decrypted.clear();
      this.loaded = false;
      this.publish();
      await this.initialize();
    });
  }

  getPaper(id: string): Paper | undefined {
    const record = this.snapshot.papers.find((item) => item.id === id);
    return record?.kind === 'plain' ? record.paper : this.decrypted.get(id);
  }

  captureAccess(): number { return this.accessEpoch; }

  canAccess(id: string, token: number): boolean {
    return token === this.accessEpoch && this.getPaper(id) !== undefined;
  }

  search(query: string, options?: { limit?: number; paperIds?: string[] }) {
    return this.searchIndex.search(query, options);
  }

  async importPdf(
    bytes: Uint8Array,
    fileName: string,
    options: { folderId?: string; password?: string } = {},
  ): Promise<Paper> {
    if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
      throw new Error('请选择不超过 128 MB 的 PDF 文件。');
    }
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
      throw new Error('文件不是有效的 PDF，未导入文献库。');
    }
    const copy = new Uint8Array(bytes);
    const hash = await crypto.subtle.digest('SHA-256', copy);
    const id = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
    let isNew = false;
    await this.mutate(async (tx) => {
      if (tx.snapshot.papers.some((item) => item.id === id)) {
        this.requirePaper(id, tx);
        if (options.folderId) await this.applyCategories(tx, [id], [options.folderId], 'add');
        return;
      }
      const now = new Date().toISOString();
      const paper: Paper = {
        id, fileName: fileName.trim() || 'Untitled.pdf', fileSize: copy.length,
        addedAt: now, updatedAt: now, metadata: emptyMetadata(fileName.replace(/\.pdf$/i, '')),
        manualFields: [], pages: [], pageCount: 0, indexStatus: 'pending', indexError: null,
        aiStatus: 'idle', aiError: null, favorite: false, pinned: false, readingSeconds: 0,
        lastReadAt: null, lastPage: 1, zoom: 1, recentHidden: false,
        annotations: [], bookmarks: [], tagIds: [],
      };
      tx.snapshot.papers.push({ id, kind: 'plain', paper });
      tx.snapshot.memberships[id] = [];
      tx.blobs.push({ id, bytes: copy });
      if (options.folderId) await this.applyCategories(tx, [id], [options.folderId], 'add');
      isNew = true;
    });
    return isNew ? this.retryIndex(id, options.password) : this.requirePaper(id);
  }

  retryIndex(id: string, password?: string): Promise<Paper> {
    const current = this.indexing.get(id);
    if (current) return current.promise;
    const controller = new AbortController();
    const work = this.indexPaper(id, password, controller.signal).finally(() => {
      if (this.indexing.get(id)?.promise === work) this.indexing.delete(id);
    });
    this.indexing.set(id, { promise: work, controller });
    return work;
  }

  private async indexPaper(id: string, password: string | undefined, signal: AbortSignal): Promise<Paper> {
    const bytes = await this.readPdf(id);
    await this.mutate(async (tx) => {
      signal.throwIfAborted();
      const paper = this.requirePaper(id, tx);
      await this.putPaper(tx, { ...paper, indexStatus: 'pending', indexError: null });
    });
    let result: PdfExtraction;
    try {
      result = await this.extract(bytes, { password, signal });
    } catch (error) {
      signal.throwIfAborted();
      await this.mutate(async (tx) => {
        signal.throwIfAborted();
        const paper = this.requirePaper(id, tx);
        await this.putPaper(tx, { ...paper, indexStatus: 'error', indexError: errorMessage(error) });
      });
      return this.requirePaper(id);
    }
    await this.mutate(async (tx) => {
      signal.throwIfAborted();
      const current = this.requirePaper(id, tx);
      const metadata = mergeMetadata(current, result.metadata);
      const hasText = result.pages.some((page) => page.text.trim());
      const paper: Paper = {
        ...current, metadata, pages: result.pages, pageCount: result.pageCount,
        indexStatus: hasText ? 'ready' : 'empty',
        indexError: hasText ? null : '未发现可提取文本，可能是扫描 PDF；可手工填写信息，全文检索需要 OCR。',
      };
      classifyPaper(tx.snapshot, paper);
      await this.putPaper(tx, paper);
    });
    for (const listener of this.indexedListeners) listener(id);
    return this.requirePaper(id);
  }

  async readPdf(id: string): Promise<Uint8Array> {
    const access = this.captureAccess();
    const bytes = await this.exclusive(async () => {
      await this.initialize();
      this.requirePaper(id);
      const record = this.snapshot.papers.find((paper) => paper.id === id)!;
      const bytes = await this.storage.readFile(id);
      if (record.kind === 'plain') return bytes;
      const key = this.keys.get(record.vaultId);
      if (!key) throw new Error('请先解锁该文献所在的加密文件夹。');
      return decryptFile(key, bytes, `pdf:${id}`);
    });
    if (!this.canAccess(id, access)) throw new Error('文献已锁定或访问状态已变化，请解锁后重新打开。');
    return bytes;
  }

  async editMetadata(id: string, updates: Partial<PaperMetadata>): Promise<void> {
    const normalized = normalizeMetadata(updates);
    await this.mutate(async (tx) => {
      const paper = this.requirePaper(id, tx);
      const next: Paper = {
        ...paper, metadata: { ...paper.metadata, ...normalized },
        manualFields: [...new Set([...paper.manualFields, ...Object.keys(normalized) as MetadataField[]])],
      };
      classifyPaper(tx.snapshot, next);
      await this.putPaper(tx, next);
    });
  }

  async applyAiMetadata(id: string, updates: Partial<PaperMetadata>): Promise<void> {
    const { indexingStatus: _unverifiedStatus, ...safeUpdates } = normalizeMetadata(updates);
    await this.mutate(async (tx) => {
      const paper = this.requirePaper(id, tx);
      const next: Paper = {
        ...paper, metadata: mergeMetadata(paper, safeUpdates), aiStatus: 'ready', aiError: null,
      };
      classifyPaper(tx.snapshot, next);
      await this.putPaper(tx, next);
    });
  }

  async updatePaper(id: string, updates: PaperUpdates): Promise<void> {
    await this.mutate(async (tx) => {
      await this.putPaper(tx, { ...this.requirePaper(id, tx), ...updates });
    });
  }

  async batchUpdate(ids: string[], updates: Pick<PaperUpdates, 'favorite' | 'pinned'>): Promise<void> {
    await this.mutate(async (tx) => {
      for (const id of new Set(ids)) {
        await this.putPaper(tx, { ...this.requirePaper(id, tx), ...updates });
      }
    });
  }

  async deletePapers(ids: string[]): Promise<void> {
    await this.mutate(async (tx) => {
      for (const id of new Set(ids)) {
        this.requirePaper(id, tx);
        tx.snapshot.papers = tx.snapshot.papers.filter((item) => item.id !== id);
        delete tx.snapshot.memberships[id];
        delete tx.snapshot.automaticMemberships[id];
        tx.decrypted.delete(id);
        tx.blobs.push({ id, bytes: null });
      }
    });
    this.invalidateAccess(ids);
    this.notifyLocked(ids);
  }

  async recordReading(id: string, seconds: number, page: number, zoom: number): Promise<void> {
    await this.mutate(async (tx) => {
      const paper = this.requirePaper(id, tx);
      await this.putPaper(tx, {
        ...paper, readingSeconds: paper.readingSeconds + Math.min(60, Math.max(0, seconds)),
        lastPage: Math.max(1, Math.min(page, paper.pageCount || page)), zoom,
        lastReadAt: new Date().toISOString(), recentHidden: false,
      });
    });
  }

  async createFolder(name: string, parentId: string | null = null) {
    return this.mutate((tx) => createFolder(tx.snapshot, name, parentId));
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.mutate((tx) => renameFolder(tx.snapshot, id, name));
  }

  async moveFolder(id: string, parentId: string | null): Promise<void> {
    await this.mutate((tx) => moveFolder(tx.snapshot, id, parentId));
  }

  async mergeFolders(sourceId: string, targetId: string): Promise<void> {
    await this.mutate((tx) => mergeFolders(tx.snapshot, sourceId, targetId));
  }

  async deleteFolder(id: string): Promise<void> {
    await this.mutate((tx) => deleteFolder(tx.snapshot, id));
  }

  async categorize(ids: string[], folderIds: string[], mode: 'add' | 'move' | 'remove'): Promise<void> {
    await this.mutate((tx) => this.applyCategories(tx, ids, folderIds, mode));
  }

  private async applyCategories(tx: LibraryTransaction, ids: string[], folderIds: string[], mode: 'add' | 'move' | 'remove') {
    for (const id of folderIds) {
      if (!tx.snapshot.folders.some((folder) => folder.id === id)) throw new Error('分类文件夹不存在。');
    }
    for (const id of new Set(ids)) {
      const paper = this.requirePaper(id, tx);
      const existing = tx.snapshot.memberships[id] ?? [];
      const next = mode === 'move' ? [...new Set(folderIds)] : mode === 'add'
        ? [...new Set([...existing, ...folderIds])] : existing.filter((folderId) => !folderIds.includes(folderId));
      const vaultIds = [...new Set(next.map((folderId) => folderVaultId(tx.snapshot, folderId)).filter(Boolean))] as string[];
      if (vaultIds.length > 1) throw new Error('同一文献不能跨多个独立加密文件夹，请先解除其中一个文件夹的加密。');
      const record = tx.snapshot.papers.find((item) => item.id === id)!;
      if (record.kind === 'encrypted' && vaultIds[0] !== record.vaultId) {
        throw new Error('加密文献需保留至少一个原加密文件夹内的分类；移出前请先解除加密。');
      }
      tx.snapshot.memberships[id] = next;
      tx.snapshot.automaticMemberships[id] = mode === 'move' ? []
        : (tx.snapshot.automaticMemberships[id] ?? []).filter((folderId) => !folderIds.includes(folderId));
      if (record.kind === 'plain' && vaultIds[0]) {
        const key = this.keys.get(vaultIds[0]);
        if (!key) throw new Error('请先解锁目标加密文件夹。');
        await this.sealPaper(tx, paper, vaultIds[0], key);
      }
    }
  }

  async encryptFolder(folderId: string, password: string): Promise<FolderVault> {
    const { key, salt } = await createVaultKey(password);
    const vault: FolderVault = {
      id: crypto.randomUUID(), folderId, salt,
      verifier: await encryptJson(key, 'SmartReader library vault', `vault:${folderId}`),
    };
    await this.mutate(async (tx) => {
      if (!tx.snapshot.folders.some((folder) => folder.id === folderId)) throw new Error('分类文件夹不存在。');
      const affected = new Set([folderId, ...descendantFolderIds(tx.snapshot, folderId)]);
      if (folderVaultId(tx.snapshot, folderId) || tx.snapshot.vaults.some((item) => affected.has(item.folderId))) {
        throw new Error('文件夹已加密，或包含独立的加密子文件夹。');
      }
      const ids = tx.snapshot.papers.filter((record) =>
        (tx.snapshot.memberships[record.id] ?? []).some((id) => affected.has(id)),
      ).map((record) => record.id);
      tx.snapshot.vaults.push(vault);
      for (const id of ids) {
        const record = tx.snapshot.papers.find((item) => item.id === id)!;
        if (record.kind === 'encrypted') throw new Error('有文献已属于其他加密文件夹，请先解除原加密。');
        await this.sealPaper(tx, this.requirePaper(id, tx), vault.id, key);
      }
    });
    this.keys.set(vault.id, key);
    this.publish();
    return vault;
  }

  async unlockVault(vaultId: string, password: string): Promise<void> {
    await this.exclusive(async () => {
      await this.initialize();
      const vault = this.snapshot.vaults.find((item) => item.id === vaultId);
      if (!vault) throw new Error('加密文件夹不存在。');
      const key = await deriveVaultKey(password, vault.salt);
      const verifier = await decryptJson<string>(key, vault.verifier, `vault:${vault.folderId}`);
      if (verifier !== 'SmartReader library vault') throw new Error('密码错误或数据损坏。');
      const decrypted = new Map(this.decrypted);
      const snapshot = structuredClone(this.snapshot);
      let interrupted = false;
      for (const record of snapshot.papers) {
        if (record.kind === 'encrypted' && record.vaultId === vaultId) {
          const paper = await decryptJson<Paper>(key, record.encrypted, `paper:${record.id}`);
          if (paper.id !== record.id) throw new Error('加密文献标识不匹配。');
          if (!this.indexing.has(record.id) && recoverInterruptedWork(paper)) {
            record.encrypted = await encryptJson(key, paper, `paper:${record.id}`);
            interrupted = true;
          }
          decrypted.set(record.id, paper);
        }
      }
      if (interrupted) {
        this.revision = await this.storage.commit(this.revision, snapshot, []);
        this.snapshot = snapshot;
      }
      this.keys.set(vaultId, key);
      this.decrypted = decrypted;
      this.publish();
    });
  }

  async lockVault(vaultId: string): Promise<void> {
    const ids = this.snapshot.papers.filter((record) => record.kind === 'encrypted' && record.vaultId === vaultId)
      .map((record) => record.id);
    // Invalidate pending opens at request time, before awaiting the storage queue.
    this.invalidateAccess(ids);
    await this.exclusive(async () => {
      this.keys.delete(vaultId);
      for (const id of ids) this.decrypted.delete(id);
      this.notifyLocked(ids);
      this.publish();
    });
  }

  async decryptFolder(vaultId: string): Promise<void> {
    await this.mutate(async (tx) => {
      const key = this.keys.get(vaultId);
      if (!key) throw new Error('请先解锁文件夹。');
      for (const record of [...tx.snapshot.papers]) {
        if (record.kind !== 'encrypted' || record.vaultId !== vaultId) continue;
        const paper = this.requirePaper(record.id, tx);
        const bytes = await this.storage.readFile(record.id);
        tx.blobs.push({ id: record.id, bytes: await decryptFile(key, bytes, `pdf:${record.id}`) });
        tx.snapshot.papers[tx.snapshot.papers.findIndex((item) => item.id === record.id)] = {
          id: record.id, kind: 'plain', paper,
        };
        classifyPaper(tx.snapshot, paper);
        tx.decrypted.delete(record.id);
      }
      tx.snapshot.vaults = tx.snapshot.vaults.filter((vault) => vault.id !== vaultId);
    });
    this.keys.delete(vaultId);
    this.publish();
  }

  async savePreferences(updates: Partial<LibraryPreferences>): Promise<void> {
    await this.mutate((tx) => { tx.snapshot.preferences = { ...tx.snapshot.preferences, ...updates }; });
  }

  async recordFieldView(field: MetadataField): Promise<void> {
    await this.mutate((tx) => {
      const usage = tx.snapshot.preferences.fieldUsage;
      usage[field] = Math.min(1_000_000, (usage[field] ?? 0) + 1);
    });
  }

  async saveAiSettings(settings: AiSettings): Promise<void> {
    await this.mutate((tx) => { tx.snapshot.ai = structuredClone(settings); });
  }

  async saveBookmark(id: string, bookmark: Bookmark): Promise<Bookmark> {
    return this.mutate(async (tx) => {
      const paper = this.requirePaper(id, tx);
      const saved = { ...bookmark, id: bookmark.id ?? tx.snapshot.nextDecorationId--, documentKey: paperDocumentKey(id) };
      const bookmarks = paper.bookmarks.filter((item) => item.id !== saved.id);
      bookmarks.push(saved);
      await this.putPaper(tx, { ...paper, bookmarks });
      return saved;
    });
  }

  async saveAnnotation(id: string, annotation: ReaderAnnotation): Promise<ReaderAnnotation> {
    return this.mutate(async (tx) => {
      const paper = this.requirePaper(id, tx);
      const saved = { ...annotation, id: annotation.id ?? tx.snapshot.nextDecorationId--, documentKey: paperDocumentKey(id) };
      const annotations = paper.annotations.filter((item) => item.id !== saved.id);
      annotations.push(saved);
      await this.putPaper(tx, { ...paper, annotations });
      return saved;
    });
  }

  private requirePaper(id: string, tx?: LibraryTransaction): Paper {
    const record = (tx?.snapshot ?? this.snapshot).papers.find((item) => item.id === id);
    if (!record) throw new Error('文献不存在或已删除。');
    const paper = record.kind === 'plain' ? record.paper : (tx?.decrypted ?? this.decrypted).get(id);
    if (!paper) throw new Error('请先解锁该文献所在的加密文件夹。');
    return paper;
  }

  private async putPaper(tx: LibraryTransaction, paper: Paper) {
    const index = tx.snapshot.papers.findIndex((record) => record.id === paper.id);
    const record = tx.snapshot.papers[index];
    const saved = { ...paper, updatedAt: new Date().toISOString() };
    if (record.kind === 'plain') tx.snapshot.papers[index] = { ...record, paper: saved };
    else {
      const key = this.keys.get(record.vaultId);
      if (!key) throw new Error('请先解锁加密文件夹。');
      tx.snapshot.papers[index] = { ...record, encrypted: await encryptJson(key, saved, `paper:${paper.id}`) };
      tx.decrypted.set(paper.id, saved);
    }
  }

  private async sealPaper(tx: LibraryTransaction, paper: Paper, vaultId: string, key: CryptoKey) {
    const pending = tx.blobs.find((blob) => blob.id === paper.id);
    const bytes = pending?.bytes ?? await this.storage.readFile(paper.id);
    const encryptedBytes = await encryptFile(key, bytes, `pdf:${paper.id}`);
    if (pending) pending.bytes = encryptedBytes;
    else tx.blobs.push({ id: paper.id, bytes: encryptedBytes });
    const index = tx.snapshot.papers.findIndex((record) => record.id === paper.id);
    tx.snapshot.papers[index] = { id: paper.id, kind: 'encrypted', vaultId, encrypted: await encryptJson(key, paper, `paper:${paper.id}`) };
    tx.decrypted.set(paper.id, paper);
    // Automatic folder names contain inferred paper information. Keep explicit
    // user assignments and vault membership, but remove inferred public links.
    const automatic = new Set(tx.snapshot.automaticMemberships[paper.id] ?? []);
    tx.snapshot.memberships[paper.id] = (tx.snapshot.memberships[paper.id] ?? []).filter((folderId) =>
      !automatic.has(folderId) || folderVaultId(tx.snapshot, folderId) === vaultId,
    );
    tx.snapshot.automaticMemberships[paper.id] = [];
    pruneEmptyAutomaticFolders(tx.snapshot);
  }

  private mutate<T>(operation: (tx: LibraryTransaction) => T | Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.initialize();
      const tx: LibraryTransaction = {
        snapshot: structuredClone(this.snapshot), decrypted: new Map(this.decrypted), blobs: [],
      };
      const result = await operation(tx);
      tx.snapshot.updatedAt = new Date().toISOString();
      const revision = await this.storage.commit(this.revision, tx.snapshot, tx.blobs);
      this.revision = revision;
      this.snapshot = tx.snapshot;
      this.decrypted = tx.decrypted;
      this.publish();
      return result;
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    // A rejected operation is reported to its caller but must not poison later saves.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private notifyLocked(ids: string[]) {
    for (const listener of this.lockedListeners) listener(ids);
  }

  private invalidateAccess(ids: string[]) {
    this.accessEpoch += 1;
    for (const id of ids) {
      this.indexing.get(id)?.controller.abort(new Error('索引已中断，解锁后可重试。'));
      this.indexing.delete(id);
    }
  }

  private publish(error: string | null = null) {
    const papers = this.snapshot.papers.flatMap((record) => {
      const paper = record.kind === 'plain' ? record.paper : this.decrypted.get(record.id);
      return paper ? [paper] : [];
    });
    this.searchIndex.rebuild(papers);
    this.view = {
      loaded: this.loaded, error, snapshot: this.snapshot, papers,
      lockedPaperIds: this.snapshot.papers.filter((record) => record.kind === 'encrypted' && !this.decrypted.has(record.id))
        .map((record) => record.id),
      unlockedVaultIds: [...this.keys.keys()],
    };
    for (const listener of this.listeners) listener();
  }
}

function mergeMetadata(paper: Paper, updates: Partial<PaperMetadata>): PaperMetadata {
  const metadata = { ...paper.metadata };
  for (const field of Object.keys(updates) as MetadataField[]) {
    if (paper.manualFields.includes(field)) continue;
    const value = updates[field];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    Object.assign(metadata, { [field]: value });
  }
  return metadata;
}

function normalizeMetadata(updates: Partial<PaperMetadata>): Partial<PaperMetadata> {
  const result: Partial<PaperMetadata> = {};
  const allowed = emptyMetadata();
  for (const field of Object.keys(updates) as MetadataField[]) {
    if (!Object.hasOwn(allowed, field)) continue;
    const value = updates[field];
    if (Array.isArray(allowed[field])) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string') || value.length > 100) {
        throw new Error('作者、关键词和分类信息需为有效文本列表。');
      }
      Object.assign(result, { [field]: [...new Set(value.map((item) => item.trim()).filter(Boolean))] });
    } else {
      if (typeof value !== 'string' || value.length > 30_000) throw new Error('文献信息格式无效或过长。');
      Object.assign(result, { [field]: value.trim() });
    }
  }
  if (result.title !== undefined && !result.title) throw new Error('论文标题不能为空。');
  if (result.year && !/^(1[6-9]|20|21)\d{2}$/.test(result.year)) throw new Error('发表年份需为四位年份。');
  if (result.doi) {
    result.doi = result.doi.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
    if (!/^10\.\d{4,9}\/\S+$/i.test(result.doi)) throw new Error('DOI 格式应为 10.xxxx/xxx。');
  }
  return result;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pruneEmptyAutomaticFolders(snapshot: LibrarySnapshot) {
  let removed = true;
  while (removed) {
    removed = false;
    const used = new Set(Object.values(snapshot.memberships).flat());
    snapshot.folders = snapshot.folders.filter((folder) => {
      const keep = !folder.automatic || used.has(folder.id)
        || snapshot.folders.some((child) => child.parentId === folder.id)
        || snapshot.vaults.some((vault) => vault.folderId === folder.id);
      if (!keep) removed = true;
      return keep;
    });
  }
}

function recoverInterruptedWork(paper: Paper): boolean {
  let changed = false;
  if (paper.indexStatus === 'pending') {
    paper.indexStatus = 'error';
    paper.indexError = '上次索引已中断，请重新建立索引。';
    changed = true;
  }
  if (paper.aiStatus === 'pending') {
    paper.aiStatus = 'error';
    paper.aiError = '上次 AI 处理已中断，请重试。';
    changed = true;
  }
  return changed;
}
