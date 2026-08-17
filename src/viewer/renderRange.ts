export type VisiblePagesRange = {
  startPage: number;
  endPage: number;
  numPages: number;
};

export type RenderRangeOptions = {
  /** Pages kept rendered behind the viewport. */
  pagesBehind?: number;
  /** Pages rendered ahead of the viewport, where scrolling usually goes. */
  pagesAhead?: number;
};

/**
 * Default render overscan. The window follows the latest visible range and
 * keeps ten pages on each side for smooth continuous reading in either
 * direction. This controls the viewer's rendered page window, not the PDF byte
 * cache, Blob URL cache, or every internal PDF.js decoded resource.
 */
const defaultPagesBehind = 10;
const defaultPagesAhead = 10;

/**
 * Builds the `setRenderRange` callback for the viewer. Returned bounds may fall
 * outside the document; the viewer clamps them to the real page count.
 */
export function createRenderRange({
  pagesBehind = defaultPagesBehind,
  pagesAhead = defaultPagesAhead,
}: RenderRangeOptions = {}) {
  return (range: VisiblePagesRange): { startPage: number; endPage: number } => ({
    startPage: range.startPage - pagesBehind,
    endPage: range.endPage + pagesAhead,
  });
}
