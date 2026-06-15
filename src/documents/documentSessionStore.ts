import { getDocumentKey, getFileSourceName, type FileSource } from '../platform/fileSource';
import type { DocumentSession, DocumentState, ProgressUpdate } from './documentModels';

export function createEmptyDocumentState(): DocumentState {
  return {
    sessions: [],
    activeSessionId: null,
  };
}

export function addDocumentSession(state: DocumentState, source: FileSource): DocumentState {
  const documentKey = getDocumentKey(source);
  const existing = state.sessions.find((session) => session.documentKey === documentKey);

  if (existing) {
    return {
      ...state,
      activeSessionId: existing.id,
    };
  }

  const session: DocumentSession = {
    id: createSessionId(documentKey),
    documentKey,
    title: getFileSourceName(source),
    source,
    page: 1,
    totalPages: null,
    progress: 0,
    zoom: 1,
    status: 'loading',
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  };

  return {
    sessions: [...state.sessions, session],
    activeSessionId: session.id,
  };
}

export function updateSessionProgress(
  state: DocumentState,
  sessionId: string,
  update: ProgressUpdate,
): DocumentState {
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      return {
        ...session,
        page: update.page,
        totalPages: update.totalPages,
        zoom: update.zoom,
        progress: calculateProgress(update.page, update.totalPages),
        status: 'ready',
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function closeDocumentSession(state: DocumentState, sessionId: string): DocumentState {
  const closingIndex = state.sessions.findIndex((session) => session.id === sessionId);
  const sessions = state.sessions.filter((session) => session.id !== sessionId);

  if (state.activeSessionId !== sessionId) {
    return {
      ...state,
      sessions,
    };
  }

  const fallbackIndex = Math.max(0, closingIndex - 1);
  const activeSessionId = sessions[fallbackIndex]?.id ?? null;

  return {
    sessions,
    activeSessionId,
  };
}

function calculateProgress(page: number, totalPages: number | null): number {
  if (!totalPages || totalPages <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, page / totalPages));
}

function createSessionId(documentKey: string): string {
  const encodedKey = btoa(unescape(encodeURIComponent(documentKey)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `session-${encodedKey}`;
}
