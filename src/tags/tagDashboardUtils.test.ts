import { describe, expect, it } from 'vitest';
import type { TagDashboardTagRow } from './tagModels';
import {
  filterTagRows,
  getDefaultTagId,
  paginateTagRows,
  sortTagRows,
} from './tagDashboardUtils';

const rows: TagDashboardTagRow[] = [
  {
    id: 1,
    name: '深度学习',
    color: '#2563eb',
    usageCount: 9,
    documentCount: 5,
    annotationCount: 4,
    recentUsedAt: '2026-07-07T09:42:00Z',
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-07-07T09:42:00Z',
    description: '深度学习 相关文献与批注',
  },
  {
    id: 2,
    name: 'Transformer',
    color: '#f97316',
    usageCount: 3,
    documentCount: 2,
    annotationCount: 1,
    recentUsedAt: '2026-07-06T09:42:00Z',
    createdAt: '2026-07-02T09:00:00Z',
    updatedAt: '2026-07-06T09:42:00Z',
    description: 'Transformer 相关文献与批注',
  },
];

describe('tagDashboardUtils', () => {
  it('filters rows by name, description, and color', () => {
    expect(filterTagRows(rows, '深度', 'all')).toHaveLength(1);
    expect(filterTagRows(rows, '文献', '#f97316')).toEqual([rows[1]]);
  });

  it('sorts by usage, documents, and recent activity', () => {
    expect(sortTagRows(rows, 'usage').map((row) => row.id)).toEqual([1, 2]);
    expect(sortTagRows(rows, 'documents').map((row) => row.id)).toEqual([1, 2]);
    expect(sortTagRows([...rows].reverse(), 'recent').map((row) => row.id)).toEqual([1, 2]);
  });

  it('paginates rows with a bounded page number', () => {
    expect(paginateTagRows(rows, 1, 1).items).toEqual([rows[0]]);
    expect(paginateTagRows(rows, 99, 1).page).toBe(2);
  });

  it('selects the highest-usage tag by default', () => {
    expect(getDefaultTagId(rows)).toBe(1);
    expect(getDefaultTagId([])).toBeNull();
  });
});
