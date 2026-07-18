import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type SetStateAction,
} from 'react';
import { BlobUrlCache } from '../cache/blobUrlCache';
import { PdfByteCache } from '../cache/pdfByteCache';
import {
  createEmptyDocumentState,
  markSessionError,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import type { DocumentSession } from '../documents/documentModels';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { HomeSidebarPage } from '../home/HomeSidebar';
import type {
  CacheStats,
  PersistedAnnotationRecord,
  PersistedBookmarkRecord,
  PersistedDocument,
  PersistedSessionTab,
} from '../persistence/persistenceApi';
import { createDebouncedFlush } from '../persistence/debounce';
import { defaultReaderPreferences, mergeReaderPreferences } from '../preferences/preferencesStore';
import type { SettingsSection } from '../settings/SettingsWorkspace';
import type { Tag } from '../tags/tagModels';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import { useDocumentOpening } from '../reader/hooks/useDocumentOpening';
import { useReaderCommands } from '../reader/hooks/useReaderCommands';
import { useReaderDecorations } from '../reader/hooks/useReaderDecorations';
import { useReaderNavigation } from '../reader/hooks/useReaderNavigation';
import { useReaderPersistence } from '../reader/hooks/useReaderPersistence';
import { useSessionRestore } from '../reader/hooks/useSessionRestore';
import { GlobalSearchPanel } from '../search/GlobalSearchPanel';
import type { GlobalSearchResult } from '../search/globalSearch';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';
import type { AppWorkspace, ReaderAppProps } from './appTypes';
import { ReaderViewerContent } from './ReaderViewerContent';
import { ReaderWorkspaceSwitch } from './ReaderWorkspaceSwitch';
import {
  countRestorablePersistedTabs,
  mapSessionToPersistedDocument,
  mapSessionsToPersistedTabs,
  mergeRecentDocuments,
  upsertRecentDocument,
} from './readerAppMappers';

const bookmarkProviderErrorMessage = '书签加载失败，请重试。';
const annotationProviderErrorMessage = '批注加载失败，请重试。';
const defaultCacheStats: CacheStats = {
  usedBytes: 0,
  totalBytes: 5 * 1024 ** 3,
  fileCount: 0,
};
const appVersion = {
  version: '0.1.0',
  build: null,
};

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
  const [homeSidebarPage, setHomeSidebarPage] = useState<HomeSidebarPage>('home');
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSection>('shortcuts');
  const [readerPreferences, setReaderPreferences] = useState(defaultReaderPreferences);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [recentDocuments, setRecentDocuments] = useState<PersistedDocument[]>([]);
  const [favoriteDocuments, setFavoriteDocuments] = useState<FavoriteDocument[]>([]);
  const [sessionRestoreCount, setSessionRestoreCount] = useState(0);
  const [cacheStats, setCacheStats] = useState(defaultCacheStats);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchBookmarks, setGlobalSearchBookmarks] = useState<PersistedBookmarkRecord[]>([]);
  const [globalSearchAnnotations, setGlobalSearchAnnotations] = useState<
    PersistedAnnotationRecord[]
  >([]);
  const [globalSearchBookmarkError, setGlobalSearchBookmarkError] = useState<string | null>(null);
  const [globalSearchAnnotationError, setGlobalSearchAnnotationError] = useState<string | null>(
    null,
  );
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
  const documentPersistence = useMemo(
    () => createDebouncedFlush(persistence.saveDocument, 250),
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

  const {
    annotationsByDocument,
    bookmarksByDocument,
    addBookmarkForActivePage,
    addPageNote,
    deleteBookmarkForDocument,
    deleteAnnotationForDocument,
    importAnnotationsForDocument,
    loadDocumentDecorations,
    renameBookmarkForDocument,
    saveAnnotationForActiveDocument,
    toggleAnnotationTagForDocument,
    updateAnnotationForDocument,
  } = useReaderDecorations({ activeSession, persistence });

  const handleRenameBookmark = useCallback(
    async (bookmark: Bookmark, title: string) => {
      const saved = await renameBookmarkForDocument(bookmark.documentKey, bookmark, title);

      if (!saved || saved.id === null) {
        return;
      }

      setGlobalSearchBookmarks((current) =>
        current.map((record) => (record.id === saved.id ? { ...record, ...saved } : record)),
      );
    },
    [renameBookmarkForDocument],
  );

  const handleDeleteBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (bookmark.id === null) {
        return;
      }

      await deleteBookmarkForDocument(bookmark.documentKey, bookmark.id);
      setGlobalSearchBookmarks((current) =>
        current.filter((record) => record.id !== bookmark.id),
      );
    },
    [deleteBookmarkForDocument],
  );

  const mergeRestoredRecentDocuments = useCallback(
    (update: SetStateAction<PersistedDocument[]>) => {
      if (typeof update === 'function') {
        setRecentDocuments(update);
        return;
      }

      setRecentDocuments((current) => mergeRecentDocuments(current, update));
    },
    [],
  );

  useSessionRestore({
    bridge,
    blobUrlCache,
    loadDocumentDecorations,
    pdfByteCache,
    persistence,
    preferences: readerPreferences,
    preferencesLoaded,
    setDocuments,
    setRecentDocuments: mergeRestoredRecentDocuments,
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

    persistence
      .loadCacheStats()
      .then((stats) => {
        if (!cancelled) {
          setCacheStats(stats);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCacheStats(defaultCacheStats);
        }
      });

    persistence
      .loadReaderSession()
      .then((session) => {
        if (!cancelled) {
          setSessionRestoreCount(session ? countRestorablePersistedTabs(session.tabs) : 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionRestoreCount(0);
        }
      });

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

    const persistedTabs = mapSessionsToPersistedTabs(documents.sessions);
    setSessionRestoreCount(persistedTabs.length);

    sessionPersistence.schedule({
      activeDocumentKey: activeSession?.documentKey ?? null,
      sidebarOpen,
      tabs: persistedTabs,
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
      documentPersistence.cancel();
    };
  }, [documentPersistence, sessionPersistence]);

  const syncRecentDocumentImmediately = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      void persistence.saveDocument(document);
    },
    [persistence],
  );

  const syncRecentDocumentProgress = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      documentPersistence.schedule(document);
    },
    [documentPersistence],
  );

  const handleDocumentOpened = useCallback(
    (document: PersistedDocument) => {
      syncRecentDocumentImmediately(document);
    },
    [syncRecentDocumentImmediately],
  );

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
    onDocumentOpened: handleDocumentOpened,
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

    setGlobalSearchBookmarkError(null);
    setGlobalSearchAnnotationError(null);

    void persistence
      .listAllBookmarks()
      .then((bookmarks) => {
        if (requestId === globalSearchRefreshRequestRef.current) {
          setGlobalSearchBookmarks(bookmarks);
          setGlobalSearchBookmarkError(null);
        }
      })
      .catch(() => {
        if (requestId === globalSearchRefreshRequestRef.current) {
          setGlobalSearchBookmarks([]);
          setGlobalSearchBookmarkError(bookmarkProviderErrorMessage);
        }
      });
    void persistence
      .listAllAnnotations()
      .then((annotations) => {
        if (requestId === globalSearchRefreshRequestRef.current) {
          setGlobalSearchAnnotations(annotations);
          setGlobalSearchAnnotationError(null);
        }
      })
      .catch(() => {
        if (requestId === globalSearchRefreshRequestRef.current) {
          setGlobalSearchAnnotations([]);
          setGlobalSearchAnnotationError(annotationProviderErrorMessage);
        }
      });
  }, [persistence]);

  const refreshRecentDocuments = useCallback(() => {
    void persistence
      .listRecentDocuments()
      .then(setRecentDocuments)
      .catch(() => undefined);
  }, [persistence]);

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true);
    refreshGlobalSearchCollections();
  }, [refreshGlobalSearchCollections]);

  const openSettingsWorkspace = useCallback((initialSection: SettingsSection = 'shortcuts') => {
    setSettingsInitialSection(initialSection);
    setWorkspaceOverride('settings');
  }, []);

  const closeToolWorkspace = useCallback(() => {
    setWorkspaceOverride(null);
  }, []);

  const openShortcutWorkspace = useCallback(
    (workspace: Extract<AppWorkspace, 'import' | 'compare' | 'annotations' | 'bookmarks'>) => {
      if (workspace === 'annotations' || workspace === 'bookmarks') {
        refreshGlobalSearchCollections();
      }

      setWorkspaceOverride(workspace);
    },
    [refreshGlobalSearchCollections],
  );
  const openHomeSidebarPage = useCallback((page: HomeSidebarPage) => {
    setWorkspaceOverride(null);
    setHomeSidebarPage(page);
  }, []);
  const openPdfAndIgnoreResult = useCallback(() => {
    void openPdf().catch(() => undefined);
  }, [openPdf]);

  const { commandRegistry } = useReaderCommands({
    activeSession,
    activeViewerController,
    addBookmarkForActivePage,
    addPageNote,
    closeActiveTab,
    openGlobalSearch,
    openPdf: openPdfAndIgnoreResult,
    selectNextSession: selectNextReaderSession,
    selectPreviousSession: selectPreviousReaderSession,
    setPreferencesOpen: (open) => {
      if (open) {
        openSettingsWorkspace();
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
                pageCount: null,
                missing: false,
                lastOpenedAt: null,
                tagIds: [],
              }
            : {
                documentKey,
                displayName: recent?.displayName ?? documentKey,
                path: recent?.path ?? null,
                lastPage: recent?.lastPage ?? 1,
                progress: recent?.progress ?? 0,
                pageCount: recent?.pageCount ?? null,
                missing: recent?.missing ?? false,
                lastOpenedAt: null,
                tagIds: [],
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

  const handleToggleDocumentTag = useCallback(
    async (document: PersistedDocument, tag: Tag, selected: boolean) => {
      try {
        if (selected) {
          await persistence.attachDocumentTag(document.documentKey, tag.id);
        } else {
          await persistence.detachDocumentTag(document.documentKey, tag.id);
        }

        refreshRecentDocuments();
        void persistence.listTags().then((tags) => {
          tagsMutatedRef.current = true;
          setAvailableTags(tags);
        });
      } catch {
        return;
      }
    },
    [persistence, refreshRecentDocuments],
  );

  const handleRemoveRecentDocuments = useCallback(
    async (documentsToRemove: PersistedDocument[]) => {
      try {
        await Promise.all(
          documentsToRemove.map((document) =>
            persistence.removeRecentDocument(document.documentKey),
          ),
        );
        const removedKeys = new Set(documentsToRemove.map((document) => document.documentKey));

        setRecentDocuments((current) =>
          current.filter((document) => !removedKeys.has(document.documentKey)),
        );
      } catch {
        return;
      }
    },
    [persistence],
  );

  const handleClearRecentDocuments = useCallback(async () => {
    try {
      await persistence.clearRecentDocuments();
      setRecentDocuments([]);
    } catch {
      return;
    }
  }, [persistence]);

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
        setWorkspaceOverride(null);
        setSearchText(result.query);
        runSearch(result.query);
        activeViewerController.openSearch();
        return;
      }

      if (!result.documentKey || result.missing) {
        return;
      }

      if (activeSession?.documentKey === result.documentKey) {
        setWorkspaceOverride(null);
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

      if (!recentDocument?.path) {
        return;
      }

      const opened = await reopenRecentDocument(recentDocument);

      if (!opened) {
        return;
      }

      setWorkspaceOverride(null);

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

  const findRecentDocumentForRecord = useCallback(
    (documentKey: string, path: string | null) =>
      recentDocuments.find(
        (document) =>
          document.documentKey === documentKey || (Boolean(path) && document.path === path),
      ) ?? null,
    [recentDocuments],
  );

  const canOpenRecordPage = useCallback(
    (documentKey: string, path: string | null, missing: boolean) => {
      if (missing) {
        return false;
      }

      return (
        activeSession?.documentKey === documentKey ||
        Boolean(findRecentDocumentForRecord(documentKey, path))
      );
    },
    [activeSession, findRecentDocumentForRecord],
  );

  const openRecordPage = useCallback(
    async (documentKey: string, path: string | null, page: number, missing: boolean) => {
      if (missing) {
        return;
      }

      if (activeSession?.documentKey === documentKey) {
        jumpToActiveDocumentPage(page);
        setPendingGlobalSearchJump(null);
        setWorkspaceOverride(null);
        return;
      }

      const recentDocument = findRecentDocumentForRecord(documentKey, path);

      if (!recentDocument) {
        return;
      }

      const opened = await reopenRecentDocument(recentDocument);

      if (!opened) {
        setPendingGlobalSearchJump(null);
        return;
      }

      setWorkspaceOverride(null);
      setPendingGlobalSearchJump({ documentKey, page });
    },
    [activeSession, findRecentDocumentForRecord, jumpToActiveDocumentPage, reopenRecentDocument],
  );

  const openCompareDocument = useCallback(
    async (document: PersistedDocument) => {
      const opened = await reopenRecentDocument(document);

      if (!opened) {
        return;
      }

      setWorkspaceOverride(null);
    },
    [reopenRecentDocument],
  );

  const openFavoriteDocument = useCallback(
    async (document: FavoriteDocument) => {
      const recentDocument =
        recentDocuments.find(
          (candidate) =>
            candidate.documentKey === document.documentKey ||
            (Boolean(document.path) && candidate.path === document.path),
        ) ?? null;

      if (!recentDocument) {
        return false;
      }

      const opened = await reopenRecentDocument(recentDocument);

      if (opened) {
        setWorkspaceOverride(null);
      }

      return opened;
    },
    [recentDocuments, reopenRecentDocument],
  );

  const openImportPdf = useCallback(async () => {
    const opened = await openPdf();

    if (opened) {
      setWorkspaceOverride(null);
    }
  }, [openPdf]);

  const handleImportBrowserFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void handleBrowserFileChange(event);
      setWorkspaceOverride(null);
    },
    [handleBrowserFileChange],
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
  const handleWorkbenchDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();

      if (activeWorkspace === 'home') {
        return;
      }
    },
    [activeWorkspace],
  );
  const handleWorkbenchDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();

      if (activeWorkspace === 'home') {
        return;
      }

      void handleDrop(event);
    },
    [activeWorkspace, handleDrop],
  );

  const viewerContent = (
    <ReaderViewerContent
      activeSession={activeSession}
      viewerSource={viewerSource}
      annotations={activeAnnotations}
      controller={bridgeViewerController}
      renderer={viewerRenderer}
      onOpenPdf={openPdfAndIgnoreResult}
      onRetry={reopenDesktopSession}
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
        setDocuments((current) => {
          const next = updateSessionProgress(current, progress.sessionId, {
            page: progress.page,
            totalPages: progress.totalPages,
            zoom: progress.zoom,
          });
          const updatedSession = next.sessions.find(
            (session) => session.id === progress.sessionId,
          );

          if (updatedSession?.source.kind === 'desktop-path') {
            const existingRecentDocument = recentDocuments.find(
              (document) => document.documentKey === updatedSession.documentKey,
            );
            syncRecentDocumentProgress(
              mapSessionToPersistedDocument(updatedSession, existingRecentDocument),
            );
          }

          return next;
        });
      }}
      onLoadError={(error) => {
        setDocuments((current) =>
          activeSession ? markSessionError(current, activeSession.id, error.message) : current,
        );
      }}
    />
  );

  return (
    <main
      className={`app-shell ${activeWorkspace}-mode`}
      aria-label="SmartReader workbench"
      onDragOver={handleWorkbenchDragOver}
      onDrop={handleWorkbenchDrop}
    >
      <ReaderWorkspaceSwitch
        activeAnnotations={activeAnnotations}
        activeBookmarks={activeBookmarks}
        activeSession={activeSession}
        activeSessionIsFavorite={activeSessionIsFavorite}
        activeSidebarPage={homeSidebarPage}
        activeViewerController={activeViewerController}
        activeWorkspace={activeWorkspace}
        appVersion={appVersion}
        availableTags={availableTags}
        cacheStats={cacheStats}
        commandRegistry={commandRegistry}
        documents={documents}
        favoriteDocuments={favoriteDocuments}
        globalSearchAnnotationError={globalSearchAnnotationError}
        globalSearchAnnotations={globalSearchAnnotations}
        globalSearchBookmarkError={globalSearchBookmarkError}
        globalSearchBookmarks={globalSearchBookmarks}
        lastSearchCommand={lastSearchCommand}
        pageInput={pageInput}
        persistence={persistence}
        readerPreferences={readerPreferences}
        recentDocuments={recentDocuments}
        searchText={searchText}
        selectedAnnotation={selectedAnnotation}
        sessionRestoreCount={sessionRestoreCount}
        settingsInitialSection={settingsInitialSection}
        settingsSaving={settingsSaving}
        sidebarOpen={sidebarOpen}
        viewerContent={viewerContent}
        addBookmarkForActivePage={addBookmarkForActivePage}
        addPageNote={addPageNote}
        canOpenNativePdf={() => bridge.canOpenNativePdf?.() ?? true}
        canOpenRecordPage={canOpenRecordPage}
        clearSearch={clearSearch}
        closeActiveTab={closeActiveTab}
        closeToolWorkspace={closeToolWorkspace}
        deleteBookmark={handleDeleteBookmark}
        deleteAnnotationForDocument={deleteAnnotationForDocument}
        handleBrowserFileChange={handleBrowserFileChange}
        handleImportBrowserFileChange={handleImportBrowserFileChange}
        handleDrop={handleDrop}
        handleSaveAnnotationNote={handleSaveAnnotationNote}
        handleSavePreferences={handleSavePreferences}
        handleToggleActiveFavorite={handleToggleActiveFavorite}
        handleToggleAnnotationTag={handleToggleAnnotationTag}
        handleToggleDocumentTag={handleToggleDocumentTag}
        handleToggleFavorite={handleToggleFavorite}
        handleRemoveRecentDocuments={handleRemoveRecentDocuments}
        handleClearRecentDocuments={handleClearRecentDocuments}
        handleViewerWheel={handleViewerWheel}
        importAnnotationsForDocument={importAnnotationsForDocument}
        jumpToActiveDocumentPage={jumpToActiveDocumentPage}
        jumpToPage={jumpToPage}
        onTagsChange={(update) => {
          tagsMutatedRef.current = true;
          setAvailableTags(update);
        }}
        openCompareDocument={openCompareDocument}
        openFavoriteDocument={openFavoriteDocument}
        openGlobalSearch={openGlobalSearch}
        openHomeSidebarPage={openHomeSidebarPage}
        openImportPdf={openImportPdf}
        openPdf={openPdf}
        openPdfAndIgnoreResult={openPdfAndIgnoreResult}
        openRecordPage={openRecordPage}
        openSettingsWorkspace={openSettingsWorkspace}
        openShortcutWorkspace={openShortcutWorkspace}
        renameBookmark={handleRenameBookmark}
        reopenRecentDocument={reopenRecentDocument}
        runSearch={runSearch}
        selectReaderSession={selectReaderSession}
        setPageInput={setPageInput}
        setSearchText={setSearchText}
        setSelectedAnnotationId={setSelectedAnnotationId}
        setSidebarOpen={setSidebarOpen}
        setWorkspaceOverride={setWorkspaceOverride}
        stepHistoryBack={stepHistoryBack}
        stepHistoryForward={stepHistoryForward}
      />
      <GlobalSearchPanel
        open={globalSearchOpen}
        query={globalSearchQuery}
        recentDocuments={recentDocuments}
        favoriteDocuments={favoriteDocuments}
        bookmarks={globalSearchBookmarks}
        annotations={globalSearchAnnotations}
        bookmarkError={globalSearchBookmarkError}
        annotationError={globalSearchAnnotationError}
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
