import type {
  BookmarkDashboard,
  BookmarkDashboardDocument,
  PersistedBookmarkRecord,
} from '../persistence/persistenceApi';

export const BOOKMARK_PAGE_SIZES = [20, 50, 100] as const;

export type BookmarkPageSize = (typeof BOOKMARK_PAGE_SIZES)[number];
export type BookmarkDateFilter = 'all' | 'today' | '7days' | '30days';
export type BookmarkSortMode = 'createdDesc' | 'createdAsc' | 'pageAsc' | 'pageDesc';
export type BookmarkDensity = 'standard' | 'compact';

export type BookmarkUpdateInput = {
  title: string;
  note: string | null;
};

export type BookmarkDeleteResult = {
  succeededIds: number[];
  failedIds: number[];
};

export type BookmarkManagementRecord = PersistedBookmarkRecord & {
  documentFileSize: number | null;
  documentPageCount: number | null;
  documentBookmarkCount: number;
};

export type BookmarkPageGroup = {
  document: BookmarkDashboardDocument;
  bookmarkCount: number;
  bookmarks: BookmarkManagementRecord[];
};

export type BookmarkPageOptions = {
  query: string;
  documentKey: string;
  dateFilter: BookmarkDateFilter;
  sortMode: BookmarkSortMode;
  page: number;
  pageSize: number;
  now: Date;
};

export type BookmarkDerivedPage = {
  page: number;
  pageCount: number;
  pageSize: number;
  totalBookmarks: number;
  groups: BookmarkPageGroup[];
  visibleBookmarks: BookmarkManagementRecord[];
  allMatchingBookmarks: BookmarkManagementRecord[];
};

export function flattenBookmarkDashboard(
  dashboard: BookmarkDashboard | null,
): BookmarkManagementRecord[] {
  if (!dashboard) {
    return [];
  }

  return dashboard.groups.flatMap((group) =>
    group.bookmarks.map((bookmark) => ({
      ...bookmark,
      documentDisplayName: group.document.displayName,
      documentPath: group.document.path,
      documentMissing: group.document.missing,
      documentFileSize: group.document.fileSize,
      documentPageCount: group.document.pageCount,
      documentBookmarkCount: group.bookmarkCount,
    })),
  );
}

export function filterBookmarkRecords(
  records: BookmarkManagementRecord[],
  options: Pick<BookmarkPageOptions, 'query' | 'documentKey' | 'dateFilter' | 'now'>,
): BookmarkManagementRecord[] {
  const query = options.query.trim().toLocaleLowerCase();

  return records.filter((record) => {
    const matchesQuery =
      query.length === 0 ||
      [
        record.title,
        record.note ?? '',
        record.documentDisplayName ?? record.documentKey,
        record.documentPath ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(query));
    const matchesDocument =
      options.documentKey === 'all' || record.documentKey === options.documentKey;

    return (
      matchesQuery &&
      matchesDocument &&
      matchesBookmarkDate(record.createdAt, options.dateFilter, options.now)
    );
  });
}

export function deriveBookmarkPage(
  records: BookmarkManagementRecord[],
  options: BookmarkPageOptions,
): BookmarkDerivedPage {
  const filtered = filterBookmarkRecords(records, options);
  const documentGroups = new Map<string, BookmarkManagementRecord[]>();

  for (const record of filtered) {
    const group = documentGroups.get(record.documentKey) ?? [];
    group.push(record);
    documentGroups.set(record.documentKey, group);
  }

  const sortedGroups = [...documentGroups.values()]
    .map((bookmarks) =>
      [...bookmarks].sort((first, second) =>
        compareBookmarks(first, second, options.sortMode),
      ),
    )
    .sort((first, second) => compareDocuments(first[0], second[0]));
  const allMatchingBookmarks = sortedGroups.flat();
  const pageSize = Math.max(1, options.pageSize);
  const pageCount = Math.max(1, Math.ceil(allMatchingBookmarks.length / pageSize));
  const page = Math.min(Math.max(1, options.page), pageCount);
  const start = (page - 1) * pageSize;
  const visibleBookmarks = allMatchingBookmarks.slice(start, start + pageSize);
  const groups = regroupVisibleBookmarks(visibleBookmarks);

  return {
    page,
    pageCount,
    pageSize,
    totalBookmarks: allMatchingBookmarks.length,
    groups,
    visibleBookmarks,
    allMatchingBookmarks,
  };
}

export function findAdjacentBookmarks(
  records: BookmarkManagementRecord[],
  bookmarkId: number,
): {
  previous: BookmarkManagementRecord | null;
  next: BookmarkManagementRecord | null;
} {
  const selected = records.find((record) => record.id === bookmarkId);
  if (!selected) {
    return { previous: null, next: null };
  }

  const documentRecords = records
    .filter((record) => record.documentKey === selected.documentKey)
    .sort(compareAdjacentBookmarks);
  const index = documentRecords.findIndex((record) => record.id === bookmarkId);

  return {
    previous: index > 0 ? documentRecords[index - 1] : null,
    next: index >= 0 && index < documentRecords.length - 1 ? documentRecords[index + 1] : null,
  };
}

