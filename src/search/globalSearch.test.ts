import { describe, expect, it } from 'vitest';
import type { PersistedAnnotationRecord, PersistedBookmarkRecord } from '../persistence/persistenceApi';
import { buildGlobalSearchResults } from './globalSearch';

const bookmark: PersistedBookmarkRecord = {
  id: 1,
  documentKey: 'desktop:/tmp/ml.pdf',
  page: 8,
  title: 'Transformer overview',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  documentDisplayName: 'ml.pdf',
  documentPath: '/tmp/ml.pdf',
  documentMissing: false,
};

const annotation: PersistedAnnotationRecord = {
  id: 2,
  documentKey: 'desktop:/tmp/nlp.pdf',
  page: 12,
  type: 'note',
  color: '#facc15',
  text: 'Compare this benchmark',
  quote: 'Important benchmark quote',
  areas: [],
  tagIds: [],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  documentDisplayName: 'nlp.pdf',
  documentPath: '/tmp/nlp.pdf',
  documentMissing: false,
};

describe('buildGlobalSearchResults', () => {
  it('returns file results by file name and path', () => {
    const results = buildGlobalSearchResults({
      query: 'stats',
      recentDocuments: [
        {
          documentKey: 'desktop:/tmp/stats-guide.pdf',
          displayName: 'stats-guide.pdf',
          path: '/tmp/books/intro.pdf',
          fileSize: 100,
          modifiedAt: null,
          pageCount: 20,
          lastPage: 2,
          progress: 0.1,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
        {
          documentKey: 'desktop:/tmp/stats.pdf',
          displayName: 'statistics.pdf',
          path: '/tmp/books/stats.pdf',
          fileSize: 100,
          modifiedAt: null,
          pageCount: 20,
          lastPage: 3,
          progress: 0.15,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ],
      favoriteDocuments: [],
      bookmarks: [],
      annotations: [],
      activeSession: null,
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: 'file:desktop:/tmp/stats-guide.pdf',
        source: 'file',
        title: 'stats-guide.pdf',
        documentKey: 'desktop:/tmp/stats-guide.pdf',
        path: '/tmp/books/intro.pdf',
      }),
      expect.objectContaining({
        id: 'file:desktop:/tmp/stats.pdf',
        source: 'file',
        title: 'statistics.pdf',
        documentKey: 'desktop:/tmp/stats.pdf',
        path: '/tmp/books/stats.pdf',
      }),
    ]);
  });

  it('returns bookmark results', () => {
    const results = buildGlobalSearchResults({
      query: 'transformer',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [bookmark],
      annotations: [annotation],
      activeSession: null,
    });

    expect(results.map((result) => result.source)).toEqual(['bookmark']);
    expect(results[0]).toMatchObject({
      id: 'bookmark:1',
      title: 'Transformer overview',
      page: 8,
      documentKey: 'desktop:/tmp/ml.pdf',
    });
  });

  it('returns annotation results', () => {
    const results = buildGlobalSearchResults({
      query: 'benchmark',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [bookmark],
      annotations: [annotation],
      activeSession: null,
    });

    expect(results.map((result) => result.source)).toEqual(['annotation']);
    expect(results[0]).toMatchObject({
      id: 'annotation:2',
      title: 'Compare this benchmark',
      page: 12,
      documentKey: 'desktop:/tmp/nlp.pdf',
    });
  });

  it('adds a current document full-text action when a reader session is active', () => {
    const results = buildGlobalSearchResults({
      query: 'privacy',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [],
      annotations: [],
      activeSession: {
        documentKey: 'desktop:/tmp/current.pdf',
        title: 'current.pdf',
      },
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: 'fullText:desktop:/tmp/current.pdf:privacy',
        source: 'fullText',
        title: '在当前文档中搜索 "privacy"',
        documentKey: 'desktop:/tmp/current.pdf',
        query: 'privacy',
      }),
    ]);
  });

  it('deduplicates files that are both recent and favorite', () => {
    const results = buildGlobalSearchResults({
      query: 'paper',
      recentDocuments: [
        {
          documentKey: 'desktop:/tmp/paper.pdf',
          displayName: 'paper.pdf',
          path: '/tmp/paper.pdf',
          fileSize: 100,
          modifiedAt: null,
          pageCount: 20,
          lastPage: 1,
          progress: 0,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ],
      favoriteDocuments: [
        {
          documentKey: 'desktop:/tmp/paper.pdf',
          displayName: 'paper.pdf',
          path: '/tmp/paper.pdf',
          lastPage: 1,
          progress: 0,
          pageCount: null,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ],
      bookmarks: [],
      annotations: [],
      activeSession: null,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('file:desktop:/tmp/paper.pdf');
  });
});
