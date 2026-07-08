import { describe, expect, it } from 'vitest';
import { mapDocumentsToRecentFiles, sortRecentFiles } from './recentFiles';

describe('recentFiles', () => {
  it('maps persisted documents into recent file cards', () => {
    const cards = mapDocumentsToRecentFiles([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 102400,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 10,
        lastPage: 5,
        progress: 0.5,
        missing: false,
        lastOpenedAt: null,
        tagIds: [],
      },
    ]);

    expect(cards).toEqual([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        title: 'book.pdf',
        path: '/tmp/book.pdf',
        progressLabel: '50%',
        lastPageLabel: 'Page 5',
        fileSizeLabel: '100 KB',
        modifiedAtLabel: '2026-06-15T00:00:00Z',
        missing: false,
      },
    ]);
  });

  it('maps rich recent file details', () => {
    expect(
      mapDocumentsToRecentFiles([
        {
          documentKey: 'desktop:/tmp/book.pdf',
          path: '/tmp/book.pdf',
          displayName: 'book.pdf',
          fileSize: 2048,
          modifiedAt: '2026-06-16T00:00:00Z',
          pageCount: 20,
          lastPage: 5,
          progress: 0.25,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
    ).toEqual([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        title: 'book.pdf',
        path: '/tmp/book.pdf',
        progressLabel: '25%',
        lastPageLabel: 'Page 5',
        fileSizeLabel: '2 KB',
        modifiedAtLabel: '2026-06-16T00:00:00Z',
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
        fileSizeLabel: 'Unknown size',
        modifiedAtLabel: 'Unknown modified time',
        missing: true,
      },
      {
        documentKey: 'ok',
        title: 'ok.pdf',
        path: '/tmp/ok.pdf',
        progressLabel: '20%',
        lastPageLabel: 'Page 2',
        fileSizeLabel: 'Unknown size',
        modifiedAtLabel: 'Unknown modified time',
        missing: false,
      },
    ]);

    expect(sorted.map((file) => file.documentKey)).toEqual(['ok', 'missing']);
  });
});
