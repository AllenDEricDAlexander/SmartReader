import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { toPdfBytes } from '../platform/tauriBridge';
import type { LibrarySnapshot } from './libraryModels';

type LibraryInvoke = <T>(command: string, args?: Record<string, unknown> | Uint8Array) => Promise<T>;

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

export function createLibraryStorage(invoke: LibraryInvoke = tauriInvoke): LibraryStorage {
  return {
    load() {
      return invoke<LibraryStorageRecord>('read_library_storage');
    },
    async commit(expectedRevision, data, blobs) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('文献库版本号无效，请重新加载文献库。');
      }
      if (blobs.length > 512) throw new Error('一次保存最多包含 512 份文件变更，请分批处理。');
      let totalBytes = 0;
      const ids = new Set<string>();
      for (const { id, bytes } of blobs) {
        if (!/^[A-Za-z0-9_:.-]{1,160}$/.test(id) || id.includes('..') || ids.has(id)) {
          throw new Error('文献文件标识无效或重复。');
        }
        ids.add(id);
        const size = bytes?.byteLength ?? 0;
        if (size > 256 * 1024 * 1024) throw new Error('单份受管文件不能超过 256 MiB。');
        totalBytes += size;
      }
      if (totalBytes > 512 * 1024 * 1024) throw new Error('一次保存的文件总大小不能超过 512 MiB，请分批处理。');
      const manifest = new TextEncoder().encode(JSON.stringify({
        expectedRevision,
        data,
        blobs: blobs.map(({ id, bytes }) => ({ id, byteLength: bytes?.byteLength ?? null })),
      }));
      if (manifest.byteLength > 64 * 1024 * 1024 + 512 * 200) throw new Error('文献库元数据超过本地存储容量限制。');
      // SRL1 + big-endian UTF-8 manifest length + manifest + raw file bytes.
      // Avoid expanding large PDFs into JSON number arrays across the webview IPC.
      const packet = new Uint8Array(8 + manifest.byteLength + totalBytes);
      packet.set([83, 82, 76, 49]);
      new DataView(packet.buffer).setUint32(4, manifest.byteLength);
      packet.set(manifest, 8);
      let offset = 8 + manifest.byteLength;
      for (const { bytes } of blobs) {
        if (bytes) { packet.set(bytes, offset); offset += bytes.byteLength; }
      }
      return invoke<number>('write_library_storage_binary', packet);
    },
    async readFile(id) {
      const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>('read_library_file', { id });
      return toPdfBytes(bytes);
    },
  };
}
