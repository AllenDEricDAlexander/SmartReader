import { describe, expect, it } from "vitest";
import { searchEpubChapters } from "./fallbackSearch";

describe("fallback search", () => {
  it("returns every same-chapter EPUB match without applying a result limit", async () => {
    const results = await searchEpubChapters(
      [
        {
          id: "chapter-1",
          href: "OPS/chapter-1.xhtml",
          label: "Chapter One",
          text: "Alpha beta alpha beta alpha"
        }
      ],
      "alpha"
    );

    expect(results).toHaveLength(3);
    expect(results.map((result) => result.id)).toEqual([
      "epub-search-chapter-1-0",
      "epub-search-chapter-1-11",
      "epub-search-chapter-1-22"
    ]);
    expect(results.map((result) => result.matchIndex)).toEqual([0, 1, 2]);
    expect(results.map((result) => result.matchOffset)).toEqual([0, 11, 22]);
  });

});
