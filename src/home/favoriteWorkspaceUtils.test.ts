import { describe, expect, it } from 'vitest';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';
import {
  buildFavoriteDirectoryOptions,
  buildFavoriteRecommendations,
  buildFavoriteTagOptions,
  deriveFavoriteOverview,
  filterFavoriteDocuments,
  getFavoriteDirectoryLabel,
  getRecentFavoriteActivity,
  sortFavoriteDocuments,
} from './favoriteWorkspaceUtils';

const tags: Tag[] = [
  {
    id: 1,
    name: 'Transformer',
    color: '#2563eb',
    documentCount: 2,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
  {
    id: 2,
    name: '图神经网络',
    color: '#16a34a',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
  {
    id: 3,
    name: '未使用标签',
    color: '#64748b',
    documentCount: 0,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
];

const documents: FavoriteDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Papers/Beta Research.pdf',
    path: '/Users/mario/Papers/Beta Research.pdf',
    displayName: 'Beta Research.pdf',
    pageCount: 100,
    lastPage: 15,
    progress: 0.15,
    missing: false,
    lastOpenedAt: '2026-07-03T09:30:00+08:00',
    tagIds: [1],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
    path: '/Users/mario/Archive/Alpha Notes.pdf',
    displayName: 'Alpha Notes.pdf',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
    lastOpenedAt: '2026-07-05T11:00:00+08:00',
    tagIds: [1, 2],
  },
  {
    documentKey: 'browser:local-upload',
    path: null,
    displayName: 'Local Upload.pdf',
    pageCount: null,
    lastPage: 0,
    progress: 0,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

describe('favoriteWorkspaceUtils', () => {
  it('derives directory labels from paths and pathless documents', () => {
    expect(getFavoriteDirectoryLabel(documents[0])).toBe('/Users/mario/Papers');
    expect(getFavoriteDirectoryLabel(documents[2])).toBe('本地浏览器文件');
  });

  it('filters favorites by query, progress, tag, and directory', () => {
    expect(
      filterFavoriteDocuments(documents, {
        query: 'archive',
        progressFilter: 'all',
        tagFilter: 'all',
        directoryFilter: 'all',
      }).map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf']);

    expect(
      filterFavoriteDocuments(documents, {
        query: '',
        progressFilter: 'completed',
        tagFilter: 'all',
        directoryFilter: 'all',
      }).map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf']);

    expect(
      filterFavoriteDocuments(documents, {
        query: '',
        progressFilter: 'all',
        tagFilter: '2',
        directoryFilter: 'all',
      }).map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf']);

    expect(
      filterFavoriteDocuments(documents, {
        query: '',
        progressFilter: 'all',
        tagFilter: 'all',
        directoryFilter: '/Users/mario/Papers',
      }).map((document) => document.displayName),
    ).toEqual(['Beta Research.pdf']);
  });

  it('sorts favorites by recent, name, and progress', () => {
    expect(sortFavoriteDocuments(documents, 'recent').map((document) => document.displayName)).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Local Upload.pdf',
    ]);
    expect(sortFavoriteDocuments(documents, 'name').map((document) => document.displayName)).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Local Upload.pdf',
    ]);
    expect(
      sortFavoriteDocuments(documents, 'progressAsc').map((document) => document.displayName),
    ).toEqual(['Local Upload.pdf', 'Beta Research.pdf', 'Alpha Notes.pdf']);
    expect(
      sortFavoriteDocuments(documents, 'progressDesc').map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf', 'Beta Research.pdf', 'Local Upload.pdf']);
  });

  it('builds tag and directory options from real favorite usage', () => {
    expect(buildFavoriteTagOptions(documents, tags)).toEqual([
      { tag: tags[0], count: 2 },
      { tag: tags[1], count: 1 },
    ]);
    expect(buildFavoriteDirectoryOptions(documents)).toEqual([
      { label: '/Users/mario/Archive', count: 1 },
      { label: '/Users/mario/Papers', count: 1 },
      { label: '本地浏览器文件', count: 1 },
    ]);
  });

  it('derives overview, recent activity, and recommendation reasons', () => {
    expect(deriveFavoriteOverview(documents)).toEqual({
      totalCount: 3,
      taggedCount: 2,
      directoryCount: 3,
      averageProgress: 0.38,
      completedRatio: 0.33,
    });
    expect(getRecentFavoriteActivity(documents).map((document) => document.displayName)).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
    ]);
    expect(buildFavoriteRecommendations(documents, tags)).toContainEqual({
      documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
      title: 'Alpha Notes.pdf',
      reason: '阅读进度已完成，适合作为重点收藏保留。',
    });
  });
});