export function findSelectionAfterDelete(
  orderedRecords: BookmarkManagementRecord[],
  deletedId: number,
): number | null {
  const deletedIndex = orderedRecords.findIndex((record) => record.id === deletedId);
  if (deletedIndex < 0) {
    return null;
  }

  const deleted = orderedRecords[deletedIndex];
  const nextInDocument = orderedRecords
    .slice(deletedIndex + 1)
    .find((record) => record.documentKey === deleted.documentKey);
  if (nextInDocument?.id != null) {
    return nextInDocument.id;
  }

  const previousInDocument = [...orderedRecords.slice(0, deletedIndex)]
    .reverse()
    .find((record) => record.documentKey === deleted.documentKey);
  if (previousInDocument?.id != null) {
    return previousInDocument.id;
  }

  const next = orderedRecords[deletedIndex + 1];
  if (next?.id != null) {
    return next.id;
  }

  const previous = orderedRecords[deletedIndex - 1];
  return previous?.id ?? null;
}

export function findBookmarkPage(
  orderedRecords: BookmarkManagementRecord[],
  bookmarkId: number,
  pageSize: number,
): number {
  const index = orderedRecords.findIndex((record) => record.id === bookmarkId);
  return index < 0 ? 1 : Math.floor(index / Math.max(1, pageSize)) + 1;
}

export function buildBookmarkReference(record: BookmarkManagementRecord): string {
  const documentName = record.documentDisplayName || record.documentKey;
  const pagePart = Number.isFinite(record.page) && record.page > 0 ? `，第 ${record.page} 页` : '';
  return `《${documentName}》，“${record.title}”${pagePart}`;
}

export function formatBookmarkPageProgress(record: BookmarkManagementRecord): {
  pageLabel: string;
  ratioLabel: string | null;
  percent: number | null;
} {
  const pageLabel = `第 ${record.page} 页`;
  if (!record.documentPageCount || record.documentPageCount <= 0) {
    return { pageLabel, ratioLabel: null, percent: null };
  }

  const percent = Math.min(
    100,
    Math.max(0, Math.round((record.page / record.documentPageCount) * 100)),
  );
  return {
    pageLabel,
    ratioLabel: `${record.page} / ${record.documentPageCount}`,
    percent,
  };
}

export function formatBookmarkFileSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function bookmarkRecordKey(record: BookmarkManagementRecord): string {
  return record.id == null
    ? `${record.documentKey}:${record.page}:${record.title}:${record.createdAt}`
    : String(record.id);
}

function regroupVisibleBookmarks(records: BookmarkManagementRecord[]): BookmarkPageGroup[] {
  const groups: BookmarkPageGroup[] = [];

  for (const record of records) {
    const existing = groups.find((group) => group.document.documentKey === record.documentKey);
    if (existing) {
      existing.bookmarks.push(record);
      continue;
    }

    groups.push({
      document: {
        documentKey: record.documentKey,
        displayName: record.documentDisplayName ?? record.documentKey,
        path: record.documentPath,
        missing: record.documentMissing,
        fileSize: record.documentFileSize,
        pageCount: record.documentPageCount,
      },
      bookmarkCount: record.documentBookmarkCount,
      bookmarks: [record],
    });
  }

  return groups;
}

function matchesBookmarkDate(value: string, filter: BookmarkDateFilter, now: Date): boolean {
  if (filter === 'all') {
    return true;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const days = filter === 'today' ? 1 : filter === '7days' ? 7 : 30;
  const lowerBound = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (days - 1),
  ).getTime();

  return timestamp >= lowerBound && timestamp < nextDay;
}

function compareDocuments(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
): number {
  const firstName = first.documentDisplayName ?? first.documentKey;
  const secondName = second.documentDisplayName ?? second.documentKey;
  return (
    firstName.localeCompare(secondName, 'zh-Hans-CN', { sensitivity: 'base' }) ||
    first.documentKey.localeCompare(second.documentKey)
  );
}

function compareBookmarks(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
  sortMode: BookmarkSortMode,
): number {
  if (sortMode === 'pageAsc' || sortMode === 'pageDesc') {
    const pageDifference =
      sortMode === 'pageAsc' ? first.page - second.page : second.page - first.page;
    return (
      pageDifference ||
      compareCreatedAt(first.createdAt, second.createdAt, 'asc') ||
      compareTitleAndId(first, second)
    );
  }

  const direction = sortMode === 'createdAsc' ? 'asc' : 'desc';
  return (
    compareCreatedAt(first.createdAt, second.createdAt, direction) ||
    first.page - second.page ||
    compareTitleAndId(first, second)
  );
}

function compareAdjacentBookmarks(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
): number {
  return (
    first.page - second.page ||
    compareCreatedAt(first.createdAt, second.createdAt, 'asc') ||
    compareNullableIds(first.id, second.id)
  );
}

function compareCreatedAt(first: string, second: string, direction: 'asc' | 'desc'): number {
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  const firstValid = !Number.isNaN(firstTime);
  const secondValid = !Number.isNaN(secondTime);

  if (!firstValid && !secondValid) {
    return 0;
  }
  if (!firstValid) {
    return 1;
  }
  if (!secondValid) {
    return -1;
  }
  return direction === 'asc' ? firstTime - secondTime : secondTime - firstTime;
}

function compareTitleAndId(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
): number {
  return (
    first.title.localeCompare(second.title, 'zh-Hans-CN', { sensitivity: 'base' }) ||
    compareNullableIds(first.id, second.id)
  );
}

function compareNullableIds(first: number | null, second: number | null): number {
  return (first ?? Number.MAX_SAFE_INTEGER) - (second ?? Number.MAX_SAFE_INTEGER);
}
