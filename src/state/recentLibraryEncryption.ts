import type {
  RecentLibraryCategory,
  RecentDocumentMetadata,
  RecentLibraryEncryptedFolder,
  RecentLibraryMetadata,
  RecentLibraryTag
} from "./recentLibrary";
import { lockedCategoryName, redactEncryptedMetadata } from "./recentLibrary";
import { appSessionKey } from "./sessionPersistence";
import { smartReaderCacheKey } from "./smartReaderCache";
import type {
  AppSessionSnapshot,
  PersistedDocumentSession,
  RecentFile,
  SmartReaderCacheEnvelope,
  SmartReaderReadingProgress,
  SmartReaderSearchIndexMetadata
} from "../types/reader";

const lockedRecentPathPrefix = "smartreader-locked://";
const protectedFolderIdPrefix = "protected-folder-";
const recentLibraryStorageKey = "smartreader.recentLibrary.v1";
const recentFilesStorageKey = "smartreader.recentFiles.v1";
const keyIterations = 120_000;
const encryptionVersion = 1;

interface FolderEncryptionPayload {
  schemaVersion: 1;
  categoryId: string;
  categories: RecentLibraryCategory[];
  tags: RecentLibraryTag[];
  documents: Record<string, RecentDocumentMetadata>;
  recentFiles: RecentFile[];
  appSessionTabs: PersistedDocumentSession[];
  cacheReadingProgress: SmartReaderReadingProgress[];
  cacheSearchIndexes: SmartReaderSearchIndexMetadata[];
}

export interface ProtectedPlaintextStorageSnapshot {
  recentLibrary: string | null;
  recentFiles: string | null;
  appSession: string | null;
  cache: string | null;
}

export async function enableCategoryEncryption(input: {
  library: RecentLibraryMetadata;
  categoryId: string;
  password: string;
  recentFiles: RecentFile[];
  storage?: Storage;
}): Promise<{ library: RecentLibraryMetadata; recentFiles: RecentFile[]; protectedPaths: string[] }> {
  if (!input.password) {
    throw new Error("Folder password is required.");
  }

  const storage = input.storage ?? localStorage;
  const categoryIds = categoryDescendantIds(input.library, input.categoryId);
  const categoryIdSet = new Set(categoryIds);
  const protectedPaths = Object.entries(input.library.documents)
    .filter(([, metadata]) => metadata.categoryIds.some((categoryId) => categoryIds.includes(categoryId)))
    .map(([path]) => path);

  if (protectedPaths.length === 0) {
    throw new Error("Folder has no managed SmartReader documents to encrypt.");
  }

  const protectedPathSet = new Set(protectedPaths);
  const pathHashes = await Promise.all(protectedPaths.map(hashPath));
  const protectedRecentFiles = input.recentFiles.filter((file) => protectedPathSet.has(file.path));
  const appSessionTabs = protectedAppSessionTabs(storage, protectedPathSet);
  const cache = readCacheEnvelope(storage);
  const cacheReadingProgress = cache?.readingProgress.filter((progress) =>
    protectedPathSet.has(progress.path ?? progress.documentId)
  ) ?? [];
  const cacheSearchIndexes = cache?.adapterCache.searchIndexes.filter((index) =>
    protectedPathSet.has(index.path ?? index.documentId)
  ) ?? [];
  const protectedTagIds = protectedPrivateTagIds(input.library, protectedPaths);
  const protectedFolderId = createProtectedFolderId();
  const payload: FolderEncryptionPayload = {
    schemaVersion: encryptionVersion,
    categoryId: input.categoryId,
    categories: input.library.categories.filter((category) => categoryIdSet.has(category.id)),
    tags: input.library.tags.filter((tag) => protectedTagIds.has(tag.id)),
    documents: Object.fromEntries(
      protectedPaths.map((path) => [path, input.library.documents[path]])
    ),
    recentFiles: protectedRecentFiles,
    appSessionTabs,
    cacheReadingProgress,
    cacheSearchIndexes
  };
  const salt = randomBytes(16);
  const key = await deriveFolderKey(input.password, salt);
  const verifier = await encryptJson(key, {
    schemaVersion: encryptionVersion,
    categoryId: protectedFolderId,
    verifier: "smartreader-folder"
  });
  const encryptedPayload = await encryptJson(key, payload);
  const encryptedFolder: RecentLibraryEncryptedFolder = {
    categoryId: protectedFolderId,
    categoryIds,
    tagIds: Array.from(protectedTagIds),
    pathHashes,
    salt: bytesToBase64(salt),
    verifierIv: verifier.iv,
    verifierData: verifier.data,
    payloadIv: encryptedPayload.iv,
    payloadData: encryptedPayload.data,
    lockedAt: Date.now()
  };
  const documents = { ...input.library.documents };
  protectedPaths.forEach((path) => {
    delete documents[path];
  });
  const recentFiles = await Promise.all(
    input.recentFiles.map(async (file) =>
      protectedPathSet.has(file.path)
        ? createLockedRecentFile(file, protectedFolderId, await hashPath(file.path))
        : file
    )
  );
  const library = redactEncryptedMetadata({
    ...input.library,
    documents,
    encryptedFolders: {
      ...(input.library.encryptedFolders ?? {}),
      [protectedFolderId]: encryptedFolder
    }
  });

  sanitizeAppSessionStorage(storage, protectedPathSet);
  sanitizeCacheStorage(storage, protectedPathSet, recentFiles);

  return { library, recentFiles, protectedPaths };
}

