import type { OutlineItem, ReaderLocation } from "../types/reader";

export interface OutlineRow {
  item: OutlineItem;
  level: number;
  hasChildren: boolean;
}

export function visibleOutlineRows(outline: OutlineItem[], collapsedIds: Set<string>): OutlineRow[] {
  const normalized = normalizeOutlineRows(outline);
  const rows: OutlineRow[] = [];
  let hiddenBelowLevel: number | undefined;

  normalized.forEach((row) => {
    if (hiddenBelowLevel !== undefined) {
      if (row.level > hiddenBelowLevel) {
        return;
      }

      hiddenBelowLevel = undefined;
    }

    rows.push(row);

    if (collapsedIds.has(row.item.id)) {
      hiddenBelowLevel = row.level;
    }
  });

  return rows;
}

export function normalizeOutlineRows(outline: OutlineItem[]): OutlineRow[] {
  const normalized: OutlineRow[] = [];

  outline.forEach((item, index) => {
    const rawLevel = Math.max(0, item.level ?? 0);
    const previousLevel = normalized[index - 1]?.level ?? 0;
    const level = index === 0 || rawLevel > previousLevel + 1 ? 0 : rawLevel;
    const previous = normalized[index - 1];

    if (previous && level === previous.level + 1) {
      previous.hasChildren = true;
    }

    normalized.push({ item, level, hasChildren: false });
  });

  return normalized;
}

export function isSameReaderLocation(first: ReaderLocation, second: ReaderLocation): boolean {
  switch (first.kind) {
    case "none":
      return second.kind === "none";
    case "page":
      return second.kind === "page" && first.page === second.page;
    case "epub":
      return second.kind === "epub" &&
        first.chapterHref === second.chapterHref &&
        first.cfi === second.cfi &&
        first.progress === second.progress;
  }
}
