import type { DocumentSession } from '../documents/documentModels';
import type { PersistedDocument, PersistedSessionTab } from '../persistence/persistenceApi';

export function mapSessionToPersistedDocument(
  session: DocumentSession,
  previousDocument?: PersistedDocument | null,
): PersistedDocument {
  return {
    documentKey: session.documentKey,
    path: session.source.kind === 'desktop-path' ? session.source.path : null,
    displayName: session.title,
    fileSize:
      session.source.kind === 'browser-file'
        ? session.source.file.size
        : previousDocument?.fileSize ?? null,
    modifiedAt:
      session.source.kind === 'browser-file'
        ? new Date(session.source.file.lastModified).toISOString()
        : previousDocument?.modifiedAt ?? null,
    pageCount: session.totalPages,
    lastPage: session.page,
    progress: session.progress,
    missing: false,
  };
}

export function upsertRecentDocument(
  documents: PersistedDocument[],
  document: PersistedDocument,
): PersistedDocument[] {
  const existingIndex = documents.findIndex(
    (candidate) => candidate.documentKey === document.documentKey,
  );

  if (existingIndex === -1) {
    return [document, ...documents];
  }

  return [
    document,
    ...documents.slice(0, existingIndex),
    ...documents.slice(existingIndex + 1),
  ];
}

export function mergeRecentDocuments(
  current: PersistedDocument[],
  restored: PersistedDocument[],
): PersistedDocument[] {
  return restored.reduce(
    (documents, document) => upsertRecentDocument(documents, document),
    current,
  );
}

export function mapSessionsToPersistedTabs(sessions: DocumentSession[]): PersistedSessionTab[] {
  return sessions
    .filter((session) => session.source.kind === 'desktop-path')
    .map((session, tabOrder) => ({
      documentKey: session.documentKey,
      tabOrder,
      page: session.page,
      zoom: session.zoom,
      history: session.history,
    }));
}

export function countRestorablePersistedTabs(tabs: PersistedSessionTab[]): number {
  return tabs.filter((tab) => tab.documentKey.startsWith('desktop:')).length;
}
