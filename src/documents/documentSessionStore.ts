import { getDocumentKey, getFileSourceName, type FileSource } from '../platform/fileSource';
import type { PersistedDocument, PersistedReaderSession } from '../persistence/persistenceApi';
import type { DocumentSession, DocumentState, ProgressUpdate } from './documentModels';
import {
  createReadingHistory,
  pushHardNavigation,
  recordProgressOnly,
  stepBack,
  stepForward,
  type ReadingHistory,
} from './readingHistory';

export function createEmptyDocumentState(): DocumentState {
  return {
    sessions: [],
    activeSessionId: null,
    sidebarOpen: true,
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
    history: createReadingHistory(1),
    status: 'loading',
    errorMessage: null,
    restored: false,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...state,
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
        history: recordProgressOnly(session.history, update.page),
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
    sidebarOpen: state.sidebarOpen,
  };
}

export function restoreDocumentSessions(
  documents: PersistedDocument[],
  restoredSession?: PersistedReaderSession | null,
): DocumentState {
  if (!restoredSession) {
    return createEmptyDocumentState();
  }

  const tabsByDocumentKey = new Map(
    restoredSession.tabs.map((tab) => [tab.documentKey, tab]),
  );
  const sessions = documents
    .filter((document) => document.path && tabsByDocumentKey.has(document.documentKey))
    .map((document) => {
      const restoredTab = tabsByDocumentKey.get(document.documentKey);
      const source: FileSource = {
        kind: 'desktop-path',
        path: document.path!,
        name: document.displayName,
      };

      return {
        id: createSessionId(document.documentKey),
        documentKey: document.documentKey,
        title: document.displayName,
        source,
        page: restoredTab?.page ?? document.lastPage,
        totalPages: document.pageCount,
        progress: document.progress,
        zoom: restoredTab?.zoom ?? 1,
        history: restoredTab?.history ?? createReadingHistory(document.lastPage),
        status: document.missing ? 'error' : 'ready',
        errorMessage: document.missing ? 'File is missing' : null,
        restored: true,
        updatedAt: new Date().toISOString(),
      } satisfies DocumentSession;
    });

  const activeSessionId =
    sessions.find((session) => session.documentKey === restoredSession.activeDocumentKey)?.id ??
    sessions[0]?.id ??
    null;

  return {
    sessions,
    activeSessionId,
    sidebarOpen: restoredSession.sidebarOpen,
  };
}

export function selectSession(state: DocumentState, sessionId: string): DocumentState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }

  return { ...state, activeSessionId: sessionId };
}

export function selectNextSession(state: DocumentState): DocumentState {
  return selectRelativeSession(state, 1);
}

export function selectPreviousSession(state: DocumentState): DocumentState {
  return selectRelativeSession(state, -1);
}

export function recordHardNavigation(
  state: DocumentState,
  sessionId: string,
  page: number,
): DocumentState {
  return updateSessionHistory(state, sessionId, (history) => pushHardNavigation(history, page));
}

export function stepSessionHistoryBack(state: DocumentState, sessionId: string): DocumentState {
  return updateSessionHistory(state, sessionId, stepBack);
}

export function stepSessionHistoryForward(state: DocumentState, sessionId: string): DocumentState {
  return updateSessionHistory(state, sessionId, stepForward);
}

export function markSessionError(
  state: DocumentState,
  sessionId: string,
  errorMessage: string,
): DocumentState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId
        ? { ...session, status: 'error', errorMessage, updatedAt: new Date().toISOString() }
        : session,
    ),
  };
}

function selectRelativeSession(state: DocumentState, offset: number): DocumentState {
  if (!state.activeSessionId || state.sessions.length === 0) {
    return state;
  }

  const index = state.sessions.findIndex((session) => session.id === state.activeSessionId);
  const nextIndex = (index + offset + state.sessions.length) % state.sessions.length;
  return { ...state, activeSessionId: state.sessions[nextIndex].id };
}

function updateSessionHistory(
  state: DocumentState,
  sessionId: string,
  update: (history: ReadingHistory) => ReadingHistory,
): DocumentState {
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      const history = update(session.history);
      return {
        ...session,
        history,
        page: history.currentPage,
        progress: calculateProgress(history.currentPage, session.totalPages),
        updatedAt: new Date().toISOString(),
      };
    }),
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
