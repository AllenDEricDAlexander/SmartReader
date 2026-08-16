import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import type { DocumentSession, DocumentState } from '../../documents/documentModels';
import {
  closeDocumentSession,
  recordHardNavigation,
  selectNextSession,
  selectPreviousSession,
  selectSession,
  stepSessionHistoryBack,
  stepSessionHistoryForward,
} from '../../documents/documentSessionStore';
import type { ViewerActions } from '../../viewer/viewerController';
import type { ViewerSource } from '../../viewer/viewerTypes';

type UseReaderNavigationInput = {
  activeSession: DocumentSession | null;
  activeViewerController: ViewerActions;
  blobUrlCache: BlobUrlCache;
  setDocuments: Dispatch<SetStateAction<DocumentState>>;
  setViewerSource: Dispatch<SetStateAction<ViewerSource | null>>;
};

export function useReaderNavigation({
  activeSession,
  activeViewerController,
  blobUrlCache,
  setDocuments,
  setViewerSource,
}: UseReaderNavigationInput) {
  const syncViewerSource = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) {
        setViewerSource(null);
        return;
      }

      const url = blobUrlCache.getForSession(sessionId);
      setViewerSource(url ? { sessionId, url } : null);
    },
    [blobUrlCache, setViewerSource],
  );

  const selectReaderSession = useCallback(
    (sessionId: string) => {
      setDocuments((current) => {
        const next = selectSession(current, sessionId);
        syncViewerSource(next.activeSessionId);
        return next;
      });
    },
    [setDocuments, syncViewerSource],
  );

  const closeReaderSession = useCallback(
    (sessionId: string) => {
      blobUrlCache.revokeForSession(sessionId);
      setDocuments((current) => {
        const previousActiveSessionId = current.activeSessionId;
        const next = closeDocumentSession(current, sessionId);

        if (next.activeSessionId !== previousActiveSessionId) {
          syncViewerSource(next.activeSessionId);
        }

        return next;
      });
    },
    [blobUrlCache, setDocuments, syncViewerSource],
  );

  const closeActiveTab = useCallback(() => {
    if (!activeSession) {
      return;
    }

    closeReaderSession(activeSession.id);
  }, [activeSession, closeReaderSession]);

  const selectNextReaderSession = useCallback(() => {
    setDocuments((current) => {
      const next = selectNextSession(current);
      syncViewerSource(next.activeSessionId);
      return next;
    });
  }, [setDocuments, syncViewerSource]);

  const selectPreviousReaderSession = useCallback(() => {
    setDocuments((current) => {
      const next = selectPreviousSession(current);
      syncViewerSource(next.activeSessionId);
      return next;
    });
  }, [setDocuments, syncViewerSource]);

  const jumpToPage = useCallback(
    (page: number) => {
      if (Number.isInteger(page) && page > 0) {
        if (activeSession) {
          setDocuments((current) => recordHardNavigation(current, activeSession.id, page));
        }
        activeViewerController.jumpToPage(page);
      }
    },
    [activeSession, activeViewerController, setDocuments],
  );

  const jumpToActiveDocumentPage = useCallback(
    (page: number) => {
      if (!activeSession) {
        return;
      }

      setDocuments((current) => recordHardNavigation(current, activeSession.id, page));
      activeViewerController.jumpToPage(page);
    },
    [activeSession, activeViewerController, setDocuments],
  );

  const stepHistoryBack = useCallback(() => {
    if (!activeSession) {
      return;
    }

    const previousPage = activeSession.history.backStack.at(-1) ?? activeSession.page;
    setDocuments((current) => stepSessionHistoryBack(current, activeSession.id));
    activeViewerController.jumpToPage(previousPage);
  }, [activeSession, activeViewerController, setDocuments]);

  const stepHistoryForward = useCallback(() => {
    if (!activeSession) {
      return;
    }

    const nextPage = activeSession.history.forwardStack[0] ?? activeSession.page;
    setDocuments((current) => stepSessionHistoryForward(current, activeSession.id));
    activeViewerController.jumpToPage(nextPage);
  }, [activeSession, activeViewerController, setDocuments]);

  const handleViewerWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();

      if (event.deltaY < 0) {
        activeViewerController.zoomIn();
      } else {
        activeViewerController.zoomOut();
      }
    },
    [activeViewerController],
  );

  return {
    closeActiveTab,
    closeReaderSession,
    handleViewerWheel,
    jumpToActiveDocumentPage,
    jumpToPage,
    selectNextReaderSession,
    selectPreviousReaderSession,
    selectReaderSession,
    stepHistoryBack,
    stepHistoryForward,
  };
}
