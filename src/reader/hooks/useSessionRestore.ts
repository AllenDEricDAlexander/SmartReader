import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import { PdfByteCache } from '../../cache/pdfByteCache';
import type { DocumentState } from '../../documents/documentModels';
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

type UseSessionRestoreInput = {
  bridge: TauriBridge;
  blobUrlCache: BlobUrlCache;
  loadDocumentDecorations(documentKey: string): Promise<void>;
  pdfByteCache: PdfByteCache;
  persistence: PersistenceApi;
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
  preferences,
  preferencesLoaded,
  setDocuments,
  setRecentDocuments,
  setSidebarOpen,
  setViewerSource,
}: UseSessionRestoreInput) {
  const restoredRef = useRef(false);
  const restoreSession = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const restoredDocuments = await persistence.listRecentDocuments();

      if (isCancelled()) {
        return;
      }

      setRecentDocuments(restoredDocuments);

      if (restoredDocuments.length === 0 || !preferences.sessionRestoreEnabled) {
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

        if (session.source.kind !== 'desktop-path') {
          continue;
        }

        try {
          const opened = await bridge.readDesktopPdf(session.source.path);

          if (isCancelled()) {
            return;
          }

          pdfByteCache.set(session.documentKey, opened.bytes);
          const url = blobUrlCache.createForSession(session.id, opened.bytes);

          if (session.id === restoredState.activeSessionId) {
            // Hand the persisted position to the viewer so it opens there
            // directly rather than painting page 1 and jumping afterwards.
            setViewerSource({
              sessionId: session.id,
              url,
              restore: { page: session.page, zoom: session.zoom },
            });
          }
        } catch (error) {
          if (!isCancelled()) {
            setDocuments((current) =>
              markSessionError(
                current,
                session.id,
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        }
      }
    },
    [
      bridge,
      blobUrlCache,
      loadDocumentDecorations,
      pdfByteCache,
      persistence,
      preferences,
      setDocuments,
      setRecentDocuments,
      setSidebarOpen,
      setViewerSource,
    ],
  );

  useEffect(() => {
    if (!preferencesLoaded || restoredRef.current) {
      return;
    }

    let cancelled = false;
    restoredRef.current = true;

    restoreSession(() => cancelled).catch(() => {
      if (!cancelled) {
        setDocuments(createEmptyDocumentState());
      }
    });

    return () => {
      cancelled = true;
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
      .filter((document) => document.path)
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
