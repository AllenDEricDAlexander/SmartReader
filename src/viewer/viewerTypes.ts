export type ViewerSource = {
  sessionId: string;
  url: string;
};

export type ViewerProgress = {
  sessionId: string;
  page: number;
  totalPages: number | null;
  zoom: number;
};

export type ViewerHighlightArea = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

export type ViewerHighlightSelection = {
  selectedText: string;
  page: number;
  areas: ViewerHighlightArea[];
};
