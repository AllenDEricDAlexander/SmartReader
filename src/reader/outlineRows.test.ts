import { describe, expect, it } from "vitest";
import {
  epubHrefFragment,
  isSameReaderLocation,
  normalizeOutlineRows,
  visibleOutlineRows
} from "./outlineRows";
import type { OutlineItem } from "../types/reader";

function createOutline(count: number): OutlineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `outline-${index}`,
    title: `Section ${index}`,
    location: { kind: "page", page: index + 1 },
    level: index % 10 === 0 ? 0 : Math.min(index % 10, 3)
  }));
}

describe("outline row helpers", () => {
  it("normalizes jumped outline levels without hiding orphan rows", () => {
    const rows = normalizeOutlineRows([
      { id: "parent", title: "Parent", location: { kind: "page", page: 1 }, level: 0 },
      { id: "child", title: "Child", location: { kind: "page", page: 2 }, level: 1 },
      { id: "orphan", title: "Orphan", location: { kind: "page", page: 3 }, level: 3 },
      { id: "next", title: "Next", location: { kind: "page", page: 4 }, level: 0 }
    ]);

    expect(rows.map((row) => ({ id: row.item.id, level: row.level, hasChildren: row.hasChildren }))).toEqual([
      { id: "parent", level: 0, hasChildren: true },
      { id: "child", level: 1, hasChildren: false },
      { id: "orphan", level: 0, hasChildren: false },
      { id: "next", level: 0, hasChildren: false }
    ]);
  });

  it("keeps collapsed descendants hidden while preserving following siblings", () => {
    const outline: OutlineItem[] = [
      { id: "parent", title: "Parent", location: { kind: "page", page: 1 }, level: 0 },
      { id: "child", title: "Child", location: { kind: "page", page: 2 }, level: 1 },
      { id: "grandchild", title: "Grandchild", location: { kind: "page", page: 3 }, level: 2 },
      { id: "sibling", title: "Sibling", location: { kind: "page", page: 4 }, level: 0 }
    ];

    expect(visibleOutlineRows(outline, new Set(["parent"])).map((row) => row.item.id)).toEqual([
      "parent",
      "sibling"
    ]);
  });

  it.each([1000, 5000, 10000])("keeps every expanded synthetic row visible for %i rows", (count) => {
    const rows = visibleOutlineRows(createOutline(count), new Set());

    expect(rows).toHaveLength(count);
    expect(rows[0].item.id).toBe("outline-0");
    expect(rows[count - 1].item.id).toBe(`outline-${count - 1}`);
  });

  it("compares reader locations without relying on object serialization", () => {
    expect(isSameReaderLocation({ kind: "page", page: 2 }, { kind: "page", page: 2 })).toBe(true);
    expect(isSameReaderLocation({ kind: "page", page: 2 }, { kind: "page", page: 3 })).toBe(false);
    expect(
      isSameReaderLocation(
        { kind: "epub", chapterHref: "chapter.xhtml", chapterLabel: "Chapter", progress: 0.5 },
        { kind: "epub", chapterHref: "chapter.xhtml", cfi: undefined, progress: 0.5 }
      )
    ).toBe(true);
  });

  it("keeps EPUB fragment locations distinct while matching identical anchors", () => {
    expect(
      isSameReaderLocation(
        { kind: "epub", chapterHref: "OPS/chapter.xhtml#child", progress: 0.4 },
        { kind: "epub", chapterHref: "OPS/chapter.xhtml#child", progress: 0.4 }
      )
    ).toBe(true);
    expect(
      isSameReaderLocation(
        { kind: "epub", chapterHref: "OPS/chapter.xhtml", progress: 0.4 },
        { kind: "epub", chapterHref: "OPS/chapter.xhtml#child", progress: 0.4 }
      )
    ).toBe(false);
  });

  it("returns raw EPUB fragments when percent escapes are malformed", () => {
    expect(epubHrefFragment("chapter.xhtml#50%")).toBe("50%");
  });
});
