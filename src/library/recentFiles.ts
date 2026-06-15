import type { PersistedDocument } from '../persistence/persistenceApi';

export type RecentFileCard = {
  documentKey: string;
  title: string;
  path: string | null;
  progressLabel: string;
  lastPageLabel: string;
  missing: boolean;
};

export function mapDocumentsToRecentFiles(documents: PersistedDocument[]): RecentFileCard[] {
  return sortRecentFiles(
    documents.map((document) => ({
      documentKey: document.documentKey,
      title: document.displayName,
      path: document.path,
      progressLabel: `${Math.round(document.progress * 100)}%`,
      lastPageLabel: `Page ${document.lastPage}`,
      missing: document.missing,
    })),
  );
}

export function sortRecentFiles(files: RecentFileCard[]): RecentFileCard[] {
  return [...files].sort((left, right) => Number(left.missing) - Number(right.missing));
}