export async function unlockCategoryEncryption(input: {
  library: RecentLibraryMetadata;
  categoryId: string;
  password: string;
  recentFiles: RecentFile[];
}): Promise<{ library: RecentLibraryMetadata; recentFiles: RecentFile[]; protectedPaths: string[] }> {
  const encryptedFolder = input.library.encryptedFolders?.[input.categoryId];

  if (!encryptedFolder) {
    throw new Error("Folder is not encrypted.");
  }

  const key = await deriveFolderKey(input.password, base64ToBytes(encryptedFolder.salt));
  try {
    await decryptJson(key, encryptedFolder.verifierIv, encryptedFolder.verifierData);
  } catch {
    throw new Error("Folder password is incorrect.");
  }

  const payload = await decryptJson<FolderEncryptionPayload>(key, encryptedFolder.payloadIv, encryptedFolder.payloadData);
  const restoredByHash = new Map<string, RecentFile>();
  await Promise.all(payload.recentFiles.map(async (file) => {
    const pathHash = await hashPath(file.path);
    restoredByHash.set(pathHash, {
      ...file,
      protection: {
        encryptedCategoryId: input.categoryId,
        pathHash
      }
    });
  }));

  return {
    library: {
      ...input.library,
      categories: mergeById(
        input.library.categories.filter((category) => category.id !== input.categoryId),
        payload.categories ?? []
      ),
      tags: mergeById(input.library.tags, payload.tags ?? []),
      documents: {
        ...input.library.documents,
        ...payload.documents
      },
      encryptedFolders: {
        ...(input.library.encryptedFolders ?? {}),
        [input.categoryId]: {
          ...encryptedFolder,
          categoryIds: categoryDescendantIds({
            ...input.library,
            categories: payload.categories ?? []
          }, payload.categoryId),
          tagIds: (payload.tags ?? []).map((tag) => tag.id)
        }
      }
    },
    recentFiles: input.recentFiles.map((file) => {
      if (!isLockedRecentFile(file)) {
        return file;
      }

      return restoredByHash.get(lockedRecentHash(file)) ?? file;
    }),
    protectedPaths: Object.keys(payload.documents)
  };
}

