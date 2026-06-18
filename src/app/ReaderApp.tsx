import { useEffect, useMemo, useState } from 'react';
import { BlobUrlCache } from '../cache/blobUrlCache';
import { PdfByteCache } from '../cache/pdfByteCache';
import {
  createEmptyDocumentState,
  markSessionError,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { HomeDashboard } from '../home/HomeDashboard';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { ReaderEmptyState } from '../reader/ReaderEmptyState';
import { ReaderErrorState } from '../reader/ReaderErrorState';
import { useDocumentOpening } from '../reader/hooks/useDocumentOpening';
import { useReaderCommands } from '../reader/hooks/useReaderCommands';
import { useReaderDecorations } from '../reader/hooks/useReaderDecorations';
import { useReaderNavigation } from '../reader/hooks/useReaderNavigation';
import { useReaderPersistence } from '../reader/hooks/useReaderPersistence';
import { useSessionRestore } from '../reader/hooks/useSessionRestore';
import { ReaderLeftPanel } from '../reader/ReaderLeftPanel';
import { ReaderRightPanel } from '../reader/ReaderRightPanel';
import { ReaderStatusBar } from '../reader/ReaderStatusBar';
import { ReaderTabs } from '../reader/ReaderTabs';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { ReaderWorkspace } from '../reader/ReaderWorkspace';
import { PdfViewerBridge } from '../viewer/PdfViewerBridge';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';
import type { ReaderAppProps } from './appTypes';

export function ReaderApp({
  bridge: providedBridge,
  persistence: providedPersistence,
  viewerController,
  viewerRenderer,
}: ReaderAppProps) {
  const { bridge, persistence, sessionPersistence } = useReaderPersistence({
    bridge: providedBridge,
    persistence: providedPersistence,
  });
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [pageInput, setPageInput] = useState('');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [readerPreferences, setReaderPreferences] = useState(defaultReaderPreferences);
  const [recentDocuments, setRecentDocuments] = useState<PersistedDocument[]>([]);
  const [favoriteDocuments, setFavoriteDocuments] = useState<FavoriteDocument[]>([]);
  const blobUrlCache = useMemo(() => new BlobUrlCache(), []);
  const pdfByteCache = useMemo(() => new PdfByteCache(), []);
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;
  const bridgeViewerController =
    activeViewerController instanceof ViewerController
      ? activeViewerController
      : defaultViewerController;

  const activeSession =
    documents.sessions.find((session) => session.id === documents.activeSessionId) ?? null;

  const {
    annotationsByDocument,
    bookmarksByDocument,
    addBookmarkForActivePage,
    addPageNote,
    deleteAnnotationForDocument,
    importAnnotationsForDocument,
    loadDocumentDecorations,
    saveAnnotationForActiveDocument,
  } = useReaderDecorations({ activeSession, persistence });

  useSessionRestore({
    bridge,
    blobUrlCache,
    loadDocumentDecorations,
    pdfByteCache,
    persistence,
    setDocuments,
    setRecentDocuments,
    setSidebarOpen,
    setViewerSource,
  });

  useEffect(() => {
    let cancelled = false;

    persistence
      .listFavoriteDocuments()
      .then((favorites) => {
        if (!cancelled) {
          setFavoriteDocuments(favorites);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [persistence]);

  useEffect(() => {
    if (documents.sessions.length === 0) {
      return;
    }

    sessionPersistence.schedule({
      activeDocumentKey: activeSession?.documentKey ?? null,
      sidebarOpen,
      tabs: documents.sessions
        .filter((session) => session.source.kind === 'desktop-path')
        .map((session, tabOrder) => ({
          documentKey: session.documentKey,
          tabOrder,
          page: session.page,
          zoom: session.zoom,
          history: session.history,
        })),
    });
  }, [documents, activeSession, sidebarOpen, sessionPersistence]);

  useEffect(() => {
    const flushBeforeUnload = () => {
      void sessionPersistence.flushNow();
    };

    window.addEventListener('beforeunload', flushBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', flushBeforeUnload);
      sessionPersistence.cancel();
    };
  }, [sessionPersistence]);

  const {
    handleBrowserFileChange,
    handleDrop,
    openPdf,
    reopenDesktopSession,
    reopenRecentDocument,
  } = useDocumentOpening({
    blobUrlCache,
    bridge,
    documents,
    loadDocumentDecorations,
    pdfByteCache,
    persistence,
    setDocuments,
    setRecentDocuments,
    setViewerSource,
  });

  const {
    closeActiveTab,
    handleViewerWheel,
    jumpToActiveDocumentPage,
    jumpToPage,
    selectReaderSession,
    stepHistoryBack,
    stepHistoryForward,
  } = useReaderNavigation({
    activeSession,
    activeViewerController,
    blobUrlCache,
    setDocuments,
    setViewerSource,
  });

  const { commandRegistry } = useReaderCommands({
    activeSession,
    activeViewerController,
    addBookmarkForActivePage,
    addPageNote,
    closeActiveTab,
    openPdf,
    setDocuments,
    setPreferencesOpen,
    setSidebarOpen,
    stepHistoryBack,
    stepHistoryForward,
  });

  const activeBookmarks = activeSession
    ? (bookmarksByDocument[activeSession.documentKey] ?? [])
    : [];
  const activeAnnotations = activeSession
    ? (annotationsByDocument[activeSession.documentKey] ?? [])
    : [];
  const viewerContent = activeSession ? (
    activeSession.status === 'error' ? (
      <ReaderErrorState
        title={activeSession.title}
        message={activeSession.errorMessage}
        canRetry={activeSession.source.kind === 'desktop-path'}
        onRetry={() => reopenDesktopSession(activeSession.id)}
      />
    ) : (
      <PdfViewerBridge
        source={viewerSource}
        annotations={activeAnnotations}
        controller={bridgeViewerController}
        renderer={viewerRenderer}
        onHighlightSelection={(selection) =>
          void saveAnnotationForActiveDocument({
            page: selection.page,
            type: 'highlight',
            color: '#facc15',
            text: null,
            quote: selection.selectedText,
            areas: selection.areas,
          })
        }
        onProgressChange={(progress) => {
          setDocuments((current) =>
            updateSessionProgress(current, progress.sessionId, {
              page: progress.page,
              totalPages: progress.totalPages,
              zoom: progress.zoom,
            }),
          );
        }}
        onLoadError={(error) => {
          setDocuments((current) =>
            activeSession ? markSessionError(current, activeSession.id, error.message) : current,
          );
        }}
      />
    )
  ) : (
    <ReaderEmptyState onOpenPdf={openPdf} />
  );

  return (
    <main
      className={activeSession ? 'app-shell reader-mode' : 'app-shell home-mode'}
      aria-label="SmartReader workbench"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {activeSession ? (
        <ReaderWorkspace
          sidebarOpen={sidebarOpen}
          tabs={
            <ReaderTabs
              sessions={documents.sessions}
              activeSessionId={documents.activeSessionId}
              onSelectSession={selectReaderSession}
            />
          }
          toolbar={
            <ReaderToolbar
              activeSession={activeSession}
              searchText={searchText}
              pageInput={pageInput}
              onOpenPdf={openPdf}
              onBrowserFileChange={handleBrowserFileChange}
              onSearchTextChange={setSearchText}
              onPageInputChange={setPageInput}
              onOpenSearch={() => activeViewerController.openSearch()}
              onSearch={() => activeViewerController.search(searchText)}
              onJumpToPage={() => jumpToPage(Number(pageInput))}
              onFitWidth={() => activeViewerController.fitWidth()}
              onFitPage={() => activeViewerController.fitPage()}
              onZoomIn={() => activeViewerController.zoomIn()}
              onZoomOut={() => activeViewerController.zoomOut()}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
              onCloseActiveTab={closeActiveTab}
              onHistoryBack={stepHistoryBack}
              onHistoryForward={stepHistoryForward}
              onAddBookmark={addBookmarkForActivePage}
              onAddNote={addPageNote}
              onOpenPreferences={() => setPreferencesOpen(true)}
            />
          }
          leftPanel={
            <ReaderLeftPanel
              activeSession={activeSession}
              recentDocuments={recentDocuments}
              bookmarks={activeBookmarks}
              annotations={activeAnnotations}
              onJumpToPage={jumpToActiveDocumentPage}
              onReopenRecentDocument={reopenRecentDocument}
              onAddBookmark={addBookmarkForActivePage}
              onDeleteAnnotation={(annotationId) =>
                deleteAnnotationForDocument(activeSession.documentKey, annotationId)
              }
              onImportAnnotations={(json) =>
                importAnnotationsForDocument(activeSession.documentKey, json)
              }
            />
          }
          viewer={<div onWheel={handleViewerWheel}>{viewerContent}</div>}
          rightPanel={
            <ReaderRightPanel
              activeSession={activeSession}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onOpenSearch={() => activeViewerController.openSearch()}
              onSearch={() => activeViewerController.search(searchText)}
            />
          }
          statusBar={<ReaderStatusBar activeSession={activeSession} />}
        />
      ) : (
        <HomeDashboard
          recentDocuments={recentDocuments}
          favoriteDocuments={favoriteDocuments}
          onOpenPdf={openPdf}
          onBrowserFileChange={handleBrowserFileChange}
          onReopenRecentDocument={reopenRecentDocument}
        />
      )}
      {preferencesOpen ? (
        <section role="dialog" aria-label="Preferences" className="preferences-panel">
          <header>
            <h2>Preferences</h2>
            <button type="button" onClick={() => setPreferencesOpen(false)}>
              Close
            </button>
          </header>
          <label>
            <input
              type="checkbox"
              checked={readerPreferences.sessionRestoreEnabled}
              onChange={(event) =>
                setReaderPreferences((current) => ({
                  ...current,
                  sessionRestoreEnabled: event.target.checked,
                }))
              }
            />
            Session restore
          </label>
          <section>
            <h3>Shortcut conflicts</h3>
            {commandRegistry.getShortcutConflicts().length === 0 ? (
              <p>No conflicts</p>
            ) : (
              commandRegistry.getShortcutConflicts().map((conflict) => (
                <p key={conflict.shortcut}>
                  {conflict.shortcut}: {conflict.commandIds.join(', ')}
                </p>
              ))
            )}
          </section>
        </section>
      ) : null}
    </main>
  );
}
