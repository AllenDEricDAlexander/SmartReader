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
    expect(invoke).toHaveBeenCalledWith('write_library_storage', {
      expectedRevision: 4,
      data: snapshot,
      blobs: [
        { id: 'paper-file', bytes: [37, 80, 68, 70, 45] },
        { id: 'deleted-file', bytes: null },
        { id: 'empty-file', bytes: [] },
      ],
    });
    expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
  });

  it('sends an empty file mutation list for metadata-only commits', async () => {
    const invoke = vi.fn().mockResolvedValue(6);
    const storage = createLibraryStorage(invoke);

    await storage.commit(5, snapshot, []);
    expect(invoke).toHaveBeenCalledWith('write_library_storage', {
      expectedRevision: 5,
      data: snapshot,
      blobs: [],
    });
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
