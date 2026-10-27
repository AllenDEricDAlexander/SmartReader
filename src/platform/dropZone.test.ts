import { describe, expect, it, vi } from 'vitest';
import { getPdfFilesFromDrop, hasDroppedDirectory, readDroppedPdfs } from './dropZone';

function fileEntry(file: File): FileSystemEntry {
  return { isFile: true, isDirectory: false, name: file.name, file: (resolve: (value: File) => void) => resolve(file) } as unknown as FileSystemEntry;
}

function directoryEntry(batches: FileSystemEntry[][]): FileSystemEntry {
  return {
    isFile: false, isDirectory: true, name: 'papers',
    createReader: () => ({ readEntries: vi.fn((resolve: (entries: FileSystemEntry[]) => void) => resolve(batches.shift() ?? [])) }),
  } as unknown as FileSystemEntry;
}

function dropData(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return { files, items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })) } as unknown as DataTransfer;
}

describe('dropZone', () => {
  it('returns only dropped PDF files', () => {
    const pdf = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    expect(getPdfFilesFromDrop([pdf, text])).toEqual([pdf]);
  });

  it('accepts PDFs with missing MIME type when the extension is pdf', () => {
    const pdf = new File(['%PDF-1.7'], 'paper.PDF', { type: '' });

    expect(getPdfFilesFromDrop([pdf])).toEqual([pdf]);
  });

  it('reads all directory batches and nested PDFs while ignoring other files', async () => {
    const first = new File(['%PDF-1.7'], 'first.pdf');
    const nested = new File(['%PDF-1.7'], 'nested.PDF');
    const last = new File(['%PDF-1.7'], 'last.pdf');
    const directory = directoryEntry([
      [fileEntry(first), fileEntry(new File(['notes'], 'notes.txt')), directoryEntry([[fileEntry(nested)]])],
      [fileEntry(last)],
    ]);
    const data = dropData([directory]);
    expect(hasDroppedDirectory(data)).toBe(true);
    await expect(readDroppedPdfs(data)).resolves.toEqual({ files: [first, nested, last], hasDirectories: true });
  });

  it('keeps plain PDFs as direct files and distinguishes an empty folder', async () => {
    const file = new File(['%PDF-1.7'], 'first.pdf');
    await expect(readDroppedPdfs(dropData([], [file]))).resolves.toEqual({ files: [file], hasDirectories: false });
    await expect(readDroppedPdfs(dropData([directoryEntry([])]))).resolves.toEqual({ files: [], hasDirectories: true });
  });

  it('captures drop entries before the browser clears the event data store', async () => {
    const file = new File(['%PDF-1.7'], 'nested.pdf');
    const data = dropData([directoryEntry([[fileEntry(file)]])]);
    const result = readDroppedPdfs(data);
    Object.defineProperty(data, 'items', { value: [] });
    Object.defineProperty(data, 'files', { value: [] });
    await expect(result).resolves.toEqual({ files: [file], hasDirectories: true });
  });

  it('enforces the existing folder depth and PDF count limits', async () => {
    let entry = directoryEntry([]);
    for (let depth = 0; depth < 21; depth += 1) entry = directoryEntry([[entry]]);
    await expect(readDroppedPdfs(dropData([entry]))).rejects.toThrow('20 层');
    const pdf = fileEntry(new File(['%PDF-1.7'], 'paper.pdf'));
    await expect(readDroppedPdfs(dropData([directoryEntry([Array.from({ length: 2001 }, () => pdf)])])))
      .rejects.toThrow('2000 份 PDF');
  });

  it('reports unreadable directories instead of silently importing an incomplete tree', async () => {
    const entry = {
      isDirectory: true, isFile: false,
      createReader: () => ({ readEntries: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('permission denied')) }),
    } as unknown as FileSystemEntry;
    await expect(readDroppedPdfs(dropData([entry]))).rejects.toThrow('permission denied');
  });
});
