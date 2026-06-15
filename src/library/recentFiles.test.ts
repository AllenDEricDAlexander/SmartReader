import { describe, expect, it } from 'vitest';
import { mapDocumentsToRecentFiles, sortRecentFiles } from './recentFiles';

describe('recentFiles', () => {
  it('maps persisted documents into recent file cards', () => {
    const cards = mapDocumentsToRecentFiles([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 10,
        lastPage: 5,
        progress: 0.5,
        missing: false,
      },
    ]);

    expect(cards).toEqual([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        title: 'book.pdf',
        path: '/tmp/book.pdf',
        progressLabel: '50%',
        lastPageLabel: 'Page 5',
        missing: false,
      },
    ]);
  });

  it('keeps missing files visible at the end', () => {
    const sorted = sortRecentFiles([
      {
        documentKey: 'missing',
        title: 'missing.pdf',
        path: '/tmp/missing.pdf',
        progressLabel: '0%',
        lastPageLabel: 'Page 1',
        missing: true,
      },
      {
        documentKey: 'ok',
        title: 'ok.pdf',
        path: '/tmp/ok.pdf',
        progressLabel: '20%',
        lastPageLabel: 'Page 2',
        missing: false,
      },
    ]);

    expect(sorted.map((file) => file.documentKey)).toEqual(['ok', 'missing']);
  });
});
