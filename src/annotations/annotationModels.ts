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
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnotationKind = 'highlight' | 'underline' | 'note';

export type AnnotationColorOption = {
  value: string;
  label: string;
};

/** Palette offered when marking up a selection; index 0 is the default. */
export const annotationColors: AnnotationColorOption[] = [
  { value: '#facc15', label: '黄色' },
  { value: '#4ade80', label: '绿色' },
  { value: '#60a5fa', label: '蓝色' },
  { value: '#f472b6', label: '粉色' },
  { value: '#fb923c', label: '橙色' },
];

export const defaultAnnotationColor = annotationColors[0].value;

/** Page-level notes are visually distinct from selection markup. */
export const pageNoteColor = '#38bdf8';

export type ReaderAnnotation = {
  id: number | null;
  documentKey: string;
  page: number;
  type: AnnotationKind;
  color: string;
  text: string | null;
  quote: string | null;
  areas: HighlightAreaRecord[];
  tagIds?: number[];
  createdAt: string;
  updatedAt: string;
};
