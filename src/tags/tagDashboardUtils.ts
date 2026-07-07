import type { TagDashboardTagRow } from './tagModels';

export type TagSortKey = 'usage' | 'documents' | 'recent';

export function filterTagRows(
  rows: TagDashboardTagRow[],
  query: string,
  color: string,
): TagDashboardTagRow[] {
  const keyword = query.trim().toLocaleLowerCase();

  return rows.filter((row) => {
    const matchesColor = color === 'all' || row.color === color;
    const matchesKeyword =
      keyword.length === 0 ||
      row.name.toLocaleLowerCase().includes(keyword) ||
      row.description.toLocaleLowerCase().includes(keyword);

    return matchesColor && matchesKeyword;
  });
}

export function sortTagRows(
  rows: TagDashboardTagRow[],
  sortKey: TagSortKey,
): TagDashboardTagRow[] {
  const sorted = [...rows];

  sorted.sort((left, right) => {
    if (sortKey === 'documents') {
      return right.documentCount - left.documentCount || compareNames(left, right);
    }

    if (sortKey === 'recent') {
      return compareDates(right.recentUsedAt, left.recentUsedAt) || compareNames(left, right);
    }

    return right.usageCount - left.usageCount || compareNames(left, right);
  });

  return sorted;
}

export function paginateTagRows(
  rows: TagDashboardTagRow[],
  page: number,
  pageSize: number,
): { items: TagDashboardTagRow[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const boundedPage = Math.min(Math.max(1, page), totalPages);
  const start = (boundedPage - 1) * pageSize;

  return {
    items: rows.slice(start, start + pageSize),
    page: boundedPage,
    totalPages,
  };
}

export function getDefaultTagId(rows: TagDashboardTagRow[]): number | null {
  return sortTagRows(rows, 'usage')[0]?.id ?? null;
}

function compareNames(left: TagDashboardTagRow, right: TagDashboardTagRow): number {
  return left.name.localeCompare(right.name, 'zh-Hans-CN');
}

function compareDates(left: string | null, right: string | null): number {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}
