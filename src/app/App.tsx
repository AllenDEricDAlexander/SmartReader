import { FileText, FolderOpen, PanelLeftClose, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import {
  addOrReplaceAnnotation,
  addOrReplaceBookmark,
  exportAnnotations,
  importAnnotations,
  removeAnnotation,
} from '../annotations/annotationStore';
import { BlobUrlCache } from '../cache/blobUrlCache';
import { PdfByteCache } from '../cache/pdfByteCache';
import { CommandRegistry, defaultShortcuts } from '../commands/commandRegistry';
import { handleShortcutEvent } from '../commands/shortcutController';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  markSessionError,
  recordHardNavigation,
  restoreDocumentSessions,
  selectNextSession,
  selectPreviousSession,
  stepSessionHistoryBack,
  stepSessionHistoryForward,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import { mapDocumentsToRecentFiles } from '../library/recentFiles';
import { fileToBrowserSource } from '../platform/browserFilePicker';
import { getPdfFilesFromDrop } from '../platform/dropZone';
import { getDocumentKey, type FileSource } from '../platform/fileSource';
import { listenForOpenWith } from '../platform/openWithEvents';
import { createTauriBridge, type TauriBridge } from '../platform/tauriBridge';
import { createDebouncedFlush } from '../persistence/debounce';
import {
  createPersistenceApi,
  type PersistedDocument,
  type PersistenceApi,
} from '../persistence/persistenceApi';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { PdfViewerBridge, type PdfRenderer } from '../viewer/PdfViewerBridge';
import { ViewerController, type ViewerActions } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';

type AppProps = {
  bridge?: TauriBridge;
  persistence?: PersistenceApi;
  viewerController?: ViewerActions;
  viewerRenderer?: PdfRenderer;
};

export function App({
  bridge: providedBridge,
  persistence: providedPersistence,
  viewerController,
  viewerRenderer,
}: AppProps) {
  const defaultBridge = useMemo(() => createTauriBridge(), []);
  const defaultPersistence = useMemo(() => createPersistenceApi(), []);
  const bridge = providedBridge ?? defaultBridge;
  const persistence = providedPersistence ?? defaultPersistence;
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [pageInput, setPageInput] = useState('');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [readerPreferences, setReaderPreferences] = useState(defaultReaderPreferences);
  const [recentDocuments, setRecentDocuments] = useState<PersistedDocument[]>([]);
  const [bookmarksByDocument, setBookmarksByDocument] = useState<Record<string, Bookmark[]>>({});
  const [annotationsByDocument, setAnnotationsByDocument] = useState<
    Record<string, ReaderAnnotation[]>
  >({});
  const blobUrlCache = useMemo(() => new BlobUrlCache(), []);
  const pdfByteCache = useMemo(() => new PdfByteCache(), []);
  const sessionPersistence = useMemo(
    () => createDebouncedFlush(persistence.saveReaderSession, 250),
    [persistence],
  );
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;
  const bridgeViewerController =
    activeViewerController instanceof ViewerController
      ? activeViewerController
      : defaultViewerController;

  const activeSession =
    documents.sessions.find((session) => session.id === documents.activeSessionId) ?? null;

  const loadDocumentDecorations = async (documentKey: string) => {
    const [bookmarks, annotations] = await Promise.all([
      persistence.listBookmarks(documentKey),
      persistence.listAnnotations(documentKey),
    ]);

    setBookmarksByDocument((current) => ({ ...current, [documentKey]: bookmarks }));
    setAnnotationsByDocument((current) => ({ ...current, [documentKey]: annotations }));
  };

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const [restoredDocuments, restoredSession] = await Promise.all([
        persistence.listRecentDocuments(),
        persistence.loadReaderSession(),
      ]);

      if (cancelled || restoredDocuments.length === 0) {
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

          if (cancelled) {
            return;
          }

          pdfByteCache.set(session.documentKey, opened.bytes);
          const url = blobUrlCache.createForSession(session.id, opened.bytes);

          if (session.id === restoredState.activeSessionId) {
            setViewerSource({ sessionId: session.id, url });
          }
        } catch (error) {
          if (!cancelled) {
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
    }

    restore().catch(() => {
      if (!cancelled) {
        setDocuments(createEmptyDocumentState());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bridge, persistence, blobUrlCache, pdfByteCache]);

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

  const reopenDesktopSession = async (sessionId: string) => {
    const session = documents.sessions.find((candidate) => candidate.id === sessionId);

    if (!session || session.source.kind !== 'desktop-path') {
      return;
    }

    try {
      const opened = await bridge.readDesktopPdf(session.source.path);
      pdfByteCache.set(session.documentKey, opened.bytes);
      const url = blobUrlCache.createForSession(session.id, opened.bytes);
      setViewerSource({ sessionId: session.id, url });
      setDocuments((current) =>
        updateSessionProgress(current, session.id, {
          page: session.page,
          totalPages: session.totalPages,
          zoom: session.zoom,
        }),
      );
    } catch (error) {
      setDocuments((current) =>
        markSessionError(
          current,
          session.id,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  };

  const openDesktopPath = async (path: string) => {
    const opened = await bridge.readDesktopPdf(path);
    openBytes(opened.source, opened.bytes, {
      fileSize: opened.fileSize,
      modifiedAt: opened.modifiedAt,
    });
  };

  const reopenRecentDocument = async (document: PersistedDocument) => {
    if (!document.path) {
      return;
    }

    try {
      await openDesktopPath(document.path);
    } catch (error) {
      setRecentDocuments((current) =>
        current.map((item) =>
          item.documentKey === document.documentKey ? { ...item, missing: true } : item,
        ),
      );
    }
  };

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | null = null;

    listenForOpenWith((paths) => {
      for (const path of paths) {
        void openDesktopPath(path);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [bridge, blobUrlCache, pdfByteCache, persistence]);

  const openBytes = (
    source: FileSource,
    bytes: Uint8Array,
    metadata: { fileSize?: number | null; modifiedAt?: string | null } = {},
  ) => {
    setDocuments((current) => {
      const next = addDocumentSession(current, source);
      const documentKey = getDocumentKey(source);
      const session = next.sessions.find((candidate) => candidate.documentKey === documentKey);

      if (session) {
        pdfByteCache.set(documentKey, bytes);
        const url = blobUrlCache.createForSession(session.id, bytes);
        setViewerSource({ sessionId: session.id, url });

        if (source.kind === 'desktop-path') {
          void persistence.saveDocument({
            documentKey,
            path: source.path,
            displayName: session.title,
            fileSize: metadata.fileSize ?? null,
            modifiedAt: metadata.modifiedAt ?? null,
            pageCount: session.totalPages,
            lastPage: session.page,
            progress: session.progress,
            missing: false,
          });
        }

        void loadDocumentDecorations(documentKey);
      }

      return next;
    });
  };

  const openPdf = async () => {
    const opened = await bridge.openNativePdf();

    if (!opened) {
      return;
    }

    openBytes(opened.source, opened.bytes, {
      fileSize: opened.fileSize,
      modifiedAt: opened.modifiedAt,
    });
  };

  const closeActiveTab = () => {
    if (!activeSession) {
      return;
    }

    blobUrlCache.revokeForSession(activeSession.id);
    setDocuments((current) => closeDocumentSession(current, activeSession.id));
    setViewerSource(null);
  };

  const addBookmarkForActivePage = async () => {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const saved = await persistence.saveBookmark({
      id: null,
      documentKey: activeSession.documentKey,
      page: activeSession.page,
      title: `Page ${activeSession.page}`,
      createdAt: now,
      updatedAt: now,
    });

    setBookmarksByDocument((current) => ({
      ...current,
      [activeSession.documentKey]: addOrReplaceBookmark(
        current[activeSession.documentKey] ?? [],
        saved,
      ),
    }));
  };

  const saveAnnotationForActiveDocument = async (
    input: Pick<ReaderAnnotation, 'page' | 'type' | 'color' | 'text' | 'quote' | 'areas'>,
  ) => {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const saved = await persistence.saveAnnotation({
      id: null,
      documentKey: activeSession.documentKey,
      createdAt: now,
      updatedAt: now,
      ...input,
    });

    setAnnotationsByDocument((current) => ({
      ...current,
      [activeSession.documentKey]: addOrReplaceAnnotation(
        current[activeSession.documentKey] ?? [],
        saved,
      ),
    }));
  };

  const addPageNote = () =>
    saveAnnotationForActiveDocument({
      page: activeSession?.page ?? 1,
      type: 'note',
      color: '#38bdf8',
      text: 'Page note',
      quote: null,
      areas: [],
    });

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'file.open',
      label: 'Open File',
      shortcut: defaultShortcuts.openFile,
      run: () => void openPdf(),
    });
    registry.register({
      id: 'tab.close',
      label: 'Close Tab',
      shortcut: defaultShortcuts.closeTab,
      run: closeActiveTab,
    });
    registry.register({
      id: 'find.open',
      label: 'Find',
      shortcut: defaultShortcuts.find,
      run: () => activeViewerController.openSearch(),
    });
    registry.register({
      id: 'find.next',
      label: 'Find Next',
      shortcut: defaultShortcuts.findNext,
      run: () => activeViewerController.searchNext(),
    });
    registry.register({
      id: 'find.previous',
      label: 'Find Previous',
      shortcut: defaultShortcuts.findPrevious,
      run: () => activeViewerController.searchPrevious(),
    });
    registry.register({
      id: 'sidebar.toggle',
      label: 'Toggle Sidebar',
      shortcut: defaultShortcuts.toggleSidebar,
      run: () => setSidebarOpen((open) => !open),
    });
    registry.register({
      id: 'zoom.in',
      label: 'Zoom In',
      shortcut: defaultShortcuts.zoomIn,
      run: () => activeViewerController.zoomIn(),
    });
    registry.register({
      id: 'zoom.out',
      label: 'Zoom Out',
      shortcut: defaultShortcuts.zoomOut,
      run: () => activeViewerController.zoomOut(),
    });
    registry.register({
      id: 'zoom.fitWidth',
      label: 'Fit Width',
      shortcut: defaultShortcuts.fitWidth,
      run: () => activeViewerController.fitWidth(),
    });
    registry.register({
      id: 'zoom.fitPage',
      label: 'Fit Page',
      shortcut: defaultShortcuts.fitPage,
      run: () => activeViewerController.fitPage(),
    });
    registry.register({
      id: 'history.back',
      label: 'History Back',
      shortcut: defaultShortcuts.historyBack,
      run: () => {
        if (!activeSession) {
          return;
        }

        const previousPage = activeSession.history.backStack.at(-1) ?? activeSession.page;
        setDocuments((current) => stepSessionHistoryBack(current, activeSession.id));
        activeViewerController.jumpToPage(previousPage);
      },
    });
    registry.register({
      id: 'history.forward',
      label: 'History Forward',
      shortcut: defaultShortcuts.historyForward,
      run: () => {
        if (!activeSession) {
          return;
        }

        const nextPage = activeSession.history.forwardStack[0] ?? activeSession.page;
        setDocuments((current) => stepSessionHistoryForward(current, activeSession.id));
        activeViewerController.jumpToPage(nextPage);
      },
    });
    registry.register({
      id: 'tab.next',
      label: 'Next Tab',
      shortcut: defaultShortcuts.nextTab,
      run: () => setDocuments(selectNextSession),
    });
    registry.register({
      id: 'tab.previous',
      label: 'Previous Tab',
      shortcut: defaultShortcuts.previousTab,
      run: () => setDocuments(selectPreviousSession),
    });
    registry.register({
      id: 'bookmark.add',
      label: 'Add Bookmark',
      shortcut: defaultShortcuts.addBookmark,
      run: () => void addBookmarkForActivePage(),
    });
    registry.register({
      id: 'annotation.note',
      label: 'Add Note',
      shortcut: defaultShortcuts.addNote,
      run: () => void addPageNote(),
    });
    registry.register({
      id: 'preferences.open',
      label: 'Preferences',
      shortcut: defaultShortcuts.openPreferences,
      run: () => setPreferencesOpen(true),
    });
    return registry;
  }, [activeViewerController, activeSession, bridge, blobUrlCache]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleShortcutEvent(event, commandRegistry);
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [commandRegistry]);

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const [file] = getPdfFilesFromDrop(event.dataTransfer.files);

    if (!file) {
      return;
    }

    openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()));
  };

  const handleBrowserFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);

    if (!file) {
      return;
    }

    openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()));
    event.target.value = '';
  };

  return (
    <main
      className="app-shell"
      aria-label="Reader workspace"
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
            onClick={() => {
              setDocuments((current) => ({ ...current, activeSessionId: session.id }));
              const url = blobUrlCache.getForSession(session.id);
              setViewerSource(url ? { sessionId: session.id, url } : null);
            }}
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
          onClick={() => {
            const page = Number(pageInput);

            if (Number.isInteger(page) && page > 0) {
              if (activeSession) {
                setDocuments((current) => recordHardNavigation(current, activeSession.id, page));
              }
              activeViewerController.jumpToPage(page);
            }
          }}
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
                      onClick={() => {
                        setDocuments((current) =>
                          recordHardNavigation(current, activeSession.id, bookmark.page),
                        );
                        activeViewerController.jumpToPage(bookmark.page);
                      }}
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
                        onClick={() => {
                          setDocuments((current) =>
                            recordHardNavigation(current, activeSession.id, annotation.page),
                          );
                          activeViewerController.jumpToPage(annotation.page);
                        }}
                      >
                        Page {annotation.page}:{' '}
                        {annotation.quote ?? annotation.text ?? annotation.type}
                      </button>
                      {annotation.id ? (
                        <button
                          type="button"
                          aria-label="Delete annotation"
                          onClick={() => {
                            void persistence.deleteAnnotation(annotation.id!);
                            setAnnotationsByDocument((current) => ({
                              ...current,
                              [activeSession.documentKey]: removeAnnotation(
                                current[activeSession.documentKey] ?? [],
                                annotation.id!,
                              ),
                            }));
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

                      const imported = importAnnotations(event.target.value);
                      setAnnotationsByDocument((current) => ({
                        ...current,
                        [activeSession.documentKey]: imported,
                      }));
                    }}
                  />
                </section>
              </>
            ) : (
              <p>No document selected</p>
            )}
          </aside>
        ) : null}

        <section
          className="viewer-pane"
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) {
              return;
            }

            event.preventDefault();

            if (event.deltaY < 0) {
              activeViewerController.zoomIn();
            } else {
              activeViewerController.zoomOut();
            }
          }}
        >
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
