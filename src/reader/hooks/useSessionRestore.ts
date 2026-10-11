import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import { PdfByteCache } from '../../cache/pdfByteCache';
import type { DocumentSession, DocumentState } from '../../documents/documentModels';
import {
  createEmptyDocumentState,
  markSessionError,
  restoreDocumentSessions,
} from '../../documents/documentSessionStore';
import type {
  PersistedDocument,
  PersistedReaderSession,
  PersistenceApi,
} from '../../persistence/persistenceApi';
import type { ReaderPreferences } from '../../preferences/preferencesModels';
import type { TauriBridge } from '../../platform/tauriBridge';
import type { ViewerSource } from '../../viewer/viewerTypes';
import type { LibraryService } from '../../library/libraryService';

type UseSessionRestoreInput = {
  bridge: TauriBridge;
  blobUrlCache: BlobUrlCache;
  loadDocumentDecorations(documentKey: string): Promise<void>;
  pdfByteCache: PdfByteCache;
  persistence: PersistenceApi;
  library?: LibraryService;
  preferences: ReaderPreferences;
  preferencesLoaded: boolean;
  setDocuments: Dispatch<SetStateAction<DocumentState>>;
  setRecentDocuments: Dispatch<SetStateAction<PersistedDocument[]>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setViewerSource: Dispatch<SetStateAction<ViewerSource | null>>;
};

export function useSessionRestore({
  bridge,
  blobUrlCache,
  loadDocumentDecorations,
  pdfByteCache,
  persistence,
  library,
  preferences,
  preferencesLoaded,
  setDocuments,
  setRecentDocuments,
  setSidebarOpen,
  setViewerSource,
}: UseSessionRestoreInput) {
  const restoredRef = useRef(false);
  const publishRestoredBytes = useCallback((session: DocumentSession, bytes: Uint8Array, canRestore: () => boolean) => {
    setDocuments((current) => {
      if (!canRestore()) return current;
      const live = current.sessions.find((item) => item.id === session.id && item.source === session.source);
      if (!live) return current;

      // State updaters can replay. Reuse the URL, and never replace a newer open's bytes.
      let url = blobUrlCache.getForSession(live.id);
      if (!url) {
        pdfByteCache.set(live.documentKey, bytes);
        url = blobUrlCache.createForSession(live.id, bytes);
      }
      if (current.activeSessionId === live.id) {
        const source: ViewerSource = { sessionId: live.id, url, restore: { page: live.page, zoom: live.zoom } };
        setViewerSource((previous) => canRestore() ? source : previous);
      }
      return current;
    });
  }, [blobUrlCache, pdfByteCache, setDocuments, setViewerSource]);
  const restoreSession = useCallback(
    async (isCancelled: () => boolean = () => false, force = false) => {
      const restoredDocuments = await persistence.listRecentDocuments();

      if (isCancelled()) {
        return;
      }

      setRecentDocuments(restoredDocuments);

      if (restoredDocuments.length === 0 || (!force && !preferences.sessionRestoreEnabled)) {
        return;
      }

      const restoredSession = scopeRestoredSession(
        restoredDocuments,
        await persistence.loadReaderSession(),
        preferences.restoreScope,
      );

      if (isCancelled() || !restoredSession) {
        return;
      }

      const restoredState = restoreDocumentSessions(restoredDocuments, restoredSession);

      if (restoredState.sessions.length === 0) {
        return;
      }

      setDocuments(restoredState);
      setSidebarOpen(restoredState.sidebarOpen);

      for (const session of restoredState.sessions) {
        if (
          restoredSession &&
          !restoredSession.tabs.some((tab) => tab.documentKey === session.documentKey)
        ) {
          continue;
        }

        void loadDocumentDecorations(session.documentKey);

        if (session.source.kind === 'library' && library) {
          const access = library.captureAccess();
          const paperId = session.source.paperId;
          try {
            const bytes = await library.readPdf(paperId);
            publishRestoredBytes(session, bytes, () => !isCancelled() && library.canAccess(paperId, access));
          } catch (error) {
            setDocuments((current) => !isCancelled() && library.canAccess(paperId, access)
              && current.sessions.some((item) => item.id === session.id && item.source === session.source)
              ? markSessionError(current, session.id, error instanceof Error ? error.message : String(error)) : current);
          }
          continue;
        }
        if (session.source.kind !== 'desktop-path') {
          continue;
        }

        try {
          const opened = await bridge.readDesktopPdf(session.source.path);

          if (isCancelled()) {
            return;
          }

          publishRestoredBytes(session, opened.bytes, () => !isCancelled());
        } catch (error) {
          if (!isCancelled()) {
            setDocuments((current) => !isCancelled()
              && current.sessions.some((item) => item.id === session.id && item.source === session.source)
              ? markSessionError(current, session.id, error instanceof Error ? error.message : String(error)) : current);
          }
        }
      }
    },
    [
      bridge,
      loadDocumentDecorations,
      persistence,
      publishRestoredBytes,
      library,
      preferences,
      setDocuments,
      setRecentDocuments,
      setSidebarOpen,
    ],
  );

  useEffect(() => {
    if (!preferencesLoaded || restoredRef.current) {
      return;
    }

    let cancelled = false;
    let completed = false;
    restoredRef.current = true;

    restoreSession(() => cancelled).catch(() => {
      if (!cancelled) {
        setDocuments(createEmptyDocumentState());
      }
    }).finally(() => { completed = true; });

    return () => {
      cancelled = true;
      if (!completed) restoredRef.current = false;
    };
  }, [preferencesLoaded, restoreSession, setDocuments]);

  return { restoreSession };
}

function scopeRestoredSession(
  documents: PersistedDocument[],
  restoredSession: PersistedReaderSession | null,
  restoreScope: ReaderPreferences['restoreScope'],
): PersistedReaderSession | null {
  if (!restoredSession || restoreScope === 'all') {
    return restoredSession;
  }

  const restorableDocumentKeys = new Set(
    documents
      .filter((document) => document.path || document.documentKey.startsWith('paper:'))
      .map((document) => document.documentKey),
  );
  const tabsByDocumentKey = new Map(
    restoredSession.tabs.map((tab) => [tab.documentKey, tab]),
  );
  const activeDocumentKey =
    restoredSession.activeDocumentKey &&
    tabsByDocumentKey.has(restoredSession.activeDocumentKey) &&
    restorableDocumentKeys.has(restoredSession.activeDocumentKey)
      ? restoredSession.activeDocumentKey
      : restoredSession.tabs.find((tab) => restorableDocumentKeys.has(tab.documentKey))
          ?.documentKey ?? null;

  if (!activeDocumentKey) {
    return {
      ...restoredSession,
      activeDocumentKey: null,
      tabs: [],
    };
  }

  return {
    ...restoredSession,
    activeDocumentKey,
    tabs: [tabsByDocumentKey.get(activeDocumentKey)!],
  };
}
