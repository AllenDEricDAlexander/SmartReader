export type ViewerSource = {
  sessionId: string;
  url: string;
  /**
   * Reading position to open at, so a restored document paints at the right
   * place instead of rendering page 1 and jumping afterwards. Omitted for a
   * first-time open.
   */
  restore?: ViewerRestoreState;
};

export type ViewerRestoreState = {
  /** 1-based, matching the rest of the reader. */
  page: number;
  zoom?: number;
};

export type ViewerProgress = {
  sessionId: string;
  page: number;
  totalPages: number | null;
  zoom: number;
};

export type ViewerLoadStatus =
  | 'idle'
  | 'loading-document'
  | 'measuring-pages'
  | 'ready'
  | 'error'
  | 'timeout';

export type ViewerLoadError = {
  status: 'error' | 'timeout';
  message: string;
};

export type ViewerHighlightArea = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

/**
 * The annotation kinds a reader can produce directly from a text selection.
 * Page-level notes are created from the toolbar instead and never reach here.
 */
export type ViewerSelectionKind = 'highlight' | 'underline' | 'note';

export type ViewerHighlightSelection = {
  selectedText: string;
  page: number;
  areas: ViewerHighlightArea[];
  kind: ViewerSelectionKind;
  color: string;
};

export type ViewerSearchMatch = {
  /** 1-based position across the whole document, matching `jumpToMatch`. */
  index: number;
  page: number;
  excerpt: string;
};

export type ViewerSearchState = {
  keyword: string;
  matches: ViewerSearchMatch[];
  /** 1-based index of the focused match, or 0 when nothing is focused. */
  currentIndex: number;
};

export const emptySearchState: ViewerSearchState = {
  keyword: '',
  matches: [],
  currentIndex: 0,
};