export async function resealCategoryEncryption(input: {
  library: RecentLibraryMetadata;
  categoryId: string;
  password: string;
  recentFiles: RecentFile[];
  storage?: Storage;
}): Promise<{ library: RecentLibraryMetadata; recentFiles: RecentFile[]; protectedPaths: string[] }> {
  const encryptedFolder = input.library.encryptedFolders?.[input.categoryId];

  if (!encryptedFolder) {
    return { library: input.library, recentFiles: input.recentFiles, protectedPaths: [] };
  }

  const key = await deriveFolderKey(input.password, base64ToBytes(encryptedFolder.salt));
  await decryptJson(key, encryptedFolder.verifierIv, encryptedFolder.verifierData);
  const currentPayload = await decryptJson<FolderEncryptionPayload>(
    key,
    encryptedFolder.payloadIv,
    encryptedFolder.payloadData
  );

  const payloadCategoryId = currentPayload.categoryId;
  const categoryIds = categoryDescendantIds(input.library, payloadCategoryId);
  const categoryIdSet = new Set(categoryIds);
  const protectedPaths = Object.entries(input.library.documents)
    .filter(([, metadata]) => metadata.categoryIds.some((categoryId) => categoryIds.includes(categoryId)))
    .map(([path]) => path);

  const storage = input.storage ?? localStorage;
  const protectedPathSet = new Set(protectedPaths);
  const protectedTagIds = protectedPrivateTagIds(input.library, protectedPaths);
  const protectedPathHashes = new Map<string, string>();
  await Promise.all(protectedPaths.map(async (path) => {
    protectedPathHashes.set(path, await hashPath(path));
  }));
  const recentFiles = input.recentFiles.map((file) => {
    const pathHash = protectedPathHashes.get(file.path);

    if (pathHash) {
      return {
        ...file,
        protection: {
          encryptedCategoryId: input.categoryId,
          pathHash
        }
      };
    }

    if (file.protection?.encryptedCategoryId === input.categoryId) {
      const { protection: _protection, ...unprotectedFile } = file;

      return unprotectedFile;
    }

    return file;
  });

  if (protectedPaths.length === 0) {
    const encryptedFolders = { ...(input.library.encryptedFolders ?? {}) };
    delete encryptedFolders[input.categoryId];

    return {
      library: {
        ...input.library,
        encryptedFolders
      },
      recentFiles,
      protectedPaths: []
    };
  }

  const payload: FolderEncryptionPayload = {
    schemaVersion: encryptionVersion,
    categoryId: payloadCategoryId,
    categories: input.library.categories.filter((category) => categoryIdSet.has(category.id)),
    tags: input.library.tags.filter((tag) => protectedTagIds.has(tag.id)),
    documents: Object.fromEntries(
      protectedPaths.map((path) => [path, input.library.documents[path]])
    ),
    recentFiles: recentFiles.filter((file) => protectedPathSet.has(file.path)),
    appSessionTabs: protectedAppSessionTabs(storage, protectedPathSet),
    cacheReadingProgress: recentFiles
      .filter((file) => protectedPathSet.has(file.path))
      .map((file) => ({
        documentId: file.id,
        title: file.title,
        path: file.path,
        format: file.format,
        location: file.location,
        updatedAt: file.lastOpenedAt
      })),
    cacheSearchIndexes: []
  };
  const encryptedPayload = await encryptJson(key, payload);
  const library = {
    ...input.library,
    encryptedFolders: {
      ...(input.library.encryptedFolders ?? {}),
      [input.categoryId]: {
        ...encryptedFolder,
        categoryIds,
        tagIds: Array.from(protectedTagIds),
        pathHashes: protectedPaths.map((path) => protectedPathHashes.get(path) ?? ""),
        payloadIv: encryptedPayload.iv,
        payloadData: encryptedPayload.data
      }
    }
  };

  sanitizeAppSessionStorage(storage, protectedPathSet);
  sanitizeCacheStorage(storage, protectedPathSet, redactProtectedRecentFilesForStorage(recentFiles));

  return { library, recentFiles, protectedPaths };
}

