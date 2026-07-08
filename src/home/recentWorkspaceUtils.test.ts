import { describe, expect, it } from 'vitest';
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import {
  buildRecentActivityItems,
  buildRecentStats,
  buildRecentTagOptions,
  filterRecentDocuments,
  sortRecentDocuments,
} from './recentWorkspaceUtils';

const tags: Tag[] = [
  {
    id: 1,
    name: 'AI',
    color: '#2563eb',
    documentCount: 2,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 2,
    name: '医学',
    color: '#10b981',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
];

const documents: PersistedDocument[] = [
  {
    documentKey: 'desktop:/a.pdf',
    path: '/Users/mario/Papers/a.pdf',
    displayName: 'Alpha.pdf',
    fileSize: 100,
    modifiedAt: '2026-07-01T00:00:00Z',
    pageCount: 10,
    lastPage: 5,
    progress: 0.5,
    missing: false,
    lastOpenedAt: '2026-07-08T10:00:00Z',
    tagIds: [1],
  },
  {
    documentKey: 'desktop:/b.pdf',
    path: '/Users/mario/Papers/b.pdf',
    displayName: 'Beta.pdf',
    fileSize: 200,
    modifiedAt: '2026-07-02T00:00:00Z',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
    lastOpenedAt: '2026-07-08T09:00:00Z',
    tagIds: [1, 2],
  },
  {
    documentKey: 'desktop:/c.pdf',
    path: '/Users/mario/Inbox/c.pdf',
    displayName: 'Gamma.pdf',
    fileSize: 300,
    modifiedAt: null,
    pageCount: null,
    lastPage: 1,
    progress: 0,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

describe('recentWorkspaceUtils', () => {
  it('filters by query, progress, tag, untagged, and favorite state', () => {
    const favoriteKeys = new Set(['desktop:/b.pdf']);

    expect(
      filterRecentDocuments(
        documents,
        {
          query: 'papers',
          progressFilter: 'all',
          tagFilter: 'all',
          favoriteFilter: 'all',
        },
        favoriteKeys,
      ).map((document) => document.displayName),
    ).toEqual(['Alpha.pdf', 'Beta.pdf']);

    expect(
      filterRecentDocuments(
        documents,
        {
          query: '',
          progressFilter: 'completed',
          tagFilter: 'all',
          favoriteFilter: 'favorite',
        },
        favoriteKeys,
      ).map((document) => document.displayName),
    ).toEqual(['Beta.pdf']);

    expect(
      filterRecentDocuments(
        documents,
        {
          query: '',
          progressFilter: 'all',
          tagFilter: 'untagged',
          favoriteFilter: 'all',
        },
        favoriteKeys,
      ).map((document) => document.displayName),
    ).toEqual(['Gamma.pdf']);
  });

  it('sorts by real last opened time before falling back to names', () => {
    expect(sortRecentDocuments(documents, 'recent').map((document) => document.displayName)).toEqual([
      'Alpha.pdf',
      'Beta.pdf',
      'Gamma.pdf',
    ]);
    expect(sortRecentDocuments(documents, 'name').map((document) => document.displayName)).toEqual([
      'Alpha.pdf',
      'Beta.pdf',
      'Gamma.pdf',
    ]);
  });

  it('builds tag options and right rail summaries from real data', () => {
    expect(buildRecentTagOptions(documents, tags)).toEqual([
      { tag: tags[0], count: 2 },
      { tag: tags[1], count: 1 },
    ]);
    expect(buildRecentStats(documents, new Set(['desktop:/b.pdf']))).toEqual({
      recentCount: 3,
      favoriteCount: 1,
      taggedCount: 2,
      completedCount: 1,
    });
    expect(buildRecentActivityItems(documents, new Set(['desktop:/b.pdf']), tags)[0]).toEqual({
      id: 'opened:desktop:/a.pdf',
      title: 'Alpha.pdf',
      description: '最近打开',
      time: '2026-07-08T10:00:00Z',
      tone: 'blue',
    });
  });
});
