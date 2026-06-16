import type { Bookmark, ReaderAnnotation } from './annotationModels';

export function addOrReplaceBookmark(bookmarks: Bookmark[], bookmark: Bookmark): Bookmark[] {
  const withoutExisting =
    bookmark.id === null ? bookmarks : bookmarks.filter((item) => item.id !== bookmark.id);

  return [...withoutExisting, bookmark].sort(
    (left, right) => left.page - right.page || left.title.localeCompare(right.title),
  );
}

export function removeBookmark(bookmarks: Bookmark[], id: number): Bookmark[] {
  return bookmarks.filter((bookmark) => bookmark.id !== id);
}

export function addOrReplaceAnnotation(
  annotations: ReaderAnnotation[],
  annotation: ReaderAnnotation,
): ReaderAnnotation[] {
  const withoutExisting =
    annotation.id === null ? annotations : annotations.filter((item) => item.id !== annotation.id);

  return [...withoutExisting, annotation].sort(
    (left, right) => left.page - right.page || left.createdAt.localeCompare(right.createdAt),
  );
}

export function removeAnnotation(annotations: ReaderAnnotation[], id: number): ReaderAnnotation[] {
  return annotations.filter((annotation) => annotation.id !== id);
}

export function exportAnnotations(annotations: ReaderAnnotation[]): string {
  return JSON.stringify({ version: 1, annotations }, null, 2);
}

export function importAnnotations(json: string): ReaderAnnotation[] {
  const parsed = JSON.parse(json) as { version?: number; annotations?: ReaderAnnotation[] };

  if (parsed.version !== 1 || !Array.isArray(parsed.annotations)) {
    throw new Error('Unsupported annotation export');
  }

  return parsed.annotations;
}