export function isLockedRecentFile(file: RecentFile): boolean {
  return file.path.startsWith(lockedRecentPathPrefix);
}

export function redactProtectedRecentFilesForStorage(recentFiles: RecentFile[]): RecentFile[] {
  return recentFiles.map((file) => file.protection
    ? createLockedRecentFile(file, file.protection.encryptedCategoryId, file.protection.pathHash)
    : file);
}

export function sanitizeProtectedPlaintextStorage(input: {
  protectedPaths: string[];
  recentFiles: RecentFile[];
  storage?: Storage;
}): void {
  const storage = input.storage ?? localStorage;
  const protectedPathSet = new Set(input.protectedPaths);
  const safeRecentFiles = input.recentFiles.filter((file) => !protectedPathSet.has(file.path));
  const redactedRecentFiles = redactProtectedRecentFilesForStorage(safeRecentFiles);

  storage.setItem(recentFilesStorageKey, JSON.stringify(redactedRecentFiles));
  sanitizeAppSessionStorage(storage, protectedPathSet);
  sanitizeCacheStorage(storage, protectedPathSet, redactedRecentFiles);
}

export function removeRecentLibraryEntriesForDeletedFiles(input: {
  library: RecentLibraryMetadata;
  removedRecentFiles: RecentFile[];
  remainingRecentFiles: RecentFile[];
  pruneDocuments?: boolean;
}): RecentLibraryMetadata {
  const removedDocumentPaths = input.pruneDocuments === false
    ? new Set<string>()
    : new Set(input.removedRecentFiles
      .filter((file) => !isLockedRecentFile(file))
      .map((file) => file.path));
  const removedFolderIds = new Set(input.removedRecentFiles
    .map(encryptedCategoryIdForRecentFile)
    .filter((categoryId): categoryId is string => typeof categoryId === "string"));
  const remainingFolderIds = new Set(input.remainingRecentFiles
    .map(encryptedCategoryIdForRecentFile)
    .filter((categoryId): categoryId is string => typeof categoryId === "string"));
  const encryptedFolders = { ...(input.library.encryptedFolders ?? {}) };
  const removedEncryptedFolderIds = new Set<string>();

  removedFolderIds.forEach((categoryId) => {
    if (remainingFolderIds.has(categoryId)) {
      return;
    }

    delete encryptedFolders[categoryId];
    removedEncryptedFolderIds.add(categoryId);
  });

  return {
    ...input.library,
    categories: input.library.categories.filter((category) =>
      !removedEncryptedFolderIds.has(category.id) || category.name !== lockedCategoryName
    ),
    documents: Object.fromEntries(
      Object.entries(input.library.documents).filter(([path]) => !removedDocumentPaths.has(path))
    ),
    encryptedFolders
  };
}

export function snapshotProtectedPlaintextStorage(storage: Storage = localStorage): ProtectedPlaintextStorageSnapshot {
  return {
    recentLibrary: storage.getItem(recentLibraryStorageKey),
    recentFiles: storage.getItem(recentFilesStorageKey),
    appSession: storage.getItem(appSessionKey),
    cache: storage.getItem(smartReaderCacheKey)
  };
}

export function restoreProtectedPlaintextStorageSnapshot(input: {
  snapshot: ProtectedPlaintextStorageSnapshot;
  protectedPaths: string[];
  storage?: Storage;
}): void {
  const storage = input.storage ?? localStorage;
  const protectedPathSet = new Set(input.protectedPaths);
  const recentFiles = safeRecentFilesFromSnapshot(input.snapshot.recentFiles, protectedPathSet);

  restoreStorageValue(storage, recentLibraryStorageKey, input.snapshot.recentLibrary);
  if (input.snapshot.recentFiles === null) {
    storage.removeItem(recentFilesStorageKey);
  } else {
    storage.setItem(recentFilesStorageKey, JSON.stringify(recentFiles));
  }
  restoreStorageValue(storage, appSessionKey, input.snapshot.appSession);
  sanitizeAppSessionStorage(storage, protectedPathSet);
  restoreStorageValue(storage, smartReaderCacheKey, input.snapshot.cache);
  if (readCacheEnvelope(storage)) {
    sanitizeCacheStorage(storage, protectedPathSet, recentFiles);
  } else {
    storage.removeItem(smartReaderCacheKey);
  }
}

