import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  closeDocumentSession,
  markSessionError,
  updateSessionProgress,
  recordHardNavigation,
} from '../documents/documentSessionStore';
import type { DocumentSession } from '../documents/documentModels';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { HomeSidebarPage } from '../home/HomeSidebar';
import {
  flattenBookmarkDashboard,
  type BookmarkDeleteResult,
  type BookmarkManagementRecord,
  type BookmarkUpdateInput,
} from '../home/bookmarkManagementUtils';
import type {
  BookmarkDashboard,
  CacheStats,
  PersistedAnnotationRecord,
  PersistedDocument,
  PersistedSessionTab,
} from '../persistence/persistenceApi';
import { createDebouncedFlush } from '../persistence/debounce';
import { defaultReaderPreferences, mergeReaderPreferences } from '../preferences/preferencesStore';
import type { ReaderTheme } from '../preferences/preferencesModels';
import { ThemeSwitcher } from '../preferences/ThemeSwitcher';
import type { SettingsSection } from '../settings/SettingsWorkspace';
import type { Tag } from '../tags/tagModels';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import { useDocumentOpening } from '../reader/hooks/useDocumentOpening';
import { useReaderCommands } from '../reader/hooks/useReaderCommands';
import { useStableCallback } from '../reader/hooks/useStableCallback';
import { useReadingTime } from '../reader/hooks/useReadingTime';
import { useReaderDecorations } from '../reader/hooks/useReaderDecorations';
import { useReaderNavigation } from '../reader/hooks/useReaderNavigation';
import { useReaderPersistence } from '../reader/hooks/useReaderPersistence';
import { useSessionRestore } from '../reader/hooks/useSessionRestore';
import { ReaderTabs } from '../reader/ReaderTabs';
import { GlobalSearchPanel } from '../search/GlobalSearchPanel';
import { AiAssistant } from '../ai/AiAssistant';
import { LibraryWorkspace } from '../library/LibraryWorkspace';
import { paperToPersistedDocument } from '../library/libraryPersistence';
import { paperIdFromDocumentKey } from '../library/libraryModels';
import { errorMessage } from '../library/libraryService';
import { AnnotationManagerWorkspace } from '../workspaces/AnnotationManagerWorkspace';
import { SessionRestoreWorkspace } from '../workspaces/SessionRestoreWorkspace';
import type { GlobalSearchResult } from '../search/globalSearch';
import { ViewerController } from '../viewer/viewerController';
import {
  defaultSearchOptions,
  emptySearchState,
  type ViewerHighlightSelection,
  type ViewerLoadError,
  type ViewerProgress,
  type ViewerDocumentInfo,
  type ViewerSearchOptions,
  type ViewerSearchState,
  type ViewerSource,
} from '../viewer/viewerTypes';
import type { AppWorkspace, ReaderAppProps } from './appTypes';
import { ReaderViewerContent } from './ReaderViewerContent';
import { ReaderWorkspaceSwitch } from './ReaderWorkspaceSwitch';
import { useLibraryView, useResearch } from './ResearchContext';
import {
  countRestorablePersistedTabs,
  mapSessionToPersistedDocument,
  mapSessionsToPersistedTabs,
  mergeRecentDocuments,
  upsertRecentDocument,
} from './readerAppMappers';

