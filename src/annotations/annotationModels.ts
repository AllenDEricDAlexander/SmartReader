export type HighlightAreaRecord = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

export type Bookmark = {
  id: number | null;
  documentKey: string;
  page: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ReaderAnnotation = {
  id: number | null;
  documentKey: string;
  page: number;
  type: 'highlight' | 'note';
  color: string;
  text: string | null;
  quote: string | null;
  areas: HighlightAreaRecord[];
  createdAt: string;
  updatedAt: string;
};