function createLockedRecentFile(file: RecentFile, categoryId: string, pathHash: string): RecentFile {
  return {
    id: `locked:${categoryId}:${pathHash}`,
    title: "Locked document",
    path: `${lockedRecentPathPrefix}${categoryId}/${pathHash}`,
    parentPath: "Encrypted folder",
    format: file.format,
    access: file.access,
    lastOpenedAt: file.lastOpenedAt,
    resumeLabel: "Locked",
    location: { kind: "none" }
  };
}

function safeRecentFilesFromSnapshot(raw: string | null, protectedPathSet: Set<string>): RecentFile[] {
  try {
    const parsed = raw ? JSON.parse(raw) as RecentFile[] : [];
    const recentFiles = Array.isArray(parsed) ? parsed : [];

    return redactProtectedRecentFilesForStorage(recentFiles)
      .filter((file) => !protectedPathSet.has(file.path));
  } catch {
    return [];
  }
}

function restoreStorageValue(storage: Storage, key: string, value: string | null): void {
  if (value === null) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, value);
}

function createProtectedFolderId(): string {
  return `${protectedFolderIdPrefix}${bytesToHex(randomBytes(16))}`;
}

function protectedPrivateTagIds(library: RecentLibraryMetadata, protectedPaths: string[]): Set<string> {
  const privateTagIds = new Set(library.tags.filter((tag) => !tag.builtIn).map((tag) => tag.id));
  const protectedTagIds = new Set<string>();

  protectedPaths.forEach((path) => {
    library.documents[path]?.tagIds.forEach((tagId) => {
      if (privateTagIds.has(tagId)) {
        protectedTagIds.add(tagId);
      }
    });
  });

  return protectedTagIds;
}

function mergeById<T extends { id: string }>(current: T[], restored: T[]): T[] {
  const restoredById = new Map(restored.map((item) => [item.id, item]));
  const merged = current.map((item) => restoredById.get(item.id) ?? item);
  const currentIds = new Set(current.map((item) => item.id));

  return [
    ...merged,
    ...restored.filter((item) => !currentIds.has(item.id))
  ];
}

function lockedRecentHash(file: RecentFile): string {
  return file.path.slice(file.path.lastIndexOf("/") + 1);
}

function encryptedCategoryIdForRecentFile(file: RecentFile): string | undefined {
  if (file.protection) {
    return file.protection.encryptedCategoryId;
  }

  if (!isLockedRecentFile(file)) {
    return undefined;
  }

  const withoutScheme = file.path.replace(lockedRecentPathPrefix, "");
  const separatorIndex = withoutScheme.indexOf("/");

  return separatorIndex > 0 ? withoutScheme.slice(0, separatorIndex) : undefined;
}

function protectedAppSessionTabs(storage: Storage, protectedPathSet: Set<string>): PersistedDocumentSession[] {
  try {
    const raw = storage.getItem(appSessionKey);
    const snapshot = raw ? JSON.parse(raw) as AppSessionSnapshot : undefined;

    return Array.isArray(snapshot?.sessions)
      ? snapshot.sessions.filter((session) => sessionPath(session) && protectedPathSet.has(sessionPath(session) ?? ""))
      : [];
  } catch {
    return [];
  }
}

