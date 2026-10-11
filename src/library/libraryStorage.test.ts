import { describe, expect, it, vi } from 'vitest';
import { emptyLibrary } from './libraryModels';
import { createLibraryStorage } from './libraryStorage';

const snapshot = emptyLibrary();

describe('library storage', () => {
  it('loads the revision and nullable library snapshot from desktop storage', async () => {
    const invoke = vi.fn().mockResolvedValue({ revision: 0, data: null });
    const storage = createLibraryStorage(invoke);

    await expect(storage.load()).resolves.toEqual({ revision: 0, data: null });
    expect(invoke).toHaveBeenCalledWith('read_library_storage');
    invoke.mockResolvedValueOnce({ revision: 4, data: snapshot });
    await expect(storage.load()).resolves.toEqual({ revision: 4, data: snapshot });
  });

  it('commits the expected revision with exact binary writes and explicit file deletions', async () => {
    const invoke = vi.fn().mockResolvedValue(5);
    const storage = createLibraryStorage(invoke);
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);

    await expect(storage.commit(4, snapshot, [
      { id: 'paper-file', bytes },
      { id: 'deleted-file', bytes: null },
      { id: 'empty-file', bytes: new Uint8Array() },
    ])).resolves.toBe(5);
    expect(invoke.mock.calls[0][0]).toBe('write_library_storage_binary');
    const packet = invoke.mock.calls[0][1] as Uint8Array;
    expect(Array.from(packet.subarray(0, 4))).toEqual([83, 82, 76, 49]);
    const length = new DataView(packet.buffer).getUint32(4);
    const manifest = JSON.parse(new TextDecoder().decode(packet.subarray(8, 8 + length)));
    expect(manifest).toEqual({
      expectedRevision: 4,
      data: snapshot,
      blobs: [
        { id: 'paper-file', byteLength: 5 },
        { id: 'deleted-file', byteLength: null },
        { id: 'empty-file', byteLength: 0 },
      ],
    });
    expect(Array.from(packet.subarray(8 + length))).toEqual(Array.from(bytes));
    expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
  });

  it('sends an empty file mutation list for metadata-only commits', async () => {
    const invoke = vi.fn().mockResolvedValue(6);
    const storage = createLibraryStorage(invoke);

    await storage.commit(5, snapshot, []);
    const packet = invoke.mock.calls[0][1] as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(packet.subarray(8)))).toEqual({
      expectedRevision: 5,
      data: snapshot,
      blobs: [],
    });
  });

  it('keeps file payload size linear and encodes a byte view without unrelated bytes', async () => {
    const invoke = vi.fn().mockResolvedValue(1);
    const backing = new Uint8Array(2 * 1024 * 1024 + 4).fill(255);
    const bytes = backing.subarray(2, backing.length - 2);
    await createLibraryStorage(invoke).commit(0, { ...snapshot, updatedAt: '中文元数据 🧠' }, [{ id: 'large', bytes }]);
    const packet = invoke.mock.calls[0][1] as Uint8Array;
    const length = new DataView(packet.buffer).getUint32(4);
    expect(packet.byteLength).toBe(8 + length + bytes.byteLength);
    expect(packet.byteLength).toBeLessThan(bytes.byteLength + 1024);
    expect(JSON.parse(new TextDecoder().decode(packet.subarray(8, 8 + length))).data.updatedAt).toBe('中文元数据 🧠');
    expect(packet.at(-1)).toBe(255);
  });

  it('rejects invalid revisions and too many file mutations before allocating or invoking', async () => {
    const invoke = vi.fn();
    const storage = createLibraryStorage(invoke);
    await expect(storage.commit(-1, snapshot, [])).rejects.toThrow('版本');
    await expect(storage.commit(0, snapshot, Array.from({ length: 513 }, (_, id) => ({ id: String(id), bytes: null })))).rejects.toThrow('512');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['ArrayBuffer', new Uint8Array([0, 128, 255]).buffer],
    ['Uint8Array', new Uint8Array([0, 128, 255])],
    ['number array', [0, 128, 255]],
  ])('reads native binary files transported as %s', async (_label, payload) => {
    const invoke = vi.fn().mockResolvedValue(payload);
    const storage = createLibraryStorage(invoke);

    await expect(storage.readFile('encrypted-paper')).resolves.toEqual(new Uint8Array([0, 128, 255]));
    expect(invoke).toHaveBeenCalledWith('read_library_file', { id: 'encrypted-paper' });
  });

  it('propagates revision conflicts without retrying or overwriting newer data', async () => {
    const conflict = new Error('library revision conflict');
    const invoke = vi.fn().mockRejectedValue(conflict);

    await expect(createLibraryStorage(invoke).commit(4, snapshot, [])).rejects.toBe(conflict);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('propagates native missing-file and storage failures', async () => {
    const missing = 'library file not found';
    const invoke = vi.fn().mockRejectedValue(missing);
    const storage = createLibraryStorage(invoke);

    await expect(storage.readFile('missing-file')).rejects.toBe(missing);
    const failure = new Error('database is unavailable');
    invoke.mockRejectedValueOnce(failure);
    await expect(storage.load()).rejects.toBe(failure);
  });
});