const emptyBookmarks: Bookmark[] = [];
const emptyAnnotations: ReaderAnnotation[] = [];
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
  const research = useResearch();
  const libraryView = useLibraryView(research?.library);
  const [appError, setAppError] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const importingRef = useRef(false);
  const { bridge, persistence, sessionPersistence } = useReaderPersistence({
    bridge: providedBridge,
    persistence: providedPersistence,
  });
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [viewerReadyIdentity, setViewerReadyIdentity] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [lastSearchCommand, setLastSearchCommand] = useState('');
  const [searchState, setSearchState] = useState<ViewerSearchState>(emptySearchState);
  const [searchOptions, setSearchOptionsState] =
    useState<ViewerSearchOptions>(defaultSearchOptions);
  const [documentInfo, setDocumentInfo] = useState<ViewerDocumentInfo | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);
  const [pageInput, setPageInput] = useState('');
  const [workspaceOverride, setWorkspaceOverride] = useState<AppWorkspace | null>('home');
  const [workspaceReturnTarget, setWorkspaceReturnTarget] = useState<'home' | 'reader' | null>(
    null,
  );
  const [homeSidebarPage, setHomeSidebarPage] = useState<HomeSidebarPage>('home');
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSection>('shortcuts');
  const [readerPreferences, setReaderPreferences] = useState(defaultReaderPreferences);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesLoadSucceeded, setPreferencesLoadSucceeded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [recentDocuments, setRecentDocuments] = useState<PersistedDocument[]>([]);
  const [favoriteDocuments, setFavoriteDocuments] = useState<FavoriteDocument[]>([]);
  const [sessionRestoreCount, setSessionRestoreCount] = useState(0);
  const [cacheStats, setCacheStats] = useState(defaultCacheStats);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [bookmarkDashboard, setBookmarkDashboard] = useState<BookmarkDashboard | null>(null);
  const [bookmarkDashboardLoading, setBookmarkDashboardLoading] = useState(false);
  const [bookmarkDashboardError, setBookmarkDashboardError] = useState<string | null>(null);
  const [globalSearchAnnotations, setGlobalSearchAnnotations] = useState<
    PersistedAnnotationRecord[]
  >([]);
  const [globalSearchAnnotationError, setGlobalSearchAnnotationError] = useState<string | null>(
    null,
  );
  const displayRecentDocuments = useMemo(() => research ? [
    ...libraryView.papers.filter((paper) => !paper.recentHidden).map(paperToPersistedDocument),
    ...recentDocuments.filter((document) => !document.documentKey.startsWith('paper:')),
  ].sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '')) : recentDocuments,
  [libraryView.papers, recentDocuments, research]);
  const displayFavoriteDocuments = useMemo(() => research ? [
    ...libraryView.papers.filter((paper) => paper.favorite).map(paperToPersistedDocument),
    ...favoriteDocuments.filter((document) => !document.documentKey.startsWith('paper:')),
  ] : favoriteDocuments, [favoriteDocuments, libraryView.papers, research]);
  const displayAnnotations = useMemo(() => research ? [
    ...libraryView.papers.flatMap((paper) => paper.annotations.map((annotation) => ({ ...annotation,
      documentDisplayName: paper.fileName, documentPath: null, documentMissing: false,
    }))),
    ...globalSearchAnnotations.filter((annotation) => !annotation.documentKey.startsWith('paper:')),
  ] : globalSearchAnnotations, [globalSearchAnnotations, libraryView.papers, research]);
  const displayBookmarkDashboard = useMemo(() => {
    if (!research) return bookmarkDashboard;
    const groups = [
      ...(bookmarkDashboard?.groups ?? []).filter((group) => !group.document.documentKey.startsWith('paper:')),
      ...libraryView.papers.filter((paper) => paper.bookmarks.length).map((paper) => ({
        document: paperToPersistedDocument(paper), bookmarkCount: paper.bookmarks.length, bookmarks: paper.bookmarks,
      })),
    ];
    return { groups, totalBookmarks: groups.reduce((total, group) => total + group.bookmarkCount, 0) };
  }, [bookmarkDashboard, libraryView.papers, research]);
  const globalSearchBookmarks = useMemo(() => flattenBookmarkDashboard(displayBookmarkDashboard), [displayBookmarkDashboard]);
  const [pendingGlobalSearchJump, setPendingGlobalSearchJump] = useState<{
    documentKey: string;
    page: number;
  } | null>(null);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const tagsMutatedRef = useRef(false);
  const hadReaderSessionsRef = useRef(false);
  const bookmarkDashboardRequestRef = useRef(0);
  const annotationRefreshRequestRef = useRef(0);
  const blobUrlCache = useMemo(() => new BlobUrlCache(), []);
  const pdfByteCache = useMemo(() => new PdfByteCache(), []);
  const documentPersistence = useMemo(() => new Map<string, ReturnType<typeof createDebouncedFlush<PersistedDocument>>>(), [persistence]);
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;
  const bridgeViewerController =
    activeViewerController instanceof ViewerController
      ? activeViewerController
      : defaultViewerController;

  const visibleLibraryIds = libraryView.papers.map((paper) => paper.id).join(',');
  const displayDocuments = useMemo(() => {
    if (!research) return documents;
    const sessions = documents.sessions.filter((session) => session.source.kind !== 'library'
      || research.library.getPaper(session.source.paperId) !== undefined);
    return { ...documents, sessions, activeSessionId: sessions.some((session) => session.id === documents.activeSessionId) ? documents.activeSessionId : null };
  }, [documents, research, visibleLibraryIds]);
  const activeSession = displayDocuments.sessions.find((session) => session.id === displayDocuments.activeSessionId) ?? null;
  const activeWorkspace: AppWorkspace =
    workspaceOverride ?? (activeSession ? 'reader' : 'home');
  useReadingTime({ library: research?.library, session: activeSession, active: activeWorkspace === 'reader',
    ready: Boolean(viewerSource && viewerSource.sessionId === activeSession?.id
      && viewerReadyIdentity === `${viewerSource.sessionId}:${viewerSource.url}`), onError: setAppError });

  const {
    annotationsByDocument,
    bookmarksByDocument,
    addBookmarkForActivePage,
    addPageNote,
    deleteBookmarkForDocument,
    deleteAnnotationForDocument,
    importAnnotationsForDocument,
    loadDocumentDecorations,
    forgetDocumentDecorations,
    saveAnnotationForActiveDocument,
    toggleAnnotationTagForDocument,
    updateAnnotationForDocument,
    updateBookmarkForDocument,
  } = useReaderDecorations({ activeSession, persistence });

  // Single release entrance for viewer-held resources. Closing a tab revokes
  // its own blob URL; this covers teardown paths that never go through a close,
  // such as a failed restore replacing the whole session set.
  useEffect(
    () => () => {
      blobUrlCache.clear();
      pdfByteCache.clear();
    },
    [blobUrlCache, pdfByteCache],
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

  const { restoreSession } = useSessionRestore({
    bridge,
    blobUrlCache,
    loadDocumentDecorations,
    pdfByteCache,
    persistence,
    library: research?.library,
    preferences: readerPreferences,
    preferencesLoaded,
    setDocuments,
    setRecentDocuments: mergeRestoredRecentDocuments,
    setSidebarOpen,
    setViewerSource,
  });

  useEffect(() => {
    if (!research) return;
    void research.library.initialize().catch((error) => setAppError(errorMessage(error)));
    return research.library.onLocked((ids) => {
      const keys = new Set(ids.map((id) => `paper:${id}`));
      sessionPersistence.cancel();
      for (const key of keys) {
        documentPersistence.get(key)?.cancel();
        documentPersistence.delete(key);
        pdfByteCache.delete(key);
      }
      forgetDocumentDecorations([...keys]);
      setDocuments((current) => {
        let next = current;
        for (const session of current.sessions) {
          if (keys.has(session.documentKey)) {
            blobUrlCache.revokeForSession(session.id);
            next = closeDocumentSession(next, session.id);
          }
        }
        const active = next.sessions.find((session) => session.id === next.activeSessionId);
        const url = active ? blobUrlCache.getForSession(active.id) : null;
        setViewerSource(active && url ? { sessionId: active.id, url, restore: { page: active.page, zoom: active.zoom } } : null);
        return next;
      });
      setRecentDocuments((items) => items.filter((item) => !keys.has(item.documentKey)));
      setFavoriteDocuments((items) => items.filter((item) => !keys.has(item.documentKey)));
      setGlobalSearchAnnotations((items) => items.filter((item) => !keys.has(item.documentKey)));
      setBookmarkDashboard((current) => current ? {
        groups: current.groups.filter((group) => !keys.has(group.document.documentKey)),
        totalBookmarks: current.groups.filter((group) => !keys.has(group.document.documentKey)).reduce((sum, group) => sum + group.bookmarkCount, 0),
      } : null);
      setSearchState(emptySearchState);
      setSearchText('');
      setGlobalSearchQuery('');
      setGlobalSearchOpen(false);
      setSelectedAnnotationId(null);
      setDocumentInfo(null);
    });
  }, [blobUrlCache, documentPersistence, forgetDocumentDecorations, pdfByteCache, research, sessionPersistence]);



  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    let cancelled = false;
    root.setAttribute('data-theme', readerPreferences.theme);
    const backgroundColor = getComputedStyle(root).getPropertyValue('--sr-bg').trim();
    if (backgroundColor && bridge.setWindowBackgroundColor) {
      const nativeTheme = readerPreferences.theme === 'dark' ? 'dark' : 'light';
      void bridge.setWindowBackgroundColor(backgroundColor, nativeTheme).catch((error) => {
        if (!cancelled) setAppError(`窗口外观同步失败：${errorMessage(error)}`);
      });
    }
    return () => {
      cancelled = true;
      if (previousTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previousTheme);
    };
  }, [bridge, readerPreferences.theme]);

  useEffect(() => {
    let cancelled = false;
    setPreferencesLoadSucceeded(false);

    persistence
      .loadPreferences()
      .then((preferences) => {
        if (!cancelled) {
          setReaderPreferences(mergeReaderPreferences(preferences));
          setPreferencesLoadSucceeded(true);
          setThemeError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) setThemeError(`设置加载失败，暂时无法切换主题：${errorMessage(error)}`);
      })
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
    const hasSessions = displayDocuments.sessions.length > 0;

    if (!hasSessions && !hadReaderSessionsRef.current) {
      return;
    }

    if (hasSessions) {
      hadReaderSessionsRef.current = true;
    }

    const persistedTabs = mapSessionsToPersistedTabs(displayDocuments.sessions);
    setSessionRestoreCount(persistedTabs.length);

    sessionPersistence.schedule({
      activeDocumentKey: activeSession?.documentKey ?? null,
      sidebarOpen,
      tabs: persistedTabs,
    });
  }, [displayDocuments, activeSession, sidebarOpen, sessionPersistence]);

  useEffect(() => {
    const flushBeforeUnload = () => {
      void sessionPersistence.flushNow();
      for (const writer of documentPersistence.values()) void writer.flushNow();
    };

    window.addEventListener('beforeunload', flushBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', flushBeforeUnload);
      sessionPersistence.cancel();
      for (const writer of documentPersistence.values()) writer.cancel();
    };
  }, [documentPersistence, sessionPersistence]);

  const syncRecentDocumentImmediately = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      void Promise.resolve(persistence.saveDocument(document)).catch((error) => setAppError(errorMessage(error)));
    },
    [persistence],
  );

  const syncRecentDocumentProgress = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      let writer = documentPersistence.get(document.documentKey);
      if (!writer) {
        writer = createDebouncedFlush((record: PersistedDocument) => Promise.resolve(persistence.saveDocument(record))
          .catch((error) => setAppError(errorMessage(error))), 250);
        documentPersistence.set(document.documentKey, writer);
      }
      writer.schedule(document);
    },
    [documentPersistence, persistence],
  );

  const handleDocumentOpened = useCallback(
    (document: PersistedDocument) => {
      syncRecentDocumentImmediately(document);
    },
    [syncRecentDocumentImmediately],
  );

  const handleDocumentSessionActivated = useCallback((_documentKey: string) => {
    setWorkspaceOverride(null);
    setWorkspaceReturnTarget(null);
  }, []);

  const {
    handleBrowserFileChange,
    handleDrop,
    openPdf,
    openLibraryPaper,
    reopenDesktopSession,
    reopenRecentDocument,
  } = useDocumentOpening({
    blobUrlCache,
    bridge,
    documents,
    loadDocumentDecorations,
    onDocumentOpened: handleDocumentOpened,
    onDocumentSessionActivated: handleDocumentSessionActivated,
    pdfByteCache,
    persistence,
    library: research?.library,
    onError: setAppError,
    setDocuments,
    setRecentDocuments,
    setViewerSource,
  });

  const importPdfs = useCallback(async (folderId?: string, chooseDirectory = false) => {
    if (!research || importingRef.current) return [];
    const importedIds: string[] = [];
    importingRef.current = true;
    setImporting(true);
    setImportProgress('请选择要导入的 PDF…');
    try {
      const paths = chooseDirectory ? await bridge.selectNativePdfFolder?.() : await bridge.selectNativePdfPaths?.();
      let imported = 0;
      const failures: string[] = [];
      if (paths) {
        for (let index = 0; index < paths.length; index += 1) {
          setImportProgress(`正在导入并建立索引 ${index + 1} / ${paths.length}`);
          try {
            const opened = await bridge.readDesktopPdf(paths[index]);
            const paper = await research.library.importPdf(opened.bytes, opened.source.name, { folderId });
            importedIds.push(paper.id);
            imported += 1;
          } catch (error) { failures.push(errorMessage(error)); }
        }
      } else {
        const opened = await bridge.openNativePdf();
        if (opened) {
          const paper = await research.library.importPdf(opened.bytes, opened.source.name, { folderId });
          importedIds.push(paper.id);
          imported = 1;
        }
      }
      setImportProgress(imported ? `已导入 ${imported} 份 PDF，相同内容会自动合并。${failures.length ? ` ${failures.length} 份失败。` : ''}`
        : chooseDirectory && paths?.length === 0 ? '所选文件夹没有 PDF，或已取消选择。' : '未导入文件。');
      if (failures.length) setAppError(`部分文件导入失败：${[...new Set(failures)].join('；')}`);
      if (imported && homeSidebarPage === 'home') setHomeSidebarPage('myDocuments');
    } catch (error) {
      setAppError(errorMessage(error));
      setImportProgress('导入失败，可重新选择文件。');
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
    return [...new Set(importedIds)];
  }, [bridge, homeSidebarPage, research]);

  const openResearchPaper = useCallback(async (id: string, page?: number) => {
    try {
      const access = research?.library.captureAccess();
      if (access === undefined || !research?.library.canAccess(id, access)) throw new Error('请先解锁文献所在的文件夹。');
      const existing = documents.sessions.find((session) => session.documentKey === `paper:${id}`);
      const url = existing ? blobUrlCache.getForSession(existing.id) : null;
      if (existing && url) {
        setDocuments((current) => {
          if (!research.library.canAccess(id, access) || !current.sessions.some((session) => session.id === existing.id)) return current;
          const next = page === undefined ? current : recordHardNavigation(current, existing.id, page);
          const session = next.sessions.find((candidate) => candidate.id === existing.id)!;
          setViewerSource({ sessionId: session.id, url, restore: { page: session.page, zoom: session.zoom } });
          return { ...next, activeSessionId: existing.id };
        });
        if (activeWorkspace === 'reader' && activeSession?.id === existing.id && page !== undefined) activeViewerController.jumpToPage(page);
        setWorkspaceOverride(null);
        setWorkspaceReturnTarget(null);
      } else {
        await openLibraryPaper(id, page);
      }
    }
    catch (error) { setAppError(errorMessage(error)); }
  }, [activeSession?.id, activeViewerController, activeWorkspace, blobUrlCache, documents.sessions, openLibraryPaper, research]);

  useEffect(() => {
    const showUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      setAppError(errorMessage(event.reason));
    };
    window.addEventListener('unhandledrejection', showUnhandled);
    return () => window.removeEventListener('unhandledrejection', showUnhandled);
  }, []);

  const {
    closeReaderSession,
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

  const refreshBookmarkDashboard = useCallback(async () => {
    bookmarkDashboardRequestRef.current += 1;
    const requestId = bookmarkDashboardRequestRef.current;
    setBookmarkDashboardLoading(true);
    setBookmarkDashboardError(null);

    try {
      const dashboard = await persistence.loadBookmarkDashboard();
      if (requestId === bookmarkDashboardRequestRef.current) {
        setBookmarkDashboard(dashboard);
        setBookmarkDashboardError(null);
      }
    } catch {
      if (requestId === bookmarkDashboardRequestRef.current) {
        setBookmarkDashboardError(bookmarkProviderErrorMessage);
      }
    } finally {
      if (requestId === bookmarkDashboardRequestRef.current) {
        setBookmarkDashboardLoading(false);
      }
    }
  }, [persistence]);

  const refreshGlobalSearchAnnotations = useCallback(() => {
    annotationRefreshRequestRef.current += 1;
    const requestId = annotationRefreshRequestRef.current;
    setGlobalSearchAnnotationError(null);

    void persistence
      .listAllAnnotations()
      .then((annotations) => {
        if (requestId === annotationRefreshRequestRef.current) {
          setGlobalSearchAnnotations(annotations);
          setGlobalSearchAnnotationError(null);
        }
      })
      .catch(() => {
        if (requestId === annotationRefreshRequestRef.current) {
          setGlobalSearchAnnotations([]);
          setGlobalSearchAnnotationError(annotationProviderErrorMessage);
        }
      });
  }, [persistence]);

  const refreshGlobalSearchCollections = useCallback(() => {
    void refreshBookmarkDashboard();
    refreshGlobalSearchAnnotations();
  }, [refreshBookmarkDashboard, refreshGlobalSearchAnnotations]);

  const updateManagedBookmark = useCallback(
    async (bookmark: BookmarkManagementRecord, updates: BookmarkUpdateInput) => {
      const saved = await updateBookmarkForDocument(
        bookmark.documentKey,
        bookmark,
        updates,
      );
      if (!saved || saved.id === null) {
        throw new Error('bookmark is not persisted');
      }
      await refreshBookmarkDashboard();
    },
    [refreshBookmarkDashboard, updateBookmarkForDocument],
  );

  const deleteManagedBookmarks = useCallback(
    async (
      bookmarks: BookmarkManagementRecord[],
    ): Promise<BookmarkDeleteResult> => {
      const succeededIds: number[] = [];
      const failedIds: number[] = [];

      for (const bookmark of bookmarks) {
        if (bookmark.id === null) {
          continue;
        }
        try {
          await deleteBookmarkForDocument(bookmark.documentKey, bookmark.id);
          succeededIds.push(bookmark.id);
        } catch {
          failedIds.push(bookmark.id);
        }
      }

      await refreshBookmarkDashboard();
      return { succeededIds, failedIds };
    },
    [deleteBookmarkForDocument, refreshBookmarkDashboard],
  );

  const handleRenameBookmark = useCallback(
    async (bookmark: Bookmark, title: string) => {
      const saved = await updateBookmarkForDocument(bookmark.documentKey, bookmark, {
        title,
        note: bookmark.note,
      });
      if (saved?.id != null) {
        await refreshBookmarkDashboard();
      }
    },
    [refreshBookmarkDashboard, updateBookmarkForDocument],
  );

  const handleDeleteBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (bookmark.id === null) {
        return;
      }
      await deleteBookmarkForDocument(bookmark.documentKey, bookmark.id);
      await refreshBookmarkDashboard();
    },
    [deleteBookmarkForDocument, refreshBookmarkDashboard],
  );

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

  const recordToolReturnTarget = useCallback(() => {
    if (activeWorkspace === 'home' || activeWorkspace === 'reader') {
      setWorkspaceReturnTarget(activeWorkspace);
    }
  }, [activeWorkspace]);

  const openSettingsWorkspace = useCallback((initialSection: SettingsSection = 'shortcuts') => {
    recordToolReturnTarget();
    setSettingsInitialSection(initialSection);
    setWorkspaceOverride('settings');
  }, [recordToolReturnTarget]);

  const openHomeWorkspace = useCallback(() => {
    setWorkspaceOverride('home');
    setHomeSidebarPage('home');
    setWorkspaceReturnTarget(null);
  }, []);

  const handleCloseReaderSession = useCallback((sessionId: string) => {
    if (!documents.sessions.some((session) => session.id === sessionId)) return;

    closeReaderSession(sessionId);
    if (activeWorkspace === 'home' || activeWorkspace === 'reader') openHomeWorkspace();
  }, [activeWorkspace, closeReaderSession, documents.sessions, openHomeWorkspace]);

  const closeActiveTab = useCallback(() => {
    if (activeSession) handleCloseReaderSession(activeSession.id);
  }, [activeSession, handleCloseReaderSession]);

  const closeToolWorkspace = useCallback(() => {
    setWorkspaceOverride(workspaceReturnTarget === 'home' ? 'home' : null);
    setWorkspaceReturnTarget(null);
  }, [workspaceReturnTarget]);

  const openShortcutWorkspace = useCallback(
    (workspace: Extract<AppWorkspace, 'import' | 'compare' | 'annotations' | 'bookmarks'>) => {
      if (workspace === 'annotations') {
        refreshGlobalSearchAnnotations();
      }
      if (workspace === 'bookmarks') {
        void refreshBookmarkDashboard();
      }
      recordToolReturnTarget();
      setWorkspaceOverride(workspace);
    },
    [recordToolReturnTarget, refreshBookmarkDashboard, refreshGlobalSearchAnnotations],
  );
  const openHomeSidebarPage = useCallback((page: HomeSidebarPage) => {
    setWorkspaceOverride('home');
    setHomeSidebarPage(page);
  }, []);

  const openReaderSession = useCallback(
    (sessionId: string) => {
      if (!documents.sessions.some((session) => session.id === sessionId)) {
        return;
      }

      selectReaderSession(sessionId);
      setWorkspaceOverride(null);
      setWorkspaceReturnTarget(null);
    },
    [documents.sessions, selectReaderSession],
  );
  const openPdfAndIgnoreResult = useCallback(() => {
    void openPdf().catch(() => undefined);
  }, [openPdf]);

  const { commandRegistry } = useReaderCommands({
    activeSession,
    activeViewerController,
    addBookmarkForActivePage,
    addPageNote,
    closeActiveTab,
    focusSearchInput,
    openGlobalSearch,
    openPdf: openPdfAndIgnoreResult,
    selectNextSession: selectNextReaderSession,
    selectPreviousSession: selectPreviousReaderSession,
    setPreferencesOpen: (open) => {
      if (open) {
        openSettingsWorkspace();
      } else {
        closeToolWorkspace();
      }
    },
    setSidebarOpen,
    shortcutsEnabled: !globalSearchOpen,
    stepHistoryBack,
    stepHistoryForward,
    shortcuts: readerPreferences.shortcuts,
  });

  // Falling back to a fresh `[]` gave these a new identity on every render,
  // which defeated memoisation all the way down into the viewer.
  const managedActivePaper = activeSession?.source.kind === 'library'
    ? libraryView.papers.find((paper) => `paper:${paper.id}` === activeSession.documentKey) : undefined;
  const activeBookmarks = managedActivePaper?.bookmarks ?? (activeSession
    ? (bookmarksByDocument[activeSession.documentKey] ?? emptyBookmarks)
    : emptyBookmarks);
  const activeAnnotations = managedActivePaper?.annotations ?? (activeSession
    ? (annotationsByDocument[activeSession.documentKey] ?? emptyAnnotations)
    : emptyAnnotations);
  const favoriteDocumentKeys = useMemo(
    () => new Set(displayFavoriteDocuments.map((document) => document.documentKey)),
    [displayFavoriteDocuments],
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
          documentsToRemove.map(async (document) => {
            await persistence.removeRecentDocument(document.documentKey);
            setRecentDocuments((current) =>
              current.filter((item) => item.documentKey !== document.documentKey),
            );
          }),
        );
      } catch (error) {
        setAppError(`移除记录失败：${errorMessage(error)}`);
      }
    },
    [persistence],
  );

  const handleClearRecentDocuments = useCallback(async () => {
    try {
      await persistence.clearRecentDocuments();
      setRecentDocuments([]);
    } catch (error) {
      setAppError(`清除记录失败：${errorMessage(error)}`);
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
    (keyword: string, options: ViewerSearchOptions = searchOptions) => {
      activeViewerController.search(keyword, options);
      setLastSearchCommand(keyword.trim() ? `已搜索“${keyword.trim()}”` : '已清除搜索');

      if (!keyword.trim()) {
        setSearchState(emptySearchState);
      }
    },
    [activeViewerController, searchOptions],
  );
  // Changing an option re-runs the current query so results never disagree with
  // the checkboxes that produced them.
  const setSearchOptions = useCallback(
    (options: ViewerSearchOptions) => {
      setSearchOptionsState(options);

      if (searchText.trim()) {
        runSearch(searchText, options);
      }
    },
    [runSearch, searchText],
  );
  const jumpToSearchMatch = useCallback(
    (index: number) => {
      activeViewerController.jumpToMatch(index);
      setSearchState((current) => ({ ...current, currentIndex: index }));
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

      const paperId = result.documentKey ? paperIdFromDocumentKey(result.documentKey) : null;
      if (research && paperId && result.source !== 'fullText') {
        await openResearchPaper(paperId, result.page ?? undefined);
        return;
      }

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
      research,
      openResearchPaper,
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

      const paperId = paperIdFromDocumentKey(documentKey);
      if (research && paperId) return Boolean(research.library.getPaper(paperId));

      return (
        activeSession?.documentKey === documentKey ||
        Boolean(findRecentDocumentForRecord(documentKey, path))
      );
    },
    [activeSession, findRecentDocumentForRecord, research, libraryView.papers],
  );

  const openRecordPage = useCallback(
    async (documentKey: string, path: string | null, page: number, missing: boolean) => {
      if (missing) {
        return;
      }

      const paperId = paperIdFromDocumentKey(documentKey);
      if (research && paperId) {
        await openResearchPaper(paperId, page);
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
    [activeSession, findRecentDocumentForRecord, jumpToActiveDocumentPage, reopenRecentDocument, research, openResearchPaper],
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
      const paperId = paperIdFromDocumentKey(document.documentKey);
      if (research && paperId) {
        try { await openLibraryPaper(paperId); return true; }
        catch (error) { setAppError(errorMessage(error)); return false; }
      }
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
    [recentDocuments, reopenRecentDocument, research, openLibraryPaper],
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
        setPreferencesLoadSucceeded(true);
        setThemeError(null);
      } finally {
        setSettingsSaving(false);
      }
    },
    [persistence],
  );
  const handleThemeChange = useCallback(
    async (theme: ReaderTheme) => {
      if (!preferencesLoadSucceeded || settingsSaving || theme === readerPreferences.theme) return;

      const nextPreferences = { ...readerPreferences, theme };
      setThemeError(null);
      setReaderPreferences(nextPreferences);
      try {
        await handleSavePreferences(nextPreferences);
      } catch (error) {
        setReaderPreferences(readerPreferences);
        setThemeError(`主题保存失败，已恢复原主题：${errorMessage(error)}`);
      }
    },
    [preferencesLoadSucceeded, readerPreferences, settingsSaving, handleSavePreferences],
  );
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

  const handleHighlightSelection = useStableCallback((selection: ViewerHighlightSelection) => {
    // The markup menu decides the kind and colour, so a selection can become
    // a highlight, an underline, or a note anchored to the quoted text.
    void saveAnnotationForActiveDocument({
      page: selection.page,
      type: selection.kind,
      color: selection.color,
      text: null,
      quote: selection.selectedText,
      areas: selection.areas,
    }).then((saved) => {
      if (saved?.id != null) {
        setSelectedAnnotationId(saved.id);
      }
    });
  });

  const handleViewerProgress = useStableCallback((progress: ViewerProgress) => {
    if (progress.sessionId !== viewerSource?.sessionId) return;
    if (progress.totalPages !== null) setViewerReadyIdentity(`${viewerSource.sessionId}:${viewerSource.url}`);
    setDocuments((current) => {
      const next = updateSessionProgress(current, progress.sessionId, {
        page: progress.page,
        totalPages: progress.totalPages,
        zoom: progress.zoom,
      });
      const updatedSession = next.sessions.find((session) => session.id === progress.sessionId);

      if (updatedSession?.source.kind === 'desktop-path' || updatedSession?.source.kind === 'library') {
        const existingRecentDocument = recentDocuments.find(
          (document) => document.documentKey === updatedSession.documentKey,
        );
        syncRecentDocumentProgress(
          mapSessionToPersistedDocument(updatedSession, existingRecentDocument),
        );
      }

      return next;
    });
  });

  const handleViewerLoadError = useStableCallback((error: ViewerLoadError) => {
    if (!activeSession || activeSession.id !== viewerSource?.sessionId) return;
    setViewerReadyIdentity(null);
    setDocuments((current) =>
      activeSession ? markSessionError(current, activeSession.id, error.message) : current,
    );
  });

  const handleSearchStateChange = useStableCallback((state: ViewerSearchState) => {
    setSearchState(state);
  });

  const handleDocumentInfo = useStableCallback((info: ViewerDocumentInfo) => {
    if (info.sessionId !== activeSession?.id || info.sessionId !== viewerSource?.sessionId) return;
    setDocumentInfo(info);
  });

  // Memoised so viewer props only change when the document, its annotations or
  // the controller actually change — not on every progress update.
  const viewerContent = useMemo(
    () => (
      <ReaderViewerContent
        activeSession={activeSession}
        viewerSource={viewerSource}
        annotations={activeAnnotations}
        controller={bridgeViewerController}
        renderer={viewerRenderer}
        onOpenPdf={openPdfAndIgnoreResult}
        onRetry={reopenDesktopSession}
        onHighlightSelection={handleHighlightSelection}
        onSearchStateChange={handleSearchStateChange}
        onDocumentInfo={handleDocumentInfo}
        onProgressChange={handleViewerProgress}
        onLoadError={handleViewerLoadError}
      />
    ),
    [
      activeSession,
      viewerSource,
      activeAnnotations,
      bridgeViewerController,
      viewerRenderer,
      openPdfAndIgnoreResult,
      reopenDesktopSession,
      handleHighlightSelection,
      handleSearchStateChange,
      handleDocumentInfo,
      handleViewerProgress,
      handleViewerLoadError,
    ],
  );

  const librarySearchResults = useMemo<GlobalSearchResult[]>(() => research
    ? research.library.search(globalSearchQuery, { limit: 12 }).map((hit) => ({
      id: `library:${hit.paperId}:${hit.page}`, source: 'library',
      title: research.library.getPaper(hit.paperId)?.metadata.title ?? '文献',
      subtitle: `第 ${hit.page} 页 · ${hit.snippet}`, actionLabel: '打开文献',
      documentKey: `paper:${hit.paperId}`, path: null, page: hit.page,
    })) : [], [globalSearchQuery, libraryView.papers, research]);
  const libraryWorkspace = research ? <LibraryWorkspace library={research.library} ai={research.ai}
    onOpenPaper={openResearchPaper} onImport={async (folderId) => { await importPdfs(folderId); }} onOpenAiSettings={() => openSettingsWorkspace('ai')}
    importing={importing} importProgress={importProgress} initialFolderView={homeSidebarPage === 'folders'} /> : null;
  const workspaceContent = research && (homeSidebarPage === 'myDocuments' || homeSidebarPage === 'folders') ? libraryWorkspace
    : research && homeSidebarPage === 'ai' ? <AiAssistant library={research.library} ai={research.ai}
      onOpenPaper={openResearchPaper} onAddPdfs={() => importPdfs()} onOpenSettings={() => openSettingsWorkspace('ai')} />
    : research && homeSidebarPage === 'notes' ? <AnnotationManagerWorkspace title="笔记管理"
      annotations={displayAnnotations.filter((annotation) => annotation.type === 'note')}
      error={globalSearchAnnotationError} canOpenAnnotation={(annotation) => canOpenRecordPage(annotation.documentKey, annotation.documentPath, annotation.documentMissing)}
      onClose={openHomeWorkspace} onOpenAnnotation={(annotation) => void openRecordPage(annotation.documentKey, annotation.documentPath, annotation.page, annotation.documentMissing)} />
    : research && homeSidebarPage === 'sessionRestore' ? <SessionRestoreWorkspace sessions={displayDocuments.sessions}
      documents={displayRecentDocuments} onSelectSession={openReaderSession} onOpenDocument={reopenRecentDocument}
      onRestore={() => restoreSession(undefined, true)} /> : null;

  return (
    <main
      className={`app-shell ${activeWorkspace}-mode`}
      aria-label="SmartReader workbench"
      onDragOver={handleWorkbenchDragOver}
      onDrop={handleWorkbenchDrop}
    >
      {appError || libraryView.error || themeError ? <div className="app-operation-error" role="alert">
        <span>{appError ?? libraryView.error ?? themeError}</span>
        <button type="button" aria-label="关闭提示" onClick={() => { setAppError(null); setThemeError(null); }}>关闭</button>
      </div> : null}
      {activeWorkspace === 'home' || activeWorkspace === 'reader' ? (
        <ReaderTabs
          sessions={displayDocuments.sessions}
          activeSessionId={displayDocuments.activeSessionId}
          homeActive={activeWorkspace === 'home'}
          canOpenNativePdf={() => bridge.canOpenNativePdf?.() ?? true}
          onOpenHome={openHomeWorkspace}
          onOpenPdf={openPdf}
          onBrowserFileChange={handleBrowserFileChange}
          onSelectSession={openReaderSession}
          onCloseSession={handleCloseReaderSession}
        />
      ) : null}
      <ReaderWorkspaceSwitch
        themeSwitcher={
          <ThemeSwitcher
            theme={readerPreferences.theme}
            disabled={!preferencesLoadSucceeded || settingsSaving}
            onChange={(theme) => void handleThemeChange(theme)}
          />
        }
        workspaceContent={workspaceContent}
        importContent={research ? <section className="research-import-workspace">
          <header className="workspace-header"><h1>导入文献</h1><button type="button" onClick={closeToolWorkspace}>返回</button></header>
          {libraryWorkspace}
        </section> : undefined}
        onImportFolder={research ? async () => { await importPdfs(undefined, true); } : undefined}
        importing={importing}
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
        documents={displayDocuments}
        favoriteDocuments={displayFavoriteDocuments}
        globalSearchAnnotationError={globalSearchAnnotationError}
        globalSearchAnnotations={displayAnnotations}
        bookmarkDashboard={displayBookmarkDashboard}
        bookmarkDashboardError={bookmarkDashboardError}
        bookmarkDashboardLoading={bookmarkDashboardLoading}
        lastSearchCommand={lastSearchCommand}
        pageInput={pageInput}
        persistence={persistence}
        readerPreferences={readerPreferences}
        preferencesReady={preferencesLoadSucceeded}
        recentDocuments={displayRecentDocuments}
        searchState={searchState}
        searchOptions={searchOptions}
        documentInfo={documentInfo}
        searchInputRef={searchInputRef}
        searchText={searchText}
        selectedAnnotation={selectedAnnotation}
        sessionRestoreCount={sessionRestoreCount}
        settingsInitialSection={settingsInitialSection}
        settingsSaving={settingsSaving}
        sidebarOpen={sidebarOpen}
        rightPanelOpen={rightPanelOpen}
        viewerContent={viewerContent}
        addBookmarkForActivePage={addBookmarkForActivePage}
        addPageNote={addPageNote}
        canOpenNativePdf={() => bridge.canOpenNativePdf?.() ?? true}
        canOpenRecordPage={canOpenRecordPage}
        clearSearch={clearSearch}
        closeToolWorkspace={closeToolWorkspace}
        deleteBookmark={handleDeleteBookmark}
        deleteManagedBookmarks={deleteManagedBookmarks}
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
        importAnnotationsForDocument={(key, json) => importAnnotationsForDocument(key, json).catch((error) => setAppError(errorMessage(error)))}
        jumpToActiveDocumentPage={jumpToActiveDocumentPage}
        jumpToPage={jumpToPage}
        jumpToSearchMatch={jumpToSearchMatch}
        setSearchOptions={setSearchOptions}
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
        openRecordPage={openRecordPage}
        openSettingsWorkspace={openSettingsWorkspace}
        openShortcutWorkspace={openShortcutWorkspace}
        renameBookmark={handleRenameBookmark}
        refreshBookmarkDashboard={refreshBookmarkDashboard}
        reopenRecentDocument={reopenRecentDocument}
        runSearch={runSearch}
        setPageInput={setPageInput}
        setSearchText={setSearchText}
        setSelectedAnnotationId={setSelectedAnnotationId}
        setSidebarOpen={setSidebarOpen}
        setRightPanelOpen={setRightPanelOpen}
        stepHistoryBack={stepHistoryBack}
        stepHistoryForward={stepHistoryForward}
        updateManagedBookmark={updateManagedBookmark}
      />
      <GlobalSearchPanel
        libraryResults={librarySearchResults}
        open={globalSearchOpen}
        query={globalSearchQuery}
        recentDocuments={displayRecentDocuments}
        favoriteDocuments={displayFavoriteDocuments}
        bookmarks={globalSearchBookmarks}
        annotations={displayAnnotations}
        bookmarkError={bookmarkDashboardError}
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
