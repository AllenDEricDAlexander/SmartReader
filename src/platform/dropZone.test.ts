import { describe, expect, it } from 'vitest';
import { getPdfFilesFromDrop } from './dropZone';

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
});
