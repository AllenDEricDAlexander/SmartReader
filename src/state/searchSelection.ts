import type { SearchResult } from "../types/reader";

export interface SearchSelection {
  query: string;
  currentIndex: number;
  total: number;
}

export function createSearchSelection(query: string, results: SearchResult[]): SearchSelection {
  return {
    query,
    currentIndex: results.length > 0 ? 0 : -1,
    total: results.length
  };
}

export function selectNextSearchResult(
  selection: SearchSelection,
  results: SearchResult[]
): SearchSelection {
  if (results.length === 0 || selection.currentIndex < 0) {
    return selection;
  }

  return {
    ...selection,
    currentIndex: (selection.currentIndex + 1) % results.length,
    total: results.length
  };
}

export function selectPreviousSearchResult(
  selection: SearchSelection,
  results: SearchResult[]
): SearchSelection {
  if (results.length === 0 || selection.currentIndex < 0) {
    return selection;
  }

  return {
    ...selection,
    currentIndex: (selection.currentIndex - 1 + results.length) % results.length,
    total: results.length
  };
}

export function removeSearchSelection(
  selections: Record<string, SearchSelection>,
  tabId: string
): Record<string, SearchSelection> {
  if (!(tabId in selections)) {
    return selections;
  }

  const next = { ...selections };
  delete next[tabId];
  return next;
}
