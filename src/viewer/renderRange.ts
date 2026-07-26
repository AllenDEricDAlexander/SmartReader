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
 * Default overscan. The viewer library keeps three pages on each side, so a
 * spread of seven pages holds canvases at once. Reading moves forward far more
 * often than backward, so the window is biased ahead and trimmed behind: the
 * same perceived smoothness for roughly half the resident canvases, which is
 * what large image-heavy documents are sensitive to.
 */
const defaultPagesBehind = 1;
const defaultPagesAhead = 2;

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
