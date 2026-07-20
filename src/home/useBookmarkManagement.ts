import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveBookmarkPage,
  findBookmarkPage,
  type BookmarkDateFilter,
  type BookmarkDensity,
  type BookmarkManagementRecord,
  type BookmarkPageSize,
  type BookmarkSortMode,
} from './bookmarkManagementUtils';

type UseBookmarkManagementInput = {
  records: BookmarkManagementRecord[];
  now?: Date;
};

export function useBookmarkManagement({ records, now }: UseBookmarkManagementInput) {
  const stableNowRef = useRef(now ?? new Date());
  const effectiveNow = now ?? stableNowRef.current;
  const [query, setQueryState] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [documentKey, setDocumentKeyState] = useState('all');
  const [dateFilter, setDateFilterState] = useState<BookmarkDateFilter>('all');
  const [sortMode, setSortModeState] = useState<BookmarkSortMode>('createdDesc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<BookmarkPageSize>(20);
  const [density, setDensity] = useState<BookmarkDensity>('standard');
  const [expandedDocumentKeys, setExpandedDocumentKeys] = useState<Set<string>>(
    () => new Set(records.map((record) => record.documentKey)),
  );
  const knownDocumentKeysRef = useRef(new Set(records.map((record) => record.documentKey)));
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<number | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(() => new Set());

  const documentOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const record of records) {
      names.set(record.documentKey, record.documentDisplayName ?? record.documentKey);
    }
    return [...names].sort(
      (first, second) =>
        first[1].localeCompare(second[1], 'zh-Hans-CN', { sensitivity: 'base' }) ||
        first[0].localeCompare(second[0]),
    );
  }, [records]);

  const derived = useMemo(
    () =>
      deriveBookmarkPage(records, {
        query: deferredQuery,
        documentKey,
        dateFilter,
        sortMode,
        page,
        pageSize,
        now: effectiveNow,
      }),
    [dateFilter, deferredQuery, documentKey, effectiveNow, page, pageSize, records, sortMode],
  );
  const selectedBookmark =
    derived.allMatchingBookmarks.find((record) => record.id === selectedBookmarkId) ?? null;
  const selectedVisibleCount = derived.visibleBookmarks.filter(
    (record) => record.id != null && selectedBatchIds.has(record.id),
  ).length;
  const selectableVisibleCount = derived.visibleBookmarks.filter(
    (record) => record.id != null,
  ).length;
  const allVisibleSelected =
    selectableVisibleCount > 0 && selectedVisibleCount === selectableVisibleCount;

  useEffect(() => {
    const available = new Set(records.map((record) => record.documentKey));
    setExpandedDocumentKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      for (const key of available) {
        if (!knownDocumentKeysRef.current.has(key)) {
          next.add(key);
        }
      }
      return next;
    });
    knownDocumentKeysRef.current = available;
  }, [records]);

  useEffect(() => {
    if (derived.page !== page) {
      setPage(derived.page);
    }
  }, [derived.page, page]);

  useEffect(() => {
    if (
      selectedBookmarkId != null &&
      !derived.allMatchingBookmarks.some((record) => record.id === selectedBookmarkId)
    ) {
      setSelectedBookmarkId(null);
    }
  }, [derived.allMatchingBookmarks, selectedBookmarkId]);

  useEffect(() => {
    const availableIds = new Set(
      records.flatMap((record) => (record.id == null ? [] : [record.id])),
    );
    setSelectedBatchIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [records]);

  const resetPage = () => setPage(1);
  const setQuery = (value: string) => {
    setQueryState(value);
    resetPage();
  };
  const setDocumentKey = (value: string) => {
    setDocumentKeyState(value);
    resetPage();
  };
  const setDateFilter = (value: BookmarkDateFilter) => {
    setDateFilterState(value);
    resetPage();
  };
  const setSortMode = (value: BookmarkSortMode) => {
    setSortModeState(value);
    resetPage();
  };
  const setPageSize = (value: BookmarkPageSize) => {
    setPageSizeState(value);
    resetPage();
  };
  const clearFilters = () => {
    setQueryState('');
    setDocumentKeyState('all');
    setDateFilterState('all');
    resetPage();
  };
  const toggleDocument = (key: string) => {
    setExpandedDocumentKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const selectBookmark = (record: BookmarkManagementRecord) => {
    if (record.id != null) {
      setSelectedBookmarkId(record.id);
    }
  };
  const navigateToBookmark = (record: BookmarkManagementRecord) => {
    if (record.id == null) {
      return;
    }
    setExpandedDocumentKeys((current) => new Set(current).add(record.documentKey));
    setPage(findBookmarkPage(derived.allMatchingBookmarks, record.id, pageSize));
    setSelectedBookmarkId(record.id);
    setPendingFocusId(record.id);
  };
  const startBatchMode = () => setBatchMode(true);
  const cancelBatchMode = () => {
    setBatchMode(false);
    setSelectedBatchIds(new Set());
  };
  const toggleBatchSelection = (id: number, selected: boolean) => {
    setSelectedBatchIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };
  const toggleVisibleBatchSelection = (selected: boolean) => {
    setSelectedBatchIds((current) => {
      const next = new Set(current);
      for (const record of derived.visibleBookmarks) {
        if (record.id == null) {
          continue;
        }
        if (selected) {
          next.add(record.id);
        } else {
          next.delete(record.id);
        }
      }
      return next;
    });
  };

  return {
    query,
    documentKey,
    dateFilter,
    sortMode,
    page: derived.page,
    pageSize,
    density,
    expandedDocumentKeys,
    selectedBookmarkId,
    selectedBookmark,
    pendingFocusId,
    batchMode,
    selectedBatchIds,
    selectedVisibleCount,
    allVisibleSelected,
    documentOptions,
    derived,
    setQuery,
    setDocumentKey,
    setDateFilter,
    setSortMode,
    setPage,
    setPageSize,
    setDensity,
    clearFilters,
    toggleDocument,
    selectBookmark,
    setSelectedBookmarkId,
    navigateToBookmark,
    setPendingFocusId,
    startBatchMode,
    cancelBatchMode,
    toggleBatchSelection,
    toggleVisibleBatchSelection,
    setSelectedBatchIds,
    setBatchMode,
  };
}
