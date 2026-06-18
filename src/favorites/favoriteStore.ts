export function setFavoriteFlag<T extends { documentKey: string; favorite: boolean }>(
  documents: T[],
  documentKey: string,
  favorite: boolean,
): T[] {
  return documents.map((document) =>
    document.documentKey === documentKey ? { ...document, favorite } : document,
  );
}
