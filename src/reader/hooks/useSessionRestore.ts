import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
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
  PersistenceApi,
} from '../../persistence/persistenceApi';
import type { TauriBridge } from '../../platform/tauriBridge';
import type { ViewerSource } from '../../viewer/viewerTypes';

type UseSessionRestoreInput = {
  bridge: TauriBridge;
  blobUrlCache: BlobUrlCache;
  loadDocumentDecorations(documentKey: string): Promise<void>;
  pdfByteCache: PdfByteCache;
  persistence: PersistenceApi;
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
  setDocuments,
  setRecentDocuments,
  setSidebarOpen,
  setViewerSource,
}: UseSessionRestoreInput) {
  const restoreSession = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const [restoredDocuments, restoredSession] = await Promise.all([
        persistence.listRecentDocuments(),
        persistence.loadReaderSession(),
      ]);

      if (isCancelled() || restoredDocuments.length === 0) {
        return;
      }

      setRecentDocuments(restoredDocuments);
      const restoredState = restoreDocumentSessions(restoredDocuments, restoredSession);
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
            setViewerSource({ sessionId: session.id, url });
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
      setDocuments,
      setRecentDocuments,
      setSidebarOpen,
      setViewerSource,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    restoreSession(() => cancelled).catch(() => {
      if (!cancelled) {
        setDocuments(createEmptyDocumentState());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [restoreSession, setDocuments]);

  return { restoreSession };
}
