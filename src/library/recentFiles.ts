import type { PersistedDocument } from '../persistence/persistenceApi';

export type RecentFileCard = {
  documentKey: string;
  title: string;
  path: string | null;
  progressLabel: string;
  lastPageLabel: string;
  fileSizeLabel: string;
  modifiedAtLabel: string;
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
      fileSizeLabel: formatFileSize(document.fileSize),
      modifiedAtLabel: document.modifiedAt ?? 'Unknown modified time',
      missing: document.missing,
    })),
  );
}

export function sortRecentFiles(files: RecentFileCard[]): RecentFileCard[] {
  return [...files].sort((left, right) => Number(left.missing) - Number(right.missing));
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) {
    return 'Unknown size';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
