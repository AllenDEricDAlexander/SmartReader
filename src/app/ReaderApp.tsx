import { FileText, FolderOpen, PanelLeftClose, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { exportAnnotations } from '../annotations/annotationStore';
import { BlobUrlCache } from '../cache/blobUrlCache';
import { PdfByteCache } from '../cache/pdfByteCache';
import {
  createEmptyDocumentState,
  markSessionError,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import { mapDocumentsToRecentFiles } from '../library/recentFiles';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { useDocumentOpening } from '../reader/hooks/useDocumentOpening';
import { useReaderCommands } from '../reader/hooks/useReaderCommands';
import { useReaderDecorations } from '../reader/hooks/useReaderDecorations';
import { useReaderNavigation } from '../reader/hooks/useReaderNavigation';
import { useReaderPersistence } from '../reader/hooks/useReaderPersistence';
import { useSessionRestore } from '../reader/hooks/useSessionRestore';
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

  return (
    <main
      className="app-shell"
      aria-label="SmartReader workbench"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="tab-strip" aria-label="Open documents">
        {documents.sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="tab"
            aria-selected={session.id === documents.activeSessionId}
            className={session.id === documents.activeSessionId ? 'tab active' : 'tab'}
            onClick={() => selectReaderSession(session.id)}
          >
            <FileText size={14} />
            {session.title}
          </button>
        ))}
      </header>

      <section className="toolbar" aria-label="Reader tools">
        <button type="button" onClick={openPdf} aria-label="Open PDF">
          <FolderOpen size={16} />
          Open PDF
        </button>
        <label className="file-picker-button">
          <FolderOpen size={16} />
          Choose
          <input
            aria-label="Choose PDF file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleBrowserFileChange}
          />
        </label>
        <button type="button" aria-label="Find in PDF">
          <Search size={16} />
        </button>
        <input
          aria-label="Search text"
          className="toolbar-input"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onFocus={() => activeViewerController.openSearch()}
        />
        <button
          type="button"
          onClick={() => activeViewerController.search(searchText)}
          aria-label="Search PDF"
        >
          <Search size={16} />
        </button>
        <input
          aria-label="Page number"
          className="page-input"
          inputMode="numeric"
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
        />
        <button
          type="button"
          onClick={() => jumpToPage(Number(pageInput))}
          aria-label="Go to page"
        >
          Go
        </button>
        <button
          type="button"
          onClick={() => activeViewerController.fitWidth()}
          aria-label="Fit width"
        >
          Fit width
        </button>
        <button type="button" onClick={() => activeViewerController.fitPage()} aria-label="Fit page">
          Fit page
        </button>
        <button type="button" onClick={() => activeViewerController.zoomOut()} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={() => activeViewerController.zoomIn()} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label="Toggle sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
        <button type="button" onClick={closeActiveTab} disabled={!activeSession}>
          Close
        </button>
        {activeSession ? (
          <span className="toolbar-status">
            Page {activeSession.page}
            {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''}
          </span>
        ) : null}
      </section>

      <section className={sidebarOpen ? 'reader-grid' : 'reader-grid sidebar-collapsed'}>
        {sidebarOpen ? (
          <aside className="side-panel">
            <h2>Reading</h2>
            {activeSession ? (
              <>
                <p>{Math.round(activeSession.progress * 100)}% complete</p>
                <section className="side-section">
                  <h3>Bookmarks</h3>
                  {(bookmarksByDocument[activeSession.documentKey] ?? []).map((bookmark) => (
                    <button
                      key={bookmark.id ?? `${bookmark.page}-${bookmark.title}`}
                      type="button"
                      className="side-list-item"
                      onClick={() => jumpToActiveDocumentPage(bookmark.page)}
                    >
                      {bookmark.title}
                    </button>
                  ))}
                  <button type="button" onClick={() => void addBookmarkForActivePage()}>
                    Add bookmark
                  </button>
                </section>
                <section className="side-section">
                  <h3>Annotations</h3>
                  <div className="annotation-actions">
                    <button
                      type="button"
                      onClick={() => {
                        const json = exportAnnotations(
                          annotationsByDocument[activeSession.documentKey] ?? [],
                        );
                        void navigator.clipboard?.writeText(json);
                      }}
                    >
                      Export annotations
                    </button>
                  </div>
                  {(annotationsByDocument[activeSession.documentKey] ?? []).map((annotation) => (
                    <div
                      key={annotation.id ?? `${annotation.page}-${annotation.createdAt}`}
                      className="side-list-row"
                    >
                      <button
                        type="button"
                        className="side-list-item"
                        onClick={() => jumpToActiveDocumentPage(annotation.page)}
                      >
                        Page {annotation.page}:{' '}
                        {annotation.quote ?? annotation.text ?? annotation.type}
                      </button>
                      {annotation.id ? (
                        <button
                          type="button"
                          aria-label="Delete annotation"
                          onClick={() => {
                            deleteAnnotationForDocument(activeSession.documentKey, annotation.id!);
                          }}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <textarea
                    aria-label="Annotation import JSON"
                    className="annotation-import"
                    onBlur={(event) => {
                      if (!event.target.value.trim()) {
                        return;
                      }

                      importAnnotationsForDocument(activeSession.documentKey, event.target.value);
                    }}
                  />
                </section>
              </>
            ) : (
              <p>No document selected</p>
            )}
          </aside>
        ) : null}

        <section className="viewer-pane" onWheel={handleViewerWheel}>
          {activeSession ? (
            activeSession.status === 'error' ? (
              <section className="reader-error" role="alert">
                <h2>{activeSession.title}</h2>
                <p>{activeSession.errorMessage}</p>
                {activeSession.source.kind === 'desktop-path' ? (
                  <button type="button" onClick={() => void reopenDesktopSession(activeSession.id)}>
                    Retry
                  </button>
                ) : null}
              </section>
            ) : (
              <PdfViewerBridge
                source={viewerSource}
                annotations={
                  activeSession ? (annotationsByDocument[activeSession.documentKey] ?? []) : []
                }
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
                    activeSession
                      ? markSessionError(current, activeSession.id, error.message)
                      : current,
                  );
                }}
              />
            )
          ) : (
            <section className="empty-reader" aria-label="SmartReader empty reader">
              <p className="eyebrow">SmartReader</p>
              <h1>Open a PDF to start reading</h1>
              <p>Use the file picker, drag a PDF here, or open one from the desktop app menu.</p>
              {recentDocuments.length > 0 ? (
                <div className="recent-grid">
                  {mapDocumentsToRecentFiles(recentDocuments).map((file) => (
                    <button
                      key={file.documentKey}
                      type="button"
                      className={file.missing ? 'recent-card missing' : 'recent-card'}
                      aria-label={`Open recent ${file.title}`}
                      title={file.path ?? ''}
                      onClick={() => {
                        const document = recentDocuments.find(
                          (candidate) => candidate.documentKey === file.documentKey,
                        );

                        if (document) {
                          void reopenRecentDocument(document);
                        }
                      }}
                    >
                      <strong>{file.title}</strong>
                      <span>{file.progressLabel}</span>
                      <span>{file.lastPageLabel}</span>
                      <span>{file.fileSizeLabel}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          )}
        </section>
      </section>
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
