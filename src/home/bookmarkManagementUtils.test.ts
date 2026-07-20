import { describe, expect, it } from 'vitest';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import {
  buildBookmarkReference,
  deriveBookmarkPage,
  findAdjacentBookmarks,
  findBookmarkPage,
  findSelectionAfterDelete,
  flattenBookmarkDashboard,
  formatBookmarkFileSize,
  formatBookmarkPageProgress,
} from './bookmarkManagementUtils';

const dashboard: BookmarkDashboard = {
  totalBookmarks: 4,
  groups: [
    {
      document: {
        documentKey: 'desktop:/papers/b.pdf',
        displayName: 'Beta.pdf',
        path: '/papers/b.pdf',
        missing: false,
        fileSize: 2_048,
        pageCount: 100,
      },
      bookmarkCount: 3,
      bookmarks: [
        {
          id: 3,
          documentKey: 'desktop:/papers/b.pdf',
          page: 30,
          title: 'Third',
          note: null,
          createdAt: '2026-07-01T08:00:00+08:00',
          updatedAt: '2026-07-01T08:00:00+08:00',
        },
        {
          id: 1,
          documentKey: 'desktop:/papers/b.pdf',
          page: 10,
          title: 'First',
          note: 'Encoder dependency',
          createdAt: '2026-07-20T09:00:00+08:00',
          updatedAt: '2026-07-20T09:00:00+08:00',
        },
        {
          id: 2,
          documentKey: 'desktop:/papers/b.pdf',
          page: 20,
          title: 'Second',
          note: 'Recent result',
          createdAt: '2026-07-15T09:00:00+08:00',
          updatedAt: '2026-07-15T09:00:00+08:00',
        },
      ],
    },
    {
      document: {
        documentKey: 'desktop:/papers/a.pdf',
        displayName: 'Alpha.pdf',
        path: '/papers/a.pdf',
        missing: true,
        fileSize: null,
        pageCount: null,
      },
      bookmarkCount: 1,
      bookmarks: [
        {
          id: 4,
          documentKey: 'desktop:/papers/a.pdf',
          page: 5,
          title: 'Alpha note',
          note: null,
          createdAt: 'invalid-date',
          updatedAt: '2026-07-01T08:00:00+08:00',
        },
      ],
    },
  ],
};

describe('bookmarkManagementUtils', () => {
  it('flattens dashboard metadata without mutating source groups', () => {
    const records = flattenBookmarkDashboard(dashboard);

    expect(records).toHaveLength(4);
    expect(records.find((record) => record.id === 1)).toMatchObject({
      documentDisplayName: 'Beta.pdf',
      documentPath: '/papers/b.pdf',
      documentMissing: false,
      documentFileSize: 2_048,
      documentPageCount: 100,
      documentBookmarkCount: 3,
    });
    expect(dashboard.groups[0].bookmarks.map((bookmark) => bookmark.id)).toEqual([3, 1, 2]);
  });

  it('searches title, note, document name, and path case-insensitively', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const base = {
      documentKey: 'all',
      dateFilter: 'all' as const,
      sortMode: 'createdDesc' as const,
      page: 1,
      pageSize: 20 as const,
      now: new Date('2026-07-20T12:00:00+08:00'),
    };

    expect(deriveBookmarkPage(records, { ...base, query: 'encoder' }).totalBookmarks).toBe(1);
    expect(deriveBookmarkPage(records, { ...base, query: 'ALPHA' }).totalBookmarks).toBe(1);
    expect(deriveBookmarkPage(records, { ...base, query: '/papers/b' }).totalBookmarks).toBe(3);
    expect(deriveBookmarkPage(records, { ...base, query: '' }).totalBookmarks).toBe(4);
  });

  it('filters by document and local calendar date ranges', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const base = {
      query: '',
      documentKey: 'all',
      sortMode: 'createdDesc' as const,
      page: 1,
      pageSize: 20 as const,
      now: new Date('2026-07-20T12:00:00+08:00'),
    };

    expect(
      deriveBookmarkPage(records, {
        ...base,
        documentKey: 'desktop:/papers/b.pdf',
        dateFilter: 'all',
      }).totalBookmarks,
    ).toBe(3);
    expect(
      deriveBookmarkPage(records, { ...base, dateFilter: 'today' }).visibleBookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1]);
    expect(
      deriveBookmarkPage(records, { ...base, dateFilter: '7days' }).visibleBookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1, 2]);
    expect(
      deriveBookmarkPage(records, { ...base, dateFilter: '30days' }).visibleBookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('sorts groups by document name and records inside each group', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const base = {
      query: '',
      documentKey: 'all',
      dateFilter: 'all' as const,
      page: 1,
      pageSize: 20 as const,
      now: new Date('2026-07-20T12:00:00+08:00'),
    };

    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'pageAsc' }).groups.map(
        (group) => group.document.displayName,
      ),
    ).toEqual(['Alpha.pdf', 'Beta.pdf']);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'pageAsc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'pageDesc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([3, 2, 1]);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'createdAsc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([3, 2, 1]);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'createdDesc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('paginates bookmark records and keeps full document counts on split groups', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const page = deriveBookmarkPage(records, {
      query: '',
      documentKey: 'desktop:/papers/b.pdf',
      dateFilter: 'all',
      sortMode: 'pageAsc',
      page: 2,
      pageSize: 2,
      now: new Date('2026-07-20T12:00:00+08:00'),
    });

    expect(page.page).toBe(2);
    expect(page.pageCount).toBe(2);
    expect(page.visibleBookmarks.map((record) => record.id)).toEqual([3]);
    expect(page.groups[0].bookmarkCount).toBe(3);
    expect(findBookmarkPage(page.allMatchingBookmarks, 3, 2)).toBe(2);
  });

  it('finds document-local neighbors and deterministic post-delete selection', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const ordered = deriveBookmarkPage(records, {
      query: '',
      documentKey: 'all',
      dateFilter: 'all',
      sortMode: 'pageAsc',
      page: 1,
      pageSize: 20,
      now: new Date('2026-07-20T12:00:00+08:00'),
    }).allMatchingBookmarks;

    expect(findAdjacentBookmarks(records, 2)).toMatchObject({
      previous: { id: 1 },
      next: { id: 3 },
    });
    expect(findSelectionAfterDelete(ordered, 2)).toBe(3);
    expect(findSelectionAfterDelete(ordered, 3)).toBe(2);
    expect(findSelectionAfterDelete(ordered, 4)).toBe(1);
  });

  it('formats references, file sizes, and page progress without invented metadata', () => {
    const record = flattenBookmarkDashboard(dashboard).find((item) => item.id === 1)!;

    expect(buildBookmarkReference(record)).toBe('《Beta.pdf》，“First”，第 10 页');
    expect(
      buildBookmarkReference({
        ...record,
        documentDisplayName: null,
        page: Number.NaN,
      }),
    ).toBe('《desktop:/papers/b.pdf》，“First”');
    expect(formatBookmarkFileSize(record.documentFileSize)).toBe('2 KB');
    expect(formatBookmarkFileSize(null)).toBe('—');
    expect(formatBookmarkPageProgress(record)).toEqual({
      pageLabel: '第 10 页',
      ratioLabel: '10 / 100',
      percent: 10,
    });
    expect(
      formatBookmarkPageProgress(
        flattenBookmarkDashboard(dashboard).find((item) => item.id === 4)!,
      ),
    ).toEqual({
      pageLabel: '第 5 页',
      ratioLabel: null,
      percent: null,
    });
  });
});
