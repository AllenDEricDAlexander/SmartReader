import { describe, expect, it } from 'vitest';
import { fileToBrowserSource, isBrowserPdfFile } from './browserFilePicker';

describe('browserFilePicker', () => {
  it('accepts PDF files by mime type or extension', () => {
    expect(isBrowserPdfFile(new File(['x'], 'a.pdf', { type: '' }))).toBe(true);
    expect(isBrowserPdfFile(new File(['x'], 'a.bin', { type: 'application/pdf' }))).toBe(true);
    expect(isBrowserPdfFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });

  it('creates browser file sources', () => {
    const file = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });

    expect(fileToBrowserSource(file)).toEqual({
      kind: 'browser-file',
      file,
      name: 'paper.pdf',
    });
  });
});
