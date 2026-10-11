import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Invoke } from '../persistence/persistenceApi';
import { toPdfBytes } from '../platform/tauriBridge';
import type { LibrarySnapshot } from './libraryModels';

export type LibraryStorageRecord = {
  revision: number;
  data: LibrarySnapshot | null;
};

export type LibraryFileWrite = {
  id: string;
  bytes: Uint8Array | null;
};

/**
 * Storage boundary shared by the desktop implementation and future transports.
 * A commit must atomically check the revision and save metadata and file changes.
 */
export type LibraryStorage = {
  load(): Promise<LibraryStorageRecord>;
  commit(
    expectedRevision: number,
    data: LibrarySnapshot,
    blobs: LibraryFileWrite[],
  ): Promise<number>;
  readFile(id: string): Promise<Uint8Array>;
};

export function createLibraryStorage(invoke: Invoke = tauriInvoke): LibraryStorage {
  return {
    load() {
      return invoke<LibraryStorageRecord>('read_library_storage');
    },
    commit(expectedRevision, data, blobs) {
      return invoke<number>('write_library_storage', {
        expectedRevision,
        data,
        blobs: blobs.map(({ id, bytes }) => ({
          id,
          bytes: bytes === null ? null : Array.from(bytes),
        })),
      });
    },
    async readFile(id) {
      const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>('read_library_file', { id });
      return toPdfBytes(bytes);
    },
  };
}
