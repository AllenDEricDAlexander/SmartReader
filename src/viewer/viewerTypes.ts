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

/**
 * Metadata embedded in the PDF itself, as opposed to the file on disk.
 * Every field is optional: plenty of real documents carry none of it.
 */
export type ViewerDocumentInfo = {
  sessionId: string;
  pageCount: number;
  pdfVersion: string | null;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
};

export type ViewerSearchOptions = {
  matchCase: boolean;
  wholeWords: boolean;
};

export const defaultSearchOptions: ViewerSearchOptions = {
  matchCase: false,
  wholeWords: false,
};

export type ViewerSearchState = {
  keyword: string;
  matches: ViewerSearchMatch[];
  /** 1-based index of the focused match, or 0 when nothing is focused. */
  currentIndex: number;
  options: ViewerSearchOptions;
};

export const emptySearchState: ViewerSearchState = {
  keyword: '',
  matches: [],
  currentIndex: 0,
  options: defaultSearchOptions,
};
