import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';

export type FavoriteSortMode = 'recent' | 'name' | 'progressDesc' | 'progressAsc';
export type FavoriteProgressFilter = 'all' | 'notStarted' | 'reading' | 'completed';
export type FavoriteTagFilter = 'all' | `${number}`;
export type FavoriteDirectoryFilter = 'all' | string;

export type FavoriteDocumentFilters = {
  query: string;
  progressFilter: FavoriteProgressFilter;
  tagFilter: FavoriteTagFilter;
  directoryFilter: FavoriteDirectoryFilter;
};

export type FavoriteTagOption = {
  tag: Tag;
  count: number;
};

export type FavoriteDirectoryOption = {
  label: string;
  count: number;
};

export type FavoriteOverview = {
  totalCount: number;
  taggedCount: number;
  directoryCount: number;
  averageProgress: number;
  completedRatio: number;
};

export type FavoriteRecommendation = {
  documentKey: string;
  title: string;
  reason: string;
};

export const localBrowserDirectoryLabel = '本地浏览器文件';

export function getFavoriteDirectoryLabel(document: FavoriteDocument): string {
  if (!document.path) {
    return localBrowserDirectoryLabel;
  }

  const normalizedPath = document.path.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');

  if (lastSlashIndex <= 0) {
    return localBrowserDirectoryLabel;
  }

  return normalizedPath.slice(0, lastSlashIndex);
}

export function filterFavoriteDocuments(
  documents: FavoriteDocument[],
  filters: FavoriteDocumentFilters,
): FavoriteDocument[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return documents.filter((document) => {
    const directory = getFavoriteDirectoryLabel(document);
    const matchesQuery =
      normalizedQuery.length === 0 ||
      document.displayName.toLowerCase().includes(normalizedQuery) ||
      (document.path ?? '').toLowerCase().includes(normalizedQuery) ||
      directory.toLowerCase().includes(normalizedQuery);

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

    if (filters.tagFilter !== 'all' && !document.tagIds.includes(Number(filters.tagFilter))) {
      return false;
    }

    if (filters.directoryFilter !== 'all' && directory !== filters.directoryFilter) {
      return false;
    }

    return true;
  });
}

export function sortFavoriteDocuments(
  documents: FavoriteDocument[],
  sortMode: FavoriteSortMode,
): FavoriteDocument[] {
  return [...documents].sort((first, second) => {
    if (sortMode === 'name') {
      return first.displayName.localeCompare(second.displayName, 'zh-Hans-CN');
    }

    if (sortMode === 'progressDesc') {
      return second.progress - first.progress;
    }

    if (sortMode === 'progressAsc') {
      return first.progress - second.progress;
    }

    const firstTime = first.lastOpenedAt ? Date.parse(first.lastOpenedAt) : 0;
    const secondTime = second.lastOpenedAt ? Date.parse(second.lastOpenedAt) : 0;
    return secondTime - firstTime;
  });
}

export function buildFavoriteTagOptions(
  documents: FavoriteDocument[],
  tags: Tag[],
): FavoriteTagOption[] {
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
        second.count - first.count || first.tag.name.localeCompare(second.tag.name),
    );
}

export function buildFavoriteDirectoryOptions(
  documents: FavoriteDocument[],
): FavoriteDirectoryOption[] {
  const counts = new Map<string, number>();

  for (const document of documents) {
    const directory = getFavoriteDirectoryLabel(document);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((first, second) => first.label.localeCompare(second.label, 'zh-Hans-CN'));
}

export function deriveFavoriteOverview(documents: FavoriteDocument[]): FavoriteOverview {
  const totalCount = documents.length;
  const taggedCount = documents.filter((document) => document.tagIds.length > 0).length;
  const directoryCount = buildFavoriteDirectoryOptions(documents).length;
  const averageProgress =
    totalCount === 0
      ? 0
      : roundRatio(documents.reduce((sum, document) => sum + document.progress, 0) / totalCount);
  const completedRatio =
    totalCount === 0
      ? 0
      : roundRatio(documents.filter((document) => document.progress >= 1).length / totalCount);

  return {
    totalCount,
    taggedCount,
    directoryCount,
    averageProgress,
    completedRatio,
  };
}

export function getRecentFavoriteActivity(documents: FavoriteDocument[]): FavoriteDocument[] {
  return sortFavoriteDocuments(
    documents.filter((document) => document.lastOpenedAt),
    'recent',
  ).slice(0, 3);
}

export function buildFavoriteRecommendations(
  documents: FavoriteDocument[],
  tags: Tag[],
): FavoriteRecommendation[] {
  const tagOptions = buildFavoriteTagOptions(documents, tags);
  const popularTagIds = new Set(
    tagOptions.filter((option) => option.count >= 2).map((option) => option.tag.id),
  );
  const recommendations: FavoriteRecommendation[] = [];

  for (const document of documents) {
    if (recommendations.length >= 3) {
      break;
    }

    if (document.progress >= 1) {
      recommendations.push({
        documentKey: document.documentKey,
        title: document.displayName,
        reason: '阅读进度已完成，适合作为重点收藏保留。',
      });
      continue;
    }

    if (document.tagIds.some((tagId) => popularTagIds.has(tagId))) {
      recommendations.push({
        documentKey: document.documentKey,
        title: document.displayName,
        reason: '与多个同标签收藏相关，适合后续集中阅读。',
      });
    }
  }

  return recommendations;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}
