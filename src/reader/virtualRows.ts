export interface VisibleRowRange {
  start: number;
  end: number;
}

export function visibleRowRange(
  total: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscanRows: number
): VisibleRowRange {
  if (total <= 0) {
    return { start: 0, end: 0 };
  }

  const windowSize = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2;
  const maxStart = Math.max(0, total - windowSize);
  const start = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows),
    maxStart
  );

  return {
    start,
    end: Math.min(total, start + windowSize)
  };
}