function sanitizeAppSessionStorage(storage: Storage, protectedPathSet: Set<string>): void {
  try {
    const raw = storage.getItem(appSessionKey);
    const snapshot = raw ? JSON.parse(raw) as AppSessionSnapshot : undefined;

    if (!snapshot || !Array.isArray(snapshot.sessions)) {
      return;
    }

    const sessions = snapshot.sessions.filter((session) => {
      const path = sessionPath(session);

      return !path || !protectedPathSet.has(path);
    });
    storage.setItem(appSessionKey, JSON.stringify({
      ...snapshot,
      activeTabId: sessions.some((session) => session.id === snapshot.activeTabId)
        ? snapshot.activeTabId
        : sessions[0]?.id ?? "",
      sessions
    }));
  } catch {
    storage.removeItem(appSessionKey);
  }
}

function sanitizeCacheStorage(storage: Storage, protectedPathSet: Set<string>, recentFiles: RecentFile[]): void {
  const cache = readCacheEnvelope(storage);

  if (!cache) {
    return;
  }

  storage.setItem(smartReaderCacheKey, JSON.stringify({
    ...cache,
    recentFiles,
    readingProgress: cache.readingProgress.filter((progress) =>
      !protectedPathSet.has(progress.path ?? progress.documentId)
    ),
    session: {
      ...cache.session,
      activeTabId: cache.session.tabs.some((tab) => tab.id === cache.session.activeTabId && !isProtectedTab(tab, protectedPathSet))
        ? cache.session.activeTabId
        : "",
      tabs: cache.session.tabs.filter((tab) => !isProtectedTab(tab, protectedPathSet))
    },
    adapterCache: {
      ...cache.adapterCache,
      searchIndexes: cache.adapterCache.searchIndexes.filter((index) =>
        !protectedPathSet.has(index.path ?? index.documentId)
      )
    }
  }));
}

function readCacheEnvelope(storage: Storage): SmartReaderCacheEnvelope | undefined {
  try {
    const raw = storage.getItem(smartReaderCacheKey);

    return raw ? JSON.parse(raw) as SmartReaderCacheEnvelope : undefined;
  } catch {
    return undefined;
  }
}

function isProtectedTab(tab: PersistedDocumentSession, protectedPathSet: Set<string>): boolean {
  const path = sessionPath(tab);

  return Boolean(path && protectedPathSet.has(path));
}

function sessionPath(session: PersistedDocumentSession): string | undefined {
  return session.filePath ?? (session.fileSource.kind === "desktop-path" ? session.fileSource.path : undefined);
}

function categoryDescendantIds(library: RecentLibraryMetadata, rootId: string): string[] {
  const ids = [rootId];
  for (let index = 0; index < ids.length; index += 1) {
    library.categories
      .filter((category) => category.parentId === ids[index])
      .forEach((category) => {
        if (!ids.includes(category.id)) {
          ids.push(category.id);
        }
      });
  }

  return ids;
}

async function hashPath(path: string): Promise<string> {
  const bytes = await cryptoSubtle().digest("SHA-256", new TextEncoder().encode(path));

  return bytesToHex(new Uint8Array(bytes));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveFolderKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = cryptoSubtle();
  const passwordKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToBufferSource(salt),
      iterations: keyIterations
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: string; data: string }> {
  const iv = randomBytes(12);
  const encrypted = await cryptoSubtle().encrypt(
    { name: "AES-GCM", iv: bytesToBufferSource(iv) },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );

  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptJson<T>(key: CryptoKey, iv: string, data: string): Promise<T> {
  const decrypted = await cryptoSubtle().decrypt(
    { name: "AES-GCM", iv: bytesToBufferSource(base64ToBytes(iv)) },
    key,
    bytesToBufferSource(base64ToBytes(data))
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  cryptoSubtle();
  globalThis.crypto.getRandomValues(bytes);

  return bytes;
}

function cryptoSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new Error("WebCrypto is unavailable.");
  }

  return subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });

  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return bytes;
}

function bytesToBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
