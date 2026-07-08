import type { PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';

export type RecentSortMode = 'recent' | 'name' | 'progressDesc' | 'progressAsc';
export type RecentProgressFilter = 'all' | 'notStarted' | 'reading' | 'completed';
export type RecentFavoriteFilter = 'all' | 'favorite' | 'notFavorite';
export type RecentTagFilter = 'all' | 'untagged' | `${number}`;

export type RecentDocumentFilters = {
  query: string;
  progressFilter: RecentProgressFilter;
  tagFilter: RecentTagFilter;
  favoriteFilter: RecentFavoriteFilter;
};

export type RecentTagOption = {
  tag: Tag;
  count: number;
};

export type RecentStats = {
  recentCount: number;
  favoriteCount: number;
  taggedCount: number;
  completedCount: number;
};

export type RecentActivityItem = {
  id: string;
  title: string;
  description: string;
  time: string | null;
  tone: 'blue' | 'green' | 'slate';
};

export function filterRecentDocuments(
  documents: PersistedDocument[],
  filters: RecentDocumentFilters,
  favoriteKeys: Set<string>,
): PersistedDocument[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return documents.filter((document) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      document.displayName.toLowerCase().includes(normalizedQuery) ||
      (document.path ?? '').toLowerCase().includes(normalizedQuery) ||
      document.documentKey.toLowerCase().includes(normalizedQuery);

    if (!matchesQuery) {
      return false;
    }

    if (filters.progressFilter === 'notStarted' && document.progress > 0) {
      return false;
    }

    if (
      filters.progressFilter === 'reading' &&
      (document.progress <= 0 || document.progress >= 1)
    ) {
      return false;
    }

    if (filters.progressFilter === 'completed' && document.progress < 1) {
      return false;
    }

    if (filters.tagFilter === 'untagged' && document.tagIds.length > 0) {
      return false;
    }

    if (filters.tagFilter !== 'all' && filters.tagFilter !== 'untagged') {
      const tagId = Number(filters.tagFilter);
      if (!document.tagIds.includes(tagId)) {
        return false;
      }
    }

    const favorite = favoriteKeys.has(document.documentKey);
    if (filters.favoriteFilter === 'favorite' && !favorite) {
      return false;
    }

    if (filters.favoriteFilter === 'notFavorite' && favorite) {
      return false;
    }

    return true;
  });
}

export function sortRecentDocuments(
  documents: PersistedDocument[],
  sortMode: RecentSortMode,
): PersistedDocument[] {
  return [...documents].sort((first, second) => {
    if (sortMode === 'name') {
      return first.displayName.localeCompare(second.displayName, 'zh-Hans-CN');
    }

    if (sortMode === 'progressDesc') {
      return second.progress - first.progress || compareByName(first, second);
    }

    if (sortMode === 'progressAsc') {
      return first.progress - second.progress || compareByName(first, second);
    }

    return getOpenedTime(second) - getOpenedTime(first) || compareByName(first, second);
  });
}

export function buildRecentTagOptions(
  documents: PersistedDocument[],
  tags: Tag[],
): RecentTagOption[] {
  const counts = new Map<number, number>();

  for (const document of documents) {
    for (const tagId of document.tagIds) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
  }

  return tags
    .map((tag) => ({ tag, count: counts.get(tag.id) ?? 0 }))
    .filter((option) => option.count > 0)
    .sort(
      (first, second) =>
        second.count - first.count || first.tag.name.localeCompare(second.tag.name, 'zh-Hans-CN'),
    );
}

export function buildRecentStats(
  documents: PersistedDocument[],
  favoriteKeys: Set<string>,
): RecentStats {
  return {
    recentCount: documents.length,
    favoriteCount: documents.filter((document) => favoriteKeys.has(document.documentKey)).length,
    taggedCount: documents.filter((document) => document.tagIds.length > 0).length,
    completedCount: documents.filter((document) => document.progress >= 1).length,
  };
}

export function buildRecentActivityItems(
  documents: PersistedDocument[],
  favoriteKeys: Set<string>,
  tags: Tag[],
): RecentActivityItem[] {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const openedItems = sortRecentDocuments(
    documents.filter((document) => document.lastOpenedAt),
    'recent',
  )
    .slice(0, 4)
    .map((document) => ({
      id: `opened:${document.documentKey}`,
      title: document.displayName,
      description: '最近打开',
      time: document.lastOpenedAt,
      tone: 'blue' as const,
    }));
  const taggedItems = documents
    .filter((document) => document.tagIds.some((tagId) => tagsById.has(tagId)))
    .slice(0, 2)
    .map((document) => ({
      id: `tagged:${document.documentKey}`,
      title: document.displayName,
      description: '已标记标签',
      time: document.lastOpenedAt,
      tone: 'green' as const,
    }));
  const favoriteItems = documents
    .filter((document) => favoriteKeys.has(document.documentKey))
    .slice(0, 2)
    .map((document) => ({
      id: `favorite:${document.documentKey}`,
      title: document.displayName,
      description: '已收藏',
      time: document.lastOpenedAt,
      tone: 'slate' as const,
    }));

  return [...openedItems, ...taggedItems, ...favoriteItems].slice(0, 6);
}

function compareByName(first: PersistedDocument, second: PersistedDocument) {
  return first.displayName.localeCompare(second.displayName, 'zh-Hans-CN');
}

function getOpenedTime(document: PersistedDocument) {
  if (!document.lastOpenedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = Date.parse(document.lastOpenedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}
