import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlobUrlCache } from '../cache/blobUrlCache';
import { PdfByteCache } from '../cache/pdfByteCache';
import {
  createEmptyDocumentState,
  markSessionError,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import type { DocumentSession } from '../documents/documentModels';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { HomeDashboard } from '../home/HomeDashboard';
import type {
  PersistedAnnotationRecord,
  PersistedBookmarkRecord,
  PersistedDocument,
} from '../persistence/persistenceApi';
import { defaultReaderPreferences, mergeReaderPreferences } from '../preferences/preferencesStore';
import { SettingsWorkspace } from '../settings/SettingsWorkspace';
import type { Tag } from '../tags/tagModels';
import { TagManager } from '../tags/TagManager';
import type { ReaderAnnotation } from '../annotations/annotationModels';
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
import { GlobalSearchPanel } from '../search/GlobalSearchPanel';
import type { GlobalSearchResult } from '../search/globalSearch';
import { PdfViewerBridge } from '../viewer/PdfViewerBridge';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';
import type { AppWorkspace, ReaderAppProps } from './appTypes';

function mapSessionToPersistedDocument(session: DocumentSession): PersistedDocument {
  return {
    documentKey: session.documentKey,
    path: session.source.kind === 'desktop-path' ? session.source.path : null,
    displayName: session.title,
    fileSize: session.source.kind === 'browser-file' ? session.source.file.size : null,
    modifiedAt:
      session.source.kind === 'browser-file'
        ? new Date(session.source.file.lastModified).toISOString()
        : null,
    pageCount: session.totalPages,
    lastPage: session.page,
    progress: session.progress,
    missing: false,
  };
}

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
  const [lastSearchCommand, setLastSearchCommand] = useState('');
  const [pageInput, setPageInput] = useState('');
  const [workspaceOverride, setWorkspaceOverride] = useState<AppWorkspace | null>(null);
  const [readerPreferences, setReaderPreferences] = useState(defaultReaderPreferences);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [recentDocuments, setRecentDocuments] = useState<PersistedDocument[]>([]);
  const [favoriteDocuments, setFavoriteDocuments] = useState<FavoriteDocument[]>([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchBookmarks, setGlobalSearchBookmarks] = useState<PersistedBookmarkRecord[]>([]);
  const [globalSearchAnnotations, setGlobalSearchAnnotations] = useState<
    PersistedAnnotationRecord[]
  >([]);
  const [pendingGlobalSearchJump, setPendingGlobalSearchJump] = useState<{
    documentKey: string;
    page: number;
  } | null>(null);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const tagsMutatedRef = useRef(false);
  const hadReaderSessionsRef = useRef(false);
  const globalSearchRefreshRequestRef = useRef(0);
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
    toggleAnnotationTagForDocument,
    updateAnnotationForDocument,
  } = useReaderDecorations({ activeSession, persistence });

  useSessionRestore({
    bridge,
    blobUrlCache,
    loadDocumentDecorations,
    pdfByteCache,
    persistence,
    preferences: readerPreferences,
    preferencesLoaded,
    setDocuments,
    setRecentDocuments,
    setSidebarOpen,
    setViewerSource,
  });

  useEffect(() => {
    let cancelled = false;

    persistence
      .loadPreferences()
      .then((preferences) => {
        if (!cancelled) {
          setReaderPreferences(mergeReaderPreferences(preferences));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setPreferencesLoaded(true);
        }
      });

    persistence
      .listFavoriteDocuments()
      .then((favorites) => {
        if (!cancelled) {
          setFavoriteDocuments(favorites);
        }
      })
      .catch(() => undefined);

    persistence
      .listTags()
      .then((tags) => {
        if (!cancelled && !tagsMutatedRef.current) {
          setAvailableTags(tags);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [persistence]);

  useEffect(() => {
    setSelectedAnnotationId(null);
  }, [activeSession?.documentKey]);

  useEffect(() => {
    const hasSessions = documents.sessions.length > 0;

    if (!hasSessions && !hadReaderSessionsRef.current) {
      return;
    }

    if (hasSessions) {
      hadReaderSessionsRef.current = true;
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
    selectNextReaderSession,
    selectPreviousReaderSession,
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

  const refreshGlobalSearchCollections = useCallback(() => {
    globalSearchRefreshRequestRef.current += 1;
    const requestId = globalSearchRefreshRequestRef.current;

    void persistence
      .listAllBookmarks()
      .then((bookmarks) => {
        if (requestId === globalSearchRefreshRequestRef.current) {
          setGlobalSearchBookmarks(bookmarks);
        }
      })
      .catch(() => undefined);
    void persistence
      .listAllAnnotations()
      .then((annotations) => {
        if (requestId === globalSearchRefreshRequestRef.current) {
          setGlobalSearchAnnotations(annotations);
        }
      })
      .catch(() => undefined);
  }, [persistence]);

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true);
    refreshGlobalSearchCollections();
  }, [refreshGlobalSearchCollections]);

  const { commandRegistry } = useReaderCommands({
    activeSession,
    activeViewerController,
    addBookmarkForActivePage,
    addPageNote,
    closeActiveTab,
    openGlobalSearch,
    openPdf,
    selectNextSession: selectNextReaderSession,
    selectPreviousSession: selectPreviousReaderSession,
    setPreferencesOpen: (open) => {
      if (open) {
        setWorkspaceOverride('settings');
      } else {
        setWorkspaceOverride(null);
      }
    },
    setSidebarOpen,
    shortcutsEnabled: !globalSearchOpen,
    stepHistoryBack,
    stepHistoryForward,
    shortcuts: readerPreferences.shortcuts,
  });

  const activeBookmarks = activeSession
    ? (bookmarksByDocument[activeSession.documentKey] ?? [])
    : [];
  const activeAnnotations = activeSession
    ? (annotationsByDocument[activeSession.documentKey] ?? [])
    : [];
  const favoriteDocumentKeys = useMemo(
    () => new Set(favoriteDocuments.map((document) => document.documentKey)),
    [favoriteDocuments],
  );
  const activeSessionIsFavorite = activeSession
    ? favoriteDocumentKeys.has(activeSession.documentKey)
    : false;
  const selectedAnnotation =
    activeAnnotations.find(
      (annotation) => annotation.id !== null && annotation.id === selectedAnnotationId,
    ) ??
    activeAnnotations[0] ??
    null;

  const handleToggleFavorite = useCallback(
    async (documentKey: string, favorite: boolean) => {
      try {
        const session = documents.sessions.find(
          (candidate) => candidate.documentKey === documentKey,
        );
        const recent = recentDocuments.find((document) => document.documentKey === documentKey);

        if (favorite && session?.source.kind === 'browser-file') {
          await persistence.saveDocument(mapSessionToPersistedDocument(session));
        }

        await persistence.setDocumentFavorite(documentKey, favorite);

        setFavoriteDocuments((current) => {
          if (!favorite) {
            return current.filter((document) => document.documentKey !== documentKey);
          }

          const nextFavorite: FavoriteDocument = session
            ? {
                documentKey: session.documentKey,
                displayName: session.title,
                path: session.source.kind === 'desktop-path' ? session.source.path : null,
                lastPage: session.page,
                progress: session.progress,
              }
            : {
                documentKey,
                displayName: recent?.displayName ?? documentKey,
                path: recent?.path ?? null,
                lastPage: recent?.lastPage ?? 1,
                progress: recent?.progress ?? 0,
              };

          return [
            ...current.filter((document) => document.documentKey !== documentKey),
            nextFavorite,
          ].sort((left, right) => left.displayName.localeCompare(right.displayName));
        });
      } catch {
        return;
      }
    },
    [documents.sessions, persistence, recentDocuments],
  );

  const handleToggleActiveFavorite = useCallback(() => {
    if (!activeSession) {
      return;
    }

    return handleToggleFavorite(activeSession.documentKey, !activeSessionIsFavorite);
  }, [activeSession, activeSessionIsFavorite, handleToggleFavorite]);

  const handleToggleAnnotationTag = useCallback(
    (annotation: ReaderAnnotation, tag: Tag, selected: boolean) => {
      if (!activeSession || annotation.id === null) {
        return;
      }

      return toggleAnnotationTagForDocument(
        activeSession.documentKey,
        annotation.id,
        tag.id,
        selected,
      );
    },
    [activeSession, toggleAnnotationTagForDocument],
  );
  const handleSaveAnnotationNote = useCallback(
    async (annotation: ReaderAnnotation, text: string) => {
      if (!activeSession || annotation.id === null || annotation.type !== 'note') {
        return;
      }

      await updateAnnotationForDocument(activeSession.documentKey, annotation, { text });
    },
    [activeSession, updateAnnotationForDocument],
  );
  const runSearch = useCallback(
    (keyword: string) => {
      activeViewerController.search(keyword);
      setLastSearchCommand(keyword.trim() ? `Searched "${keyword.trim()}"` : 'Cleared search');
    },
    [activeViewerController],
  );
  const clearSearch = useCallback(() => {
    setSearchText('');
    runSearch('');
  }, [runSearch]);

  const handleGlobalSearchResult = useCallback(
    async (result: GlobalSearchResult) => {
      setGlobalSearchOpen(false);

      if (result.source === 'fullText' && result.query) {
        setSearchText(result.query);
        runSearch(result.query);
        activeViewerController.openSearch();
        return;
      }

      if (!result.documentKey || result.missing) {
        return;
      }

      if (activeSession?.documentKey === result.documentKey) {
        if (result.page) {
          jumpToActiveDocumentPage(result.page);
        }
        return;
      }

      const recentDocument = recentDocuments.find(
        (document) =>
          document.documentKey === result.documentKey ||
          (Boolean(result.path) && document.path === result.path),
      );

      if (!recentDocument) {
        return;
      }

      await reopenRecentDocument(recentDocument);

      if (result.page) {
        setPendingGlobalSearchJump({ documentKey: result.documentKey, page: result.page });
      }
    },
    [
      activeSession,
      activeViewerController,
      jumpToActiveDocumentPage,
      recentDocuments,
      reopenRecentDocument,
      runSearch,
    ],
  );

  useEffect(() => {
    if (
      !pendingGlobalSearchJump ||
      !activeSession ||
      activeSession.documentKey !== pendingGlobalSearchJump.documentKey
    ) {
      return;
    }

    jumpToActiveDocumentPage(pendingGlobalSearchJump.page);
    setPendingGlobalSearchJump(null);
  }, [activeSession, jumpToActiveDocumentPage, pendingGlobalSearchJump]);

  const handleSavePreferences = useCallback(
    async (preferences: typeof readerPreferences) => {
      setSettingsSaving(true);
      try {
        await persistence.savePreferences(preferences);
        setReaderPreferences(preferences);
      } finally {
        setSettingsSaving(false);
      }
    },
    [persistence],
  );
  const activeWorkspace: AppWorkspace =
    workspaceOverride ?? (activeSession ? 'reader' : 'home');

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
      className={`app-shell ${activeWorkspace}-mode`}
      aria-label="SmartReader workbench"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {activeWorkspace === 'settings' ? (
        <SettingsWorkspace
          commandRegistry={commandRegistry}
          preferences={readerPreferences}
          openSessionCount={documents.sessions.length}
          recentDocumentCount={recentDocuments.length}
          saving={settingsSaving}
          onClose={() => setWorkspaceOverride(null)}
          onSave={handleSavePreferences}
        />
      ) : null}
      {activeWorkspace === 'tags' ? (
        <TagManager
          tags={availableTags}
          persistence={persistence}
          onTagsChange={(update) => {
            tagsMutatedRef.current = true;
            setAvailableTags(update);
          }}
          onClose={() => setWorkspaceOverride(null)}
        />
      ) : null}
      {activeWorkspace === 'reader' && activeSession ? (
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
              onSearch={() => runSearch(searchText)}
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
              isFavorite={activeSessionIsFavorite}
              onToggleFavorite={handleToggleActiveFavorite}
              onOpenPreferences={() => setWorkspaceOverride('settings')}
            />
          }
          leftPanel={
            <ReaderLeftPanel
              activeSession={activeSession}
              recentDocuments={recentDocuments}
              bookmarks={activeBookmarks}
              annotations={activeAnnotations}
              selectedAnnotationId={selectedAnnotation?.id ?? null}
              searchText={searchText}
              lastSearchCommand={lastSearchCommand}
              onJumpToPage={jumpToActiveDocumentPage}
              onReopenRecentDocument={reopenRecentDocument}
              onAddBookmark={addBookmarkForActivePage}
              onAddNote={addPageNote}
              onSelectAnnotation={(annotation) => setSelectedAnnotationId(annotation.id)}
              onDeleteAnnotation={(annotationId) =>
                deleteAnnotationForDocument(activeSession.documentKey, annotationId)
              }
              onImportAnnotations={(json) =>
                importAnnotationsForDocument(activeSession.documentKey, json)
              }
              onSearchTextChange={setSearchText}
              onOpenSearch={() => activeViewerController.openSearch()}
              onSearch={() => runSearch(searchText)}
            />
          }
          viewer={
            <section
              className="viewer-surface"
              aria-label="PDF viewer surface"
              onWheel={handleViewerWheel}
            >
              {viewerContent}
            </section>
          }
          rightPanel={
            <ReaderRightPanel
              activeSession={activeSession}
              selectedAnnotation={selectedAnnotation}
              tags={availableTags}
              searchText={searchText}
              lastSearchCommand={lastSearchCommand}
              isFavorite={activeSessionIsFavorite}
              onSearchTextChange={setSearchText}
              onOpenSearch={() => activeViewerController.openSearch()}
              onSearch={() => runSearch(searchText)}
              onClearSearch={clearSearch}
              onSearchNext={() => activeViewerController.searchNext()}
              onSearchPrevious={() => activeViewerController.searchPrevious()}
              onJumpToPage={jumpToActiveDocumentPage}
              onFitWidth={() => activeViewerController.fitWidth()}
              onFitPage={() => activeViewerController.fitPage()}
              onToggleFavorite={handleToggleActiveFavorite}
              onDeleteAnnotation={(annotationId) =>
                deleteAnnotationForDocument(activeSession.documentKey, annotationId)
              }
              onSaveAnnotationNote={handleSaveAnnotationNote}
              onToggleAnnotationTag={handleToggleAnnotationTag}
            />
          }
          statusBar={<ReaderStatusBar activeSession={activeSession} />}
        />
      ) : null}
      {activeWorkspace === 'home' ? (
        <HomeDashboard
          recentDocuments={recentDocuments}
          favoriteDocuments={favoriteDocuments}
          onOpenPdf={openPdf}
          onBrowserFileChange={handleBrowserFileChange}
          onReopenRecentDocument={reopenRecentDocument}
          onToggleFavorite={handleToggleFavorite}
          canOpenNativePdf={() => bridge.canOpenNativePdf?.() ?? true}
          onOpenGlobalSearch={openGlobalSearch}
          onOpenSettings={() => setWorkspaceOverride('settings')}
          onOpenTags={() => setWorkspaceOverride('tags')}
        />
      ) : null}
      <GlobalSearchPanel
        open={globalSearchOpen}
        query={globalSearchQuery}
        recentDocuments={recentDocuments}
        favoriteDocuments={favoriteDocuments}
        bookmarks={globalSearchBookmarks}
        annotations={globalSearchAnnotations}
        activeSession={
          activeSession
            ? {
                documentKey: activeSession.documentKey,
                title: activeSession.title,
              }
            : null
        }
        onQueryChange={setGlobalSearchQuery}
        onSelectResult={(result) => void handleGlobalSearchResult(result)}
        onClose={() => setGlobalSearchOpen(false)}
      />
    </main>
  );
}
