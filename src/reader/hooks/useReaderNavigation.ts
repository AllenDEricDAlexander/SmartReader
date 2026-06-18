import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import type { DocumentSession, DocumentState } from '../../documents/documentModels';
import {
  closeDocumentSession,
  recordHardNavigation,
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
  const selectReaderSession = useCallback(
    (sessionId: string) => {
      setDocuments((current) => selectSession(current, sessionId));
      const url = blobUrlCache.getForSession(sessionId);
      setViewerSource(url ? { sessionId, url } : null);
    },
    [blobUrlCache, setDocuments, setViewerSource],
  );

  const closeActiveTab = useCallback(() => {
    if (!activeSession) {
      return;
    }

    blobUrlCache.revokeForSession(activeSession.id);
    setDocuments((current) => closeDocumentSession(current, activeSession.id));
    setViewerSource(null);
  }, [activeSession, blobUrlCache, setDocuments, setViewerSource]);

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
    handleViewerWheel,
    jumpToActiveDocumentPage,
    jumpToPage,
    selectReaderSession,
    stepHistoryBack,
    stepHistoryForward,
  };
}
