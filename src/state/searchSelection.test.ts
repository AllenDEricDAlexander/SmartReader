import { describe, expect, it } from "vitest";
import {
  createSearchSelection,
  removeSearchSelection,
  selectNextSearchResult,
  selectPreviousSearchResult
} from "./searchSelection";
import type { SearchResult } from "../types/reader";

const results: SearchResult[] = [
  { id: "one", label: "Page 1", snippet: "first", location: { kind: "page", page: 1 } },
  { id: "two", label: "Page 2", snippet: "second", location: { kind: "page", page: 2 } }
];

describe("search selection", () => {
  it("starts on the first result and cycles next and previous", () => {
    const initial = createSearchSelection("needle", results);
    const next = selectNextSearchResult(initial, results);
    const wrapped = selectNextSearchResult(next, results);
    const previous = selectPreviousSearchResult(wrapped, results);

    expect(initial).toMatchObject({ query: "needle", currentIndex: 0, total: 2 });
    expect(next.currentIndex).toBe(1);
    expect(wrapped.currentIndex).toBe(0);
    expect(previous.currentIndex).toBe(1);
  });

  it("keeps an empty selection stable for no-result searches", () => {
    const selection = createSearchSelection("missing", []);

    expect(selection).toMatchObject({ query: "missing", currentIndex: -1, total: 0 });
    expect(selectNextSearchResult(selection, [])).toEqual(selection);
    expect(selectPreviousSearchResult(selection, [])).toEqual(selection);
  });

  it("removes closed tab selection state", () => {
    const selection = createSearchSelection("needle", results);

    expect(removeSearchSelection({ open: selection, closed: selection }, "closed")).toEqual({
      open: selection
    });
  });
});
