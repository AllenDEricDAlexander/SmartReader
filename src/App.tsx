import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import JSZip from "jszip";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  createEmptySession,
  createSessionFromRecentFile,
  createSessionFromFile,
  updateSessionFitMode,
  updateSessionLocation,
  updateSessionSidebarMode,
  updateSessionZoom
} from "./state/documentSessions";
import { createCommandRegistry, shortcutFromKeyboardEvent } from "./state/commandRegistry";
import type { CommandId } from "./state/commandRegistry";
import {
  canNavigateBack,
  canNavigateForward,
  createNavigationHistory,
  navigateBack,
  navigateForward,
  removeNavigationHistory,
  recordNavigation
} from "./state/navigationHistory";
import type { NavigationHistory } from "./state/navigationHistory";
import {
  createSearchSelection,
  removeSearchSelection,
  selectNextSearchResult,
  selectPreviousSearchResult
} from "./state/searchSelection";
import type { SearchSelection } from "./state/searchSelection";
import {
  clearRecentFiles,
  loadRecentFiles,
  recordRecentFile,
  saveRecentFiles
} from "./state/recentFiles";
import {
  createAppSessionSnapshot,
  loadAppSessionSnapshot,
  restoreAppSessionSnapshot,
  saveAppSessionSnapshot
} from "./state/sessionPersistence";
import { sanitizeEpubHtml } from "./reader/epubSanitizer";
import { outlineFromPdf } from "./reader/pdfOutline";
import { isSameReaderLocation, visibleOutlineRows } from "./reader/outlineRows";
import type { OutlineRow } from "./reader/outlineRows";
import {
  exportSmartReaderCacheFile,
  createDesktopSession,
  getSmartReaderCacheInfo,
  importSmartReaderCacheFile,
  listenForDesktopOpenFiles,
  openCacheDirectoryDialog,
  openCacheExportDialog,
  openCacheImportDialog,
  openDesktopFileDialog,
  openEpubDocument,
  openPdfDocument,
  openPendingDesktopFiles,
  readEpubChapter,
  readFileSource,
  renderPdfPageImage,
  searchEpubDocument,
  searchPdfDocument,
  saveSmartReaderCache,
  setSmartReaderCacheLocation,
  setupTauriMenu
} from "./platform/tauriBridge";
import type { DesktopEpubDocument, DesktopPdfDocument } from "./platform/tauriBridge";
import { createAccessErrorSession, isTauriRuntime } from "./platform/fileSources";
import { PreferencesDialog as PreferencesPanel } from "./components/PreferencesDialog";
import type { CacheInfo, CacheStatus, ShortcutConflict, ShortcutPreference } from "./components/PreferencesDialog";
import {
  defaultReaderShortcutBindings,
  findShortcutConflicts,
  shouldHandleReaderShortcut,
  useReaderShortcuts
} from "./hooks/useReaderShortcuts";
import {
  createSmartReaderCacheEnvelope,
  validateSmartReaderCacheEnvelope,
  writeSmartReaderCache as writeLocalSmartReaderCache
} from "./state/smartReaderCache";
import { searchEpubChapters, searchPdfDocumentText } from "./lib/fallbackSearch";
import {
  createFallbackSearchAdapter,
  createSearchWorkerRuntime,
  createWasmSearchAdapter,
  detectWasmFeatures
} from "./lib/wasmAdapter";
import type {
  Bookmark,
  DocumentSession,
  EpubResourceMetadata,
  FitMode,
  OutlineItem,
  Preferences,
  ReaderError,
  ReaderLocation,
  RecentFile,
  SearchResult,
  SidebarMode,
  SmartReaderCacheEnvelope
} from "./types/reader";
import type { SearchAdapter, SearchWorkerDocument, WasmAdapterState } from "./lib/wasmAdapter";

const defaultPreferences: Preferences = {
  reopenLastSession: true,
  rememberPosition: true,
  defaultSidebarVisible: true,
  defaultPdfFitMode: "continuous",
  epubFontSize: 18,
  epubTheme: "system",
  recentRetention: 12,
  cacheLocation: { mode: "default" },
  search: { resultLimit: "unlimited", includePdf: true, includeEpub: true },
  shortcuts: [],
  wasm: { enabled: true },
  pdfKit: { enabled: false }
};

const OUTLINE_ROW_HEIGHT = 34;
const OUTLINE_OVERSCAN_ROWS = 8;
const OUTLINE_FALLBACK_VIEWPORT_HEIGHT = 420;
const THUMBNAIL_ROW_HEIGHT = 76;
const THUMBNAIL_OVERSCAN_ROWS = 2;
const THUMBNAIL_FALLBACK_VIEWPORT_HEIGHT = 420;
const THUMBNAIL_SCALE = 0.18;
const SEARCH_RESULT_ROW_HEIGHT = 58;
const SEARCH_RESULT_OVERSCAN_ROWS = 8;
const SEARCH_RESULT_FALLBACK_VIEWPORT_HEIGHT = 420;
const EPUB_SCROLL_SAVE_DELAY_MS = 250;

const outlineWindowStyle: CSSProperties = {
  position: "relative"
};

const outlineToggleStyle: CSSProperties = {
  border: 0,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  padding: 0
};

const outlineTitleStyle: CSSProperties = {
  minWidth: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  overflow: "hidden",
  padding: 0,
  textAlign: "left",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const CACHE_SAVE_DEBOUNCE_MS = 300;

interface PdfRenderTask {
  promise: Promise<unknown>;
  cancel: () => void;
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const searchAdapterRef = useRef<(query: string) => Promise<SearchResult[]>>(async () => []);
  const openDesktopPathRef = useRef<(path: string) => Promise<void>>(async () => undefined);
  const [initialAppState] = useState(() =>
    restoreAppSessionSnapshot(loadAppSessionSnapshot(), defaultPreferences)
  );
  const [sessions, setSessions] = useState<DocumentSession[]>(() => initialAppState.sessions);
  const [activeTabId, setActiveTabId] = useState(() => initialAppState.activeTabId);
  const [sidebarOpen, setSidebarOpen] = useState(initialAppState.sidebarOpen);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hud, setHud] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState(initialAppState.preferences);
  const [wasmAdapterState, setWasmAdapterState] = useState<WasmAdapterState>({ status: "idle", ready: false });
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecentFiles());
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>(() => ({
    activePath: "Browser local storage",
    defaultPath: "Browser local storage",
    source: "default"
  }));
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>({ state: "idle" });
  const [pendingImportedCache, setPendingImportedCache] = useState<SmartReaderCacheEnvelope | undefined>();
  const [navigationHistories, setNavigationHistories] = useState<Record<string, NavigationHistory>>({});
  const [searchSelections, setSearchSelections] = useState<Record<string, SearchSelection>>({});
  const documentCacheRef = useRef(new Map<string, LoadedReaderDocument>());
  const hudTimerRef = useRef<number | undefined>(undefined);
  const cacheSaveTimerRef = useRef<number | undefined>(undefined);
  const pendingCacheSaveRef = useRef<{ cache: SmartReaderCacheEnvelope; isDesktop: boolean } | undefined>(undefined);
  const pinchZoomFrameRef = useRef<number | undefined>(undefined);
  const pinchZoomDeltaRef = useRef(0);
  const pinchZoomAnchorRef = useRef<{
    container: HTMLElement;
    sessionId: string;
    previousZoom: number;
    anchorX: number;
    anchorY: number;
    pointerX: number;
    pointerY: number;
  } | undefined>(undefined);
  const sessionsRef = useRef<DocumentSession[]>(initialAppState.sessions);
  const searchAdapterInstanceRef = useRef<SearchAdapter | undefined>(undefined);
  const searchAdapterRequestRef = useRef(0);
  const [pdfScrollRevision, setPdfScrollRevision] = useState(0);
  const isDesktop = isTauriRuntime();

  const activeSession = sessions.find((session) => session.id === activeTabId);
  const activeLocationKey = activeSession ? JSON.stringify(activeSession.location) : "";
  const activeNavigationHistory = activeSession
    ? navigationHistories[activeSession.id] ?? createNavigationHistory()
    : createNavigationHistory();
  const activeSearchSelection = activeSession ? searchSelections[activeSession.id] : undefined;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    setSessions((current) => {
      const next = current.map((session) => applyEpubPreferencesToSession(session, preferences));
      return next.every((session, index) => session === current[index]) ? current : next;
    });
  }, [preferences.epubFontSize, preferences.epubTheme]);

  useEffect(() => {
    setSessions((current) => {
      const next = current.map((session) => applyPdfPreferencesToSession(session, preferences));
      return next.every((session, index) => session === current[index]) ? current : next;
    });
  }, [preferences.defaultPdfFitMode]);

  const updateActiveSession = useCallback((updater: (session: DocumentSession) => DocumentSession) => {
    setSessions((current) =>
      current.map((session) => (session.id === activeTabId ? updater(session) : session))
    );
  }, [activeTabId]);

  const showHud = useCallback((message: string) => {
    if (hudTimerRef.current) {
      window.clearTimeout(hudTimerRef.current);
    }
    setHud(message);
    hudTimerRef.current = window.setTimeout(() => setHud(""), 1200);
  }, []);

  const refreshCacheInfo = useCallback(async () => {
    if (!isDesktop) {
      setCacheInfo({
        activePath: "Browser local storage",
        defaultPath: "Browser local storage",
        source: "default"
      });
      return;
    }

    try {
      const info = await getSmartReaderCacheInfo();
      setCacheInfo({
        activePath: info.activePath,
        defaultPath: info.defaultPath,
        customPath: info.isCustom ? info.activePath : undefined,
        source: info.isCustom ? "custom" : "default"
      });
    } catch {
      setCacheStatus({
        state: "error",
        message: "Cache location is unavailable."
      });
    }
  }, [isDesktop]);

  const recordSessionRecent = useCallback((session: DocumentSession) => {
    if (session.status === "ready") {
      setRecentFiles((current) => {
        const next = recordRecentFile(current, session, preferences.recentRetention);
        saveRecentFiles(next);
        return next;
      });
    }
  }, [preferences.recentRetention]);

  const addSession = useCallback((session: DocumentSession) => {
    const preparedSession = applyPreferencesToSession(session, preferences);
    let insertedSession = true;

    setSessions((current) => {
      const existing = preparedSession.filePath
        ? current.find((item) => item.filePath === preparedSession.filePath && item.status !== "empty")
        : undefined;

      if (existing) {
        insertedSession = false;
        setActiveTabId(existing.id);
        return current;
      }

      const next = current.some((item) => item.status === "empty")
        ? current.map((item) => (item.id === activeTabId && item.status === "empty" ? preparedSession : item))
        : [...current, preparedSession];

      return next;
    });
    if (insertedSession) {
      setActiveTabId(preparedSession.id);
      recordSessionRecent(preparedSession);
    }
  }, [activeTabId, preferences, recordSessionRecent]);

  const createCurrentCacheEnvelope = useCallback(() => {
    const snapshot = createAppSessionSnapshot({
      sessions,
      activeTabId,
      sidebarOpen,
      preferences
    });

    return createSmartReaderCacheEnvelope({
      appVersion: "0.1.0",
      settings: preferences,
      recentFiles,
      readingProgress: recentFiles.map((file) => ({
        documentId: file.id,
        title: file.title,
        path: file.path,
        format: file.format,
        location: file.location,
        updatedAt: file.lastOpenedAt
      })),
      session: {
        activeTabId: snapshot.activeTabId,
        sidebarOpen: snapshot.sidebarOpen,
        tabs: snapshot.sessions
      },
      adapterCache: { searchIndexes: [] }
    });
  }, [activeTabId, preferences, recentFiles, sessions, sidebarOpen]);

  const flushPendingCacheSave = useCallback(() => {
    const pendingSave = pendingCacheSaveRef.current;
    if (!pendingSave) {
      return;
    }

    pendingCacheSaveRef.current = undefined;
    if (cacheSaveTimerRef.current) {
      window.clearTimeout(cacheSaveTimerRef.current);
      cacheSaveTimerRef.current = undefined;
    }

    if (pendingSave.isDesktop) {
      saveSmartReaderCache(pendingSave.cache).catch(() => undefined);
      return;
    }

    try {
      writeLocalSmartReaderCache(pendingSave.cache);
    } catch {
      // Local storage can be unavailable in private browser contexts.
    }
  }, []);

  const applyImportedCache = useCallback((cache: SmartReaderCacheEnvelope) => {
    const safeCache = validateSmartReaderCacheEnvelope(cache);

    if (!safeCache) {
      return false;
    }

    const importedPreferences = {
      ...defaultPreferences,
      ...safeCache.settings
    };
    const restored = restoreAppSessionSnapshot(
      {
        version: 1,
        activeTabId: safeCache.session.activeTabId,
        sidebarOpen: safeCache.session.sidebarOpen,
        preferences: importedPreferences,
        sessions: safeCache.session.tabs
      },
      defaultPreferences
    );

    setPreferences(importedPreferences);
    setRecentFiles(safeCache.recentFiles);
    saveRecentFiles(safeCache.recentFiles);
    setSessions(restored.sessions);
    setActiveTabId(restored.activeTabId);
    setSidebarOpen(restored.sidebarOpen);
    setPendingImportedCache(undefined);
    return true;
  }, []);

  const openDesktopPath = useCallback(async (path: string) => {
    const session = await createDesktopSession(path);
    addSession(session);
  }, [addSession]);
  openDesktopPathRef.current = openDesktopPath;

  const openRecentFile = useCallback(async (recent: RecentFile) => {
    if (recent.access === "desktop-path" && isDesktop) {
      const existing = sessions.find((session) => session.filePath === recent.path && session.status !== "empty");
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      const validatedSession = await createDesktopSession(recent.path);
      addSession(validatedSession.status === "ready" ? createSessionFromRecentFile(recent) : validatedSession);
      return;
    }

    addSession(createAccessErrorSession(recent.path));
  }, [addSession, isDesktop, sessions]);

  const openFilePicker = useCallback(async () => {
    if (isDesktop) {
      const path = await openDesktopFileDialog();
      if (path) {
        await openDesktopPath(path);
      }
      return;
    }

    fileInputRef.current?.click();
  }, [isDesktop, openDesktopPath]);

  const openFile = useCallback((file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const session = createSessionFromFile({
      kind: "browser-file",
      path: file.name,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      file,
      objectUrl
    });

    addSession(session);
  }, [addSession]);

  const chooseCacheDirectory = useCallback(async (options: { moveExisting: boolean }) => {
    if (!isDesktop) {
      setCacheStatus({ state: "error", message: "Custom cache locations require the desktop app." });
      return;
    }

    const path = await openCacheDirectoryDialog();
    if (!path) {
      return;
    }

    setCacheStatus({ state: "loading", message: "Updating cache location..." });
    try {
      const result = await setSmartReaderCacheLocation(path, options.moveExisting);
      setPreferences((current) => ({
        ...current,
        cacheLocation: { mode: "custom", path: result.activePath }
      }));
      await refreshCacheInfo();
      setCacheStatus({ state: "success", message: "Cache location updated." });
    } catch {
      setCacheStatus({ state: "error", message: "Cache location could not be updated." });
    }
  }, [isDesktop, refreshCacheInfo]);

  const resetCacheDirectory = useCallback(async () => {
    if (!isDesktop) {
      setCacheStatus({ state: "error", message: "Custom cache locations require the desktop app." });
      return;
    }

    setCacheStatus({ state: "loading", message: "Resetting cache location..." });
    try {
      await setSmartReaderCacheLocation("", false);
      setPreferences((current) => ({
        ...current,
        cacheLocation: { mode: "default" }
      }));
      await refreshCacheInfo();
      setCacheStatus({ state: "success", message: "Cache location reset." });
    } catch {
      setCacheStatus({ state: "error", message: "Cache location could not be reset." });
    }
  }, [isDesktop, refreshCacheInfo]);

  const exportCache = useCallback(async () => {
    if (!isDesktop) {
      setCacheStatus({ state: "error", message: "Cache export requires the desktop app." });
      return;
    }

    const destinationPath = await openCacheExportDialog();
    if (!destinationPath) {
      return;
    }

    setCacheStatus({ state: "loading", message: "Exporting cache..." });
    try {
      await exportSmartReaderCacheFile(destinationPath, createCurrentCacheEnvelope());
      setCacheStatus({ state: "success", message: "Cache exported." });
    } catch {
      setCacheStatus({ state: "error", message: "Cache could not be exported." });
    }
  }, [createCurrentCacheEnvelope, isDesktop]);

  const importCache = useCallback(async () => {
    if (!isDesktop) {
      setCacheStatus({ state: "error", message: "Cache import requires the desktop app." });
      return;
    }

    const sourcePath = await openCacheImportDialog();
    if (!sourcePath) {
      return;
    }

    setCacheStatus({ state: "loading", message: "Validating cache import..." });
    try {
      const result = await importSmartReaderCacheFile(sourcePath, false);
      const safeCache = validateSmartReaderCacheEnvelope(result.cache);

      if (!safeCache) {
        throw new Error("Invalid SmartReader cache.");
      }

      setPendingImportedCache(safeCache);
      setCacheStatus({
        state: "success",
        message: "Cache archive validated.",
        pendingImportName: sourcePath.split("/").pop(),
        pendingImportPath: sourcePath
      });
    } catch {
      setPendingImportedCache(undefined);
      setCacheStatus({ state: "error", message: "Cache import is invalid." });
    }
  }, [isDesktop]);

  const applyPendingImportedCache = useCallback(async () => {
    if (!pendingImportedCache) {
      return;
    }

    setCacheStatus({ state: "loading", message: "Applying imported cache..." });
    try {
      const safeCache = validateSmartReaderCacheEnvelope(pendingImportedCache);

      if (!safeCache || !applyImportedCache(safeCache)) {
        throw new Error("Invalid SmartReader cache.");
      }

      if (isDesktop) {
        await saveSmartReaderCache(safeCache);
      } else {
        writeLocalSmartReaderCache(safeCache);
      }
      await refreshCacheInfo();
      setCacheStatus({ state: "success", message: "Imported cache applied." });
    } catch {
      setCacheStatus({ state: "error", message: "Imported cache could not be applied." });
    }
  }, [applyImportedCache, isDesktop, pendingImportedCache, refreshCacheInfo]);

  const closeTab = useCallback((tabId = activeTabId) => {
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === tabId);
      const closingSession = current[index];

      if (!closingSession) {
        return current;
      }

      disposeSessionResources(closingSession, documentCacheRef.current.get(tabId));
      documentCacheRef.current.delete(tabId);
      setNavigationHistories((currentHistories) => removeNavigationHistory(currentHistories, tabId));
      setSearchSelections((currentSelections) => removeSearchSelection(currentSelections, tabId));

      if (current.length === 1) {
        const empty = createEmptySession();
        setActiveTabId(empty.id);
        searchAdapterInstanceRef.current?.dispose();
        searchAdapterInstanceRef.current = undefined;
        searchAdapterRef.current = async () => [];
        return [empty];
      }

      const next = current.filter((session) => session.id !== tabId);
      if (tabId === activeTabId) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
        searchAdapterInstanceRef.current?.dispose();
        searchAdapterInstanceRef.current = undefined;
        searchAdapterRef.current = async () => [];
      }
      return next;
    });
  }, [activeTabId]);

  const createNewTab = useCallback(() => {
    const session = createEmptySession();
    setSessions((current) => [...current, session]);
    setActiveTabId(session.id);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    updateActiveSession((session) => {
      const next = updateSessionZoom(session, session.zoom + delta);
      showHud(`${Math.round(next.zoom * 100)}%`);
      return next;
    });
  }, [showHud, updateActiveSession]);

  const handleReaderPinchZoom = useCallback((event: React.WheelEvent<HTMLElement>) => {
    if (!event.ctrlKey || !activeSession || activeSession.status !== "ready" || activeSession.format !== "pdf") {
      return;
    }

    event.preventDefault();

    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    pinchZoomDeltaRef.current += event.deltaY < 0 ? 0.1 : -0.1;
    pinchZoomAnchorRef.current = {
      container,
      sessionId: activeSession.id,
      previousZoom: activeSession.zoom,
      anchorX: container.scrollLeft + pointerX,
      anchorY: container.scrollTop + pointerY,
      pointerX,
      pointerY
    };

    if (pinchZoomFrameRef.current !== undefined) {
      return;
    }

    pinchZoomFrameRef.current = -1;
    const frameId = window.requestAnimationFrame(() => {
      const anchor = pinchZoomAnchorRef.current;
      const delta = pinchZoomDeltaRef.current;
      pinchZoomFrameRef.current = undefined;
      pinchZoomAnchorRef.current = undefined;
      pinchZoomDeltaRef.current = 0;

      if (!anchor || delta === 0) {
        return;
      }

      const nextZoom = clampZoom(anchor.previousZoom + delta);
      updateActiveSession((session) => {
        if (session.id !== anchor.sessionId || session.status !== "ready" || session.format !== "pdf") {
          return session;
        }

        return updateSessionZoom(
          session.fitMode === "continuous" ? session : { ...session, fitMode: "continuous" },
          session.zoom + delta
        );
      });
      showHud(`${Math.round(nextZoom * 100)}%`);

      if (nextZoom === anchor.previousZoom) {
        return;
      }

      const zoomRatio = nextZoom / anchor.previousZoom;
      anchor.container.scrollTo?.({
        left: Math.max(0, anchor.anchorX * zoomRatio - anchor.pointerX),
        top: Math.max(0, anchor.anchorY * zoomRatio - anchor.pointerY)
      });
    });
    if (pinchZoomFrameRef.current === -1) {
      pinchZoomFrameRef.current = frameId;
    }
  }, [activeSession, showHud, updateActiveSession]);

  const resetZoom = useCallback(() => {
    updateActiveSession((session) => updateSessionZoom(session, 1));
    showHud("100%");
  }, [showHud, updateActiveSession]);

  const toggleBookmark = useCallback(() => {
    updateActiveSession((session) => {
      const existing = session.bookmarks.find((bookmark) =>
        isSameReaderLocation(bookmark.location, session.location)
      );

      if (existing) {
        return {
          ...session,
          bookmarks: session.bookmarks.filter((bookmark) => bookmark.id !== existing.id)
        };
      }

      const bookmark: Bookmark = {
        id: `bookmark-${Date.now()}`,
        title: locationLabel(session),
        location: session.location,
        createdAt: Date.now()
      };

      return { ...session, bookmarks: [bookmark, ...session.bookmarks] };
    });
    showHud("Bookmark updated");
  }, [showHud, updateActiveSession]);

  const configureSearchAdapter = useCallback((
    handler: (query: string) => Promise<SearchResult[]>,
    wasmDocuments: SearchWorkerDocument[] = []
  ) => {
    const requestId = ++searchAdapterRequestRef.current;
    searchAdapterInstanceRef.current?.dispose();

    const fallback = createFallbackSearchAdapter(handler);

    if (!preferences.wasm.enabled) {
      fallback.init();
      searchAdapterInstanceRef.current = fallback;
      searchAdapterRef.current = (query) => fallback.search(query);
      setWasmAdapterState({
        status: "unavailable",
        ready: false,
        error: new Error("WASM adapter disabled.")
      });
      return;
    }

    const adapter = createWasmSearchAdapter({
      fallback,
      loadRuntime: wasmDocuments.length > 0
        ? () => createSearchWorkerRuntime(wasmDocuments)
        : undefined
    });

    searchAdapterInstanceRef.current = adapter;
    searchAdapterRef.current = async (query) => {
      const results = await adapter.search(query);
      setWasmAdapterState({ ...adapter.state });
      return results;
    };

    const initPromise = adapter.init();
    setWasmAdapterState({ ...adapter.state });
    initPromise
      .then(() => {
        if (requestId === searchAdapterRequestRef.current) {
          setWasmAdapterState({ ...adapter.state });
        }
      })
      .catch(() => {
        if (requestId === searchAdapterRequestRef.current) {
          setWasmAdapterState({ ...adapter.state });
        }
      });
  }, [preferences.wasm.enabled]);

  const runSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      updateActiveSession((session) => ({ ...session, searchResults: [] }));
      if (activeSession) {
        setSearchSelections((current) => {
          const next = { ...current };
          delete next[activeSession.id];
          return next;
        });
      }
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchAdapterRef.current(trimmedQuery);
      updateActiveSession((session) => ({
        ...session,
        sidebarMode: "search",
        searchResults: results
      }));
      if (activeSession) {
        const selection = createSearchSelection(trimmedQuery, results);
        setSearchSelections((current) => ({ ...current, [activeSession.id]: selection }));
        if (results[selection.currentIndex]) {
          jumpToLocation(results[selection.currentIndex].location);
        } else {
          showHud("No results");
        }
      }
      setSidebarOpen(true);
    } catch {
      showHud("Search failed");
    } finally {
      setIsSearching(false);
    }
  }, [activeSession, showHud, updateActiveSession]);

  const handleLocationChange = useCallback((location: ReaderLocation) => {
    updateActiveSession((session) => updateSessionLocation(session, location));
  }, [updateActiveSession]);

  const jumpToLocation = useCallback((location: ReaderLocation) => {
    setPdfScrollRevision((revision) => revision + 1);
    updateActiveSession((session) => {
      setNavigationHistories((current) => ({
        ...current,
        [session.id]: recordNavigation(current[session.id] ?? createNavigationHistory(), session.location, location)
      }));
      return updateSessionLocation(session, location);
    });
  }, [updateActiveSession]);

  const navigateHistoryBack = useCallback(() => {
    if (!activeSession) {
      return;
    }

    const result = navigateBack(activeNavigationHistory, activeSession.location);
    setNavigationHistories((current) => ({ ...current, [activeSession.id]: result.history }));
    setPdfScrollRevision((revision) => revision + 1);
    updateActiveSession((session) => updateSessionLocation(session, result.location));
  }, [activeNavigationHistory, activeSession, updateActiveSession]);

  const navigateHistoryForward = useCallback(() => {
    if (!activeSession) {
      return;
    }

    const result = navigateForward(activeNavigationHistory, activeSession.location);
    setNavigationHistories((current) => ({ ...current, [activeSession.id]: result.history }));
    setPdfScrollRevision((revision) => revision + 1);
    updateActiveSession((session) => updateSessionLocation(session, result.location));
  }, [activeNavigationHistory, activeSession, updateActiveSession]);

  const selectSearchResult = useCallback((direction: "next" | "previous") => {
    if (!activeSession || activeSession.searchResults.length === 0 || !activeSearchSelection) {
      showHud("No results");
      return;
    }

    const nextSelection = direction === "next"
      ? selectNextSearchResult(activeSearchSelection, activeSession.searchResults)
      : selectPreviousSearchResult(activeSearchSelection, activeSession.searchResults);
    const result = activeSession.searchResults[nextSelection.currentIndex];
    setSearchSelections((current) => ({ ...current, [activeSession.id]: nextSelection }));
    if (result) {
      jumpToLocation(result.location);
    }
  }, [activeSearchSelection, activeSession, jumpToLocation, showHud]);

  const movePdfPage = useCallback((delta: number) => {
    setPdfScrollRevision((revision) => revision + 1);
    updateActiveSession((session) => {
      if (session.format !== "pdf" || session.location.kind !== "page") {
        return session;
      }

      const maxPage = session.pageCount ?? session.location.page;
      const page = Math.min(maxPage, Math.max(1, session.location.page + delta));
      const location = { kind: "page" as const, page };
      setNavigationHistories((current) => ({
        ...current,
        [session.id]: recordNavigation(current[session.id] ?? createNavigationHistory(), session.location, location)
      }));

      return updateSessionLocation(session, location);
    });
  }, [updateActiveSession]);

  const registry = useMemo(
    () =>
      createCommandRegistry({
        getActiveSession: () => activeSession,
        actions: {
          openFile: openFilePicker,
          closeTab,
          createEmptyTab: createNewTab,
          toggleSidebar: () => setSidebarOpen((value) => !value),
          openFind: () => setFindOpen(true),
          findNext: () => selectSearchResult("next"),
          findPrevious: () => selectSearchResult("previous"),
          zoomIn: () => zoomBy(0.1),
          zoomOut: () => zoomBy(-0.1),
          resetZoom,
          toggleBookmark,
          openPreferences: () => setPreferencesOpen(true),
          focusLocationInput: () => locationInputRef.current?.focus(),
          navigateBack: navigateHistoryBack,
          navigateForward: navigateHistoryForward
        }
      }),
    [
      activeSession,
      closeTab,
      createNewTab,
      navigateHistoryBack,
      navigateHistoryForward,
      openFilePicker,
      resetZoom,
      selectSearchResult,
      toggleBookmark,
      zoomBy
    ]
  );

  const readerShortcutHandlers = useMemo(
    () => ({
      "reader.previousPage": () => movePdfPage(-1),
      "reader.nextPage": () => movePdfPage(1),
      "reader.zoomIn": () => zoomBy(0.1),
      "reader.zoomOut": () => zoomBy(-0.1),
      "reader.openFind": () => setFindOpen(true),
      "reader.toggleBookmark": toggleBookmark,
      "reader.toggleSidebar": () => setSidebarOpen((value) => !value)
    }),
    [movePdfPage, toggleBookmark, zoomBy]
  );
  const readerShortcutBindings = useMemo(
    () => defaultReaderShortcutBindings(preferences.shortcuts),
    [preferences.shortcuts]
  );
  const shortcutPreferences = useMemo<ShortcutPreference[]>(() => [
    ...registry.commands
      .filter((command) => Boolean(command.shortcut))
      .map((command) => ({
        id: command.id,
        command: command.label,
        shortcut: command.shortcut ?? "",
        enabled: command.enabled,
        editable: false
      })),
    ...readerShortcutBindings.map((binding) => ({
      id: binding.commandId,
      command: readerShortcutLabel(binding.commandId),
      shortcut: binding.shortcut,
      enabled: binding.enabled !== false,
      editable: true
    }))
  ], [readerShortcutBindings, registry.commands]);
  const shortcutConflicts = useMemo<ShortcutConflict[]>(
    () =>
      findShortcutConflicts([
        ...registry.commands
          .filter((command) => Boolean(command.shortcut))
          .map((command) => ({ commandId: command.id, shortcut: command.shortcut ?? "" })),
        ...readerShortcutBindings
      ]).map((conflict) => ({
        shortcut: conflict.shortcut,
        commandIds: conflict.commandIds,
        message: `${conflict.shortcut} is assigned to multiple commands.`
      })),
    [readerShortcutBindings, registry.commands]
  );
  const updateShortcutPreference = useCallback((id: string, shortcut: string) => {
    setPreferences((current) => ({
      ...current,
      shortcuts: [
        ...current.shortcuts.filter((binding) => binding.commandId !== id),
        { commandId: id, shortcut, enabled: true, source: "user" }
      ]
    }));
  }, []);
  const resetShortcutPreference = useCallback((id: string) => {
    setPreferences((current) => ({
      ...current,
      shortcuts: current.shortcuts.filter((binding) => binding.commandId !== id)
    }));
  }, []);

  useReaderShortcuts({
    bindings: preferences.shortcuts,
    handlers: readerShortcutHandlers
  });

  useEffect(() => {
    setupTauriMenu((commandId: CommandId) => {
      window.dispatchEvent(new CustomEvent<CommandId>("smartreader:menu-command", { detail: commandId }));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    saveAppSessionSnapshot(
      createAppSessionSnapshot({
        sessions,
        activeTabId,
        sidebarOpen,
        preferences
      })
    );
  }, [activeTabId, preferences, sessions, sidebarOpen]);

  useEffect(() => {
    refreshCacheInfo();
  }, [refreshCacheInfo]);

  useEffect(() => {
    if (cacheSaveTimerRef.current) {
      window.clearTimeout(cacheSaveTimerRef.current);
    }

    const cache = createCurrentCacheEnvelope();
    pendingCacheSaveRef.current = { cache, isDesktop };
    cacheSaveTimerRef.current = window.setTimeout(() => {
      flushPendingCacheSave();
    }, CACHE_SAVE_DEBOUNCE_MS);

    return () => {
      if (cacheSaveTimerRef.current) {
        window.clearTimeout(cacheSaveTimerRef.current);
        cacheSaveTimerRef.current = undefined;
      }
    };
  }, [createCurrentCacheEnvelope, flushPendingCacheSave, isDesktop]);

  useEffect(() => () => {
    flushPendingCacheSave();

    if (pinchZoomFrameRef.current !== undefined) {
      window.cancelAnimationFrame(pinchZoomFrameRef.current);
      pinchZoomFrameRef.current = undefined;
    }
  }, [flushPendingCacheSave]);

  useEffect(() => {
    if (activeSession?.status !== "ready") {
      searchAdapterInstanceRef.current?.dispose();
      searchAdapterInstanceRef.current = undefined;
      searchAdapterRef.current = async () => [];
      setWasmAdapterState({ status: "idle", ready: false });
    }
  }, [activeSession?.id, activeSession?.status]);

  useEffect(() => {
    if (activeSession?.status !== "ready") {
      return;
    }

    setRecentFiles((current) => {
      const next = recordRecentFile(current, activeSession, preferences.recentRetention);
      saveRecentFiles(next);
      return next;
    });
  }, [activeLocationKey, activeSession?.id, preferences.recentRetention]);

  useEffect(() => {
    const onMenuCommand = (event: Event) => {
      const commandId = (event as CustomEvent<CommandId>).detail;
      registry.runCommand(commandId);
    };

    window.addEventListener("smartreader:menu-command", onMenuCommand);
    return () => window.removeEventListener("smartreader:menu-command", onMenuCommand);
  }, [registry]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    openPendingDesktopFiles((path) => {
      openDesktopPathRef.current(path);
    }).catch(() => undefined);
    listenForDesktopOpenFiles((path) => {
      openDesktopPathRef.current(path);
    }).then((cleanup) => {
      if (disposed) {
        cleanup?.();
        return;
      }
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current);
      }
      documentCacheRef.current.forEach((document, sessionId) => {
        const session = sessionsRef.current.find((item) => item.id === sessionId);
        disposeSessionResources(session, document);
      });
      documentCacheRef.current.clear();
      searchAdapterInstanceRef.current?.dispose();
      searchAdapterInstanceRef.current = undefined;
      searchAdapterRef.current = async () => [];
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (findOpen) {
          setFindOpen(false);
          return;
        }

        setPreferencesOpen(false);
      }

      if (event.metaKey) {
        if (!shouldHandleReaderShortcut(event)) {
          return;
        }

        const tabNumber = Number(event.key);
        if (tabNumber >= 1 && tabNumber <= 9 && sessions[tabNumber - 1]) {
          event.preventDefault();
          setActiveTabId(sessions[tabNumber - 1].id);
          return;
        }
      }

      const handled = registry.runShortcut(shortcutFromKeyboardEvent(event));
      if (handled) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [findOpen, registry, sessions]);

  return (
    <main
      className={`app-shell ${isDesktop ? "desktop-shell" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) {
          openFile(file);
        }
      }}
    >
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            openFile(file);
          }
          event.currentTarget.value = "";
        }}
      />

      <TabStrip
        sessions={sessions}
        activeTabId={activeTabId}
        onActivate={setActiveTabId}
        onClose={closeTab}
        onNewTab={createNewTab}
      />

      <CommandToolbar
        session={activeSession}
        sidebarOpen={sidebarOpen}
        locationInputRef={locationInputRef}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onOpen={openFilePicker}
        onZoomOut={() => zoomBy(-0.1)}
        onZoomIn={() => zoomBy(0.1)}
        onResetZoom={resetZoom}
        onOpenFind={() => setFindOpen(true)}
        onToggleBookmark={toggleBookmark}
        onPreferences={() => setPreferencesOpen(true)}
        onNavigateBack={navigateHistoryBack}
        onNavigateForward={navigateHistoryForward}
        canNavigateBack={canNavigateBack(activeNavigationHistory)}
        canNavigateForward={canNavigateForward(activeNavigationHistory)}
        onFitMode={(fitMode) => updateActiveSession((session) => updateSessionFitMode(session, fitMode))}
        onLocationSubmit={(location) => {
          jumpToLocation(location);
          showHud(locationToStatus(location, activeSession?.pageCount));
        }}
      />

      {findOpen ? (
        <FindBar
          query={findQuery}
          isSearching={isSearching}
          onChange={setFindQuery}
          onSubmit={() => runSearch(findQuery)}
          onClear={() => {
            setFindQuery("");
            runSearch("");
          }}
          onNext={() => selectSearchResult("next")}
          onPrevious={() => selectSearchResult("previous")}
          currentIndex={activeSearchSelection?.currentIndex ?? -1}
          total={activeSearchSelection?.total ?? activeSession?.searchResults.length ?? 0}
          onClose={() => setFindOpen(false)}
        />
      ) : null}

      <section className={`reader-workspace ${sidebarOpen ? "with-sidebar" : ""}`}>
        {sidebarOpen ? (
          <ReaderSidebar
            session={activeSession}
            onModeChange={(mode) => updateActiveSession((session) => updateSessionSidebarMode(session, mode))}
            onJump={jumpToLocation}
          />
        ) : null}

        <ReaderViewport
          session={activeSession}
          recentFiles={recentFiles}
          preferences={preferences}
          documentCache={documentCacheRef.current}
          scrollRevision={pdfScrollRevision}
          onOpen={openFilePicker}
          onOpenRecent={openRecentFile}
          onRemoveRecent={(path) => {
            const next = recentFiles.filter((recent) => recent.path !== path);
            saveRecentFiles(next);
            setRecentFiles(next);
          }}
          onClearRecent={() => {
            const next = clearRecentFiles();
            saveRecentFiles(next);
            setRecentFiles(next);
          }}
          onLocationChange={handleLocationChange}
          onNavigate={jumpToLocation}
          onOutlineChange={(outline) => updateActiveSession((session) => ({ ...session, outline }))}
          onPageCountChange={(pageCount) => updateActiveSession((session) => ({ ...session, pageCount }))}
          onSearchReady={configureSearchAdapter}
          searchQuery={findQuery}
          searchSelection={activeSearchSelection}
          onPinchZoom={handleReaderPinchZoom}
        />
      </section>

      {hud ? <div className="reader-hud">{hud}</div> : null}

      {preferencesOpen ? (
        <PreferencesPanel
          preferences={preferences}
          onChange={setPreferences}
          onClose={() => setPreferencesOpen(false)}
          onClearRecent={() => {
            const next = clearRecentFiles();
            saveRecentFiles(next);
            setRecentFiles(next);
          }}
          cacheInfo={cacheInfo}
          cacheStatus={cacheStatus}
          onChooseCacheDirectory={chooseCacheDirectory}
          onResetCacheDirectory={resetCacheDirectory}
          onExportCache={exportCache}
          onImportCache={importCache}
          onApplyImportedCache={applyPendingImportedCache}
          shortcuts={shortcutPreferences}
          conflicts={shortcutConflicts}
          onShortcutChange={updateShortcutPreference}
          onShortcutReset={resetShortcutPreference}
          wasm={{
            settings: { enabled: preferences.wasm.enabled },
            status: {
              enabled: preferences.wasm.enabled && detectWasmFeatures().supported,
              adapterStatus: visibleWasmStatus(wasmAdapterState),
              fallbackActive: wasmAdapterState.status !== "ready",
              message: wasmStatusMessage(preferences.wasm.enabled, wasmAdapterState)
            }
          }}
          onToggleWasm={(enabled) =>
            setPreferences((current) => ({
              ...current,
              wasm: { ...current.wasm, enabled }
            }))
          }
          onTogglePdfKit={(enabled) =>
            setPreferences((current) => ({
              ...current,
              pdfKit: { enabled }
            }))
          }
        />
      ) : null}
    </main>
  );
}

function TabStrip(props: {
  sessions: DocumentSession[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}) {
  return (
    <nav className="tab-strip" aria-label="Open documents">
      <div className="traffic-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="tab-scroll">
        {props.sessions.map((session, index) => (
          <button
            key={session.id}
            className={`tab-item ${session.id === props.activeTabId ? "active" : ""}`}
            type="button"
            onClick={() => props.onActivate(session.id)}
          >
            <span className={`format-dot ${session.format}`} />
            <span className="tab-copy">
              <span className="tab-title">{session.title}</span>
              <span className="tab-meta">{tabProgressLabel(session)}</span>
            </span>
            {session.status === "error" ? <span className="tab-error" aria-label="Error" /> : null}
            <span className="tab-shortcut">{index < 9 ? `⌘${index + 1}` : ""}</span>
            <span
              role="button"
              tabIndex={0}
              className="tab-close"
              aria-label={`Close ${session.title}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onClose(session.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onClose(session.id);
                }
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
      <button className="new-tab-button" type="button" aria-label="New tab" onClick={props.onNewTab}>
        +
      </button>
    </nav>
  );
}

function CommandToolbar(props: {
  session?: DocumentSession;
  sidebarOpen: boolean;
  locationInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleSidebar: () => void;
  onOpen: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
  onOpenFind: () => void;
  onToggleBookmark: () => void;
  onPreferences: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onFitMode: (fitMode: FitMode) => void;
  onLocationSubmit: (location: ReaderLocation) => void;
}) {
  const hasDocument = props.session?.status === "ready";
  const locationValue =
    props.session?.location.kind === "page" ? String(props.session.location.page) : locationLabel(props.session);

  return (
    <header className="command-toolbar" aria-label="Reader toolbar">
      <ToolbarButton
        label="Toggle sidebar"
        pressed={props.sidebarOpen}
        icon="sidebar"
        onClick={props.onToggleSidebar}
      />
      <ToolbarButton label="Open file" icon="open" onClick={props.onOpen} />
      <span className="toolbar-separator history-control" />
      <ToolbarButton
        className="history-control"
        label="Back"
        icon="back"
        disabled={!hasDocument || !props.canNavigateBack}
        onClick={props.onNavigateBack}
      />
      <ToolbarButton
        className="history-control"
        label="Forward"
        icon="forward"
        disabled={!hasDocument || !props.canNavigateForward}
        onClick={props.onNavigateForward}
      />
      <form
        className="location-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = props.locationInputRef.current?.value ?? "";
          const page = Number(value);
          if (Number.isFinite(page) && page > 0) {
            props.onLocationSubmit({ kind: "page", page });
          }
        }}
      >
        <input
          ref={props.locationInputRef}
          aria-label="Page or location"
          disabled={!hasDocument}
          defaultValue={locationValue}
          key={`${props.session?.id}-${locationValue}`}
        />
        {props.session?.pageCount ? <span>/ {props.session.pageCount}</span> : null}
      </form>
      <span className="toolbar-status" aria-live="polite">{readerStatusLabel(props.session)}</span>
      <span className="toolbar-separator zoom-control" />
      <ToolbarButton
        className="zoom-control"
        label="Zoom out"
        icon="minus"
        disabled={!hasDocument}
        onClick={props.onZoomOut}
      />
      <button className="zoom-value zoom-control" type="button" disabled={!hasDocument} onClick={props.onResetZoom}>
        {Math.round((props.session?.zoom ?? 1) * 100)}%
      </button>
      <ToolbarButton
        className="zoom-control"
        label="Zoom in"
        icon="plus"
        disabled={!hasDocument}
        onClick={props.onZoomIn}
      />
      <select
        className="fit-select"
        aria-label="Fit mode"
        disabled={!hasDocument || props.session?.format === "epub"}
        value={props.session?.fitMode ?? "continuous"}
        onChange={(event) => props.onFitMode(event.currentTarget.value as FitMode)}
      >
        <option value="continuous">Continuous</option>
        <option value="single">Single</option>
        <option value="fit-width">Fit Width</option>
        <option value="fit-page">Fit Page</option>
        <option value="actual-size">Actual Size</option>
      </select>
      <span className="toolbar-spacer" />
      <ToolbarButton label="Find" icon="search" disabled={!hasDocument} onClick={props.onOpenFind} />
      <ToolbarButton label="Bookmark" icon="bookmark" disabled={!hasDocument} onClick={props.onToggleBookmark} />
      <ToolbarButton label="More" icon="more" onClick={props.onPreferences} />
    </header>
  );
}

function ToolbarButton(props: {
  label: string;
  icon: IconName;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`toolbar-button ${props.className ?? ""}`}
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

function FindBar(props: {
  query: string;
  isSearching: boolean;
  onChange: (query: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onNext: () => void;
  onPrevious: () => void;
  currentIndex: number;
  total: number;
  onClose: () => void;
}) {
  const hasResults = props.total > 0 && props.currentIndex >= 0;

  return (
    <form
      className="find-bar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <Icon name="search" />
      <input
        autoFocus
        aria-label="Find in document"
        placeholder="Find in document"
        value={props.query}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
          if (!event.currentTarget.value) {
            props.onClear();
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {hasResults ? props.currentIndex + 1 : 0} / {props.total}
      </span>
      <button type="button" aria-label="Previous result" disabled={!hasResults} onClick={props.onPrevious}>
        Previous
      </button>
      <button type="button" aria-label="Next result" disabled={!hasResults} onClick={props.onNext}>
        Next
      </button>
      <button type="button" aria-label="Clear find" disabled={!props.query} onClick={props.onClear}>
        Clear
      </button>
      <button type="submit">{props.isSearching ? "Searching" : "Find"}</button>
      <button type="button" aria-label="Close find" onClick={props.onClose}>
        ×
      </button>
    </form>
  );
}

function ReaderSidebar(props: {
  session?: DocumentSession;
  onModeChange: (mode: SidebarMode) => void;
  onJump: (location: ReaderLocation) => void;
}) {
  const mode = props.session?.sidebarMode ?? "contents";
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ top: 0, height: 0 });
  const syncScrollState = useCallback(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const next = {
      top: content.scrollTop,
      height: content.clientHeight
    };
    setScrollState((current) =>
      current.top === next.top && current.height === next.height ? current : next
    );
  }, []);

  useEffect(() => {
    syncScrollState();
  }, [mode, props.session?.id, syncScrollState]);

  useEffect(() => {
    window.addEventListener("resize", syncScrollState);
    return () => window.removeEventListener("resize", syncScrollState);
  }, [syncScrollState]);

  return (
    <aside className="reader-sidebar" aria-label="Document navigation">
      <div className="sidebar-modes" role="tablist" aria-label="Sidebar modes">
        {(["contents", "thumbnails", "bookmarks", "search"] as SidebarMode[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={mode === item}
            className={mode === item ? "active" : ""}
            onClick={() => props.onModeChange(item)}
          >
            {modeLabel(item)}
          </button>
        ))}
      </div>
      <div ref={contentRef} className="sidebar-content" onScroll={syncScrollState}>
        <SidebarRows
          session={props.session}
          mode={mode}
          onJump={props.onJump}
          scrollTop={scrollState.top}
          viewportHeight={scrollState.height}
        />
      </div>
    </aside>
  );
}

function visibleRowRange(
  total: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscanRows: number
): { start: number; end: number } {
  if (total <= 0) {
    return { start: 0, end: 0 };
  }

  const windowSize = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2;
  const maxStart = Math.max(0, total - windowSize);
  const start = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows),
    maxStart
  );

  return {
    start,
    end: Math.min(total, start + windowSize)
  };
}

function SidebarRows(props: {
  session?: DocumentSession;
  mode: SidebarMode;
  onJump: (location: ReaderLocation) => void;
  scrollTop: number;
  viewportHeight: number;
}) {
  const session = props.session;
  const [collapsedOutlineIds, setCollapsedOutlineIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setCollapsedOutlineIds(new Set());
  }, [session?.id]);

  useEffect(() => {
    setCollapsedOutlineIds((current) => {
      if (current.size === 0 || !session?.outline.length) {
        return current.size === 0 ? current : new Set();
      }

      const validIds = new Set(session.outline.map((item) => item.id));
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [session?.outline]);

  const outlineRows = useMemo(
    () => session?.status === "ready" ? visibleOutlineRows(session.outline, collapsedOutlineIds) : [],
    [collapsedOutlineIds, session?.outline, session?.status]
  );
  const toggleOutlineRow = useCallback((id: string) => {
    setCollapsedOutlineIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (!session || session.status !== "ready") {
    return <p className="empty-note">Open a PDF or EPUB to show navigation.</p>;
  }

  if (props.mode === "contents") {
    if (session.outline.length === 0) {
      return <p className="empty-note">No outline in this document.</p>;
    }

    const viewportHeight = props.viewportHeight || OUTLINE_FALLBACK_VIEWPORT_HEIGHT;
    const windowSize = Math.ceil(viewportHeight / OUTLINE_ROW_HEIGHT) + OUTLINE_OVERSCAN_ROWS * 2;
    const maxStart = Math.max(0, outlineRows.length - windowSize);
    const startIndex = Math.min(
      Math.max(0, Math.floor(props.scrollTop / OUTLINE_ROW_HEIGHT) - OUTLINE_OVERSCAN_ROWS),
      maxStart
    );
    const endIndex = Math.min(outlineRows.length, startIndex + windowSize);
    const visibleRows = outlineRows.slice(startIndex, endIndex);

    return (
      <div
        style={{
          ...outlineWindowStyle,
          height: `${outlineRows.length * OUTLINE_ROW_HEIGHT}px`
        }}
      >
        {visibleRows.map((row, offset) => {
          const index = startIndex + offset;

          return (
            <OutlineSidebarRow
              key={row.item.id}
              row={row}
              index={index}
              collapsed={collapsedOutlineIds.has(row.item.id)}
              active={isSameReaderLocation(row.item.location, session.location)}
              onToggle={toggleOutlineRow}
              onJump={props.onJump}
            />
          );
        })}
      </div>
    );
  }

  if (props.mode === "thumbnails") {
    if (session.format !== "pdf") {
      return <p className="empty-note">Thumbnails are available for PDFs.</p>;
    }

    return (
      <PdfThumbnailList
        session={session}
        onJump={props.onJump}
        scrollTop={props.scrollTop}
        viewportHeight={props.viewportHeight}
      />
    );
  }

  if (props.mode === "bookmarks") {
    if (session.bookmarks.length === 0) {
      return <p className="empty-note">No bookmarks in this document.</p>;
    }

    return session.bookmarks.map((bookmark) => (
      <button
        key={bookmark.id}
        className="sidebar-row"
        type="button"
        onClick={() => props.onJump(bookmark.location)}
      >
        {bookmark.title}
      </button>
    ));
  }

  if (session.searchResults.length === 0) {
    return <p className="empty-note">Search results appear here.</p>;
  }

  const range = visibleRowRange(
    session.searchResults.length,
    SEARCH_RESULT_ROW_HEIGHT,
    props.scrollTop,
    props.viewportHeight || SEARCH_RESULT_FALLBACK_VIEWPORT_HEIGHT,
    SEARCH_RESULT_OVERSCAN_ROWS
  );
  const visibleResults = session.searchResults.slice(range.start, range.end);

  return (
    <div
      style={{
        ...outlineWindowStyle,
        height: `${session.searchResults.length * SEARCH_RESULT_ROW_HEIGHT}px`
      }}
    >
      {visibleResults.map((result, offset) => {
        const index = range.start + offset;

        return (
          <button
            key={result.id}
            className="search-result-row"
            type="button"
            aria-label={`${result.label}, result ${index + 1}: ${result.snippet}`}
            onClick={() => props.onJump(result.location)}
            style={{
              position: "absolute",
              top: `${index * SEARCH_RESULT_ROW_HEIGHT}px`,
              left: 0,
              right: 0,
              height: `${SEARCH_RESULT_ROW_HEIGHT}px`,
              boxSizing: "border-box"
            }}
          >
            <strong>{result.label}</strong>
            <span>{result.snippet}</span>
          </button>
        );
      })}
    </div>
  );
}

const OutlineSidebarRow = memo(function OutlineSidebarRow(props: {
  row: OutlineRow;
  index: number;
  collapsed: boolean;
  active: boolean;
  onToggle: (id: string) => void;
  onJump: (location: ReaderLocation) => void;
}) {
  const { item, level, hasChildren } = props.row;

  return (
    <div
      className={`sidebar-row ${props.active ? "active" : ""}`}
      style={{
        position: "absolute",
        top: `${props.index * OUTLINE_ROW_HEIGHT}px`,
        left: 0,
        right: 0,
        height: `${OUTLINE_ROW_HEIGHT}px`,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "18px minmax(0, 1fr)",
        alignItems: "center",
        gap: "4px",
        paddingLeft: `${12 + level * 14}px`
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${item.title}`}
          aria-expanded={!props.collapsed}
          onClick={() => props.onToggle(item.id)}
          style={outlineToggleStyle}
        >
          {props.collapsed ? "›" : "⌄"}
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={() => props.onJump(item.location)}
        style={outlineTitleStyle}
      >
        {item.title}
      </button>
    </div>
  );
});

function PdfThumbnailList(props: {
  session: DocumentSession;
  onJump: (location: ReaderLocation) => void;
  scrollTop: number;
  viewportHeight: number;
}) {
  const pageCount = props.session.pageCount ?? 0;
  const path = props.session.fileSource.kind === "desktop-path" ? props.session.fileSource.path : undefined;
  const range = visibleRowRange(
    pageCount,
    THUMBNAIL_ROW_HEIGHT,
    props.scrollTop,
    props.viewportHeight || THUMBNAIL_FALLBACK_VIEWPORT_HEIGHT,
    THUMBNAIL_OVERSCAN_ROWS
  );
  const activePage = props.session.location.kind === "page" ? props.session.location.page : undefined;

  if (pageCount === 0) {
    return <p className="empty-note">PDF thumbnails appear after page metadata loads.</p>;
  }

  const visiblePages = Array.from({ length: range.end - range.start }, (_, index) => range.start + index + 1);
  if (activePage && activePage >= 1 && activePage <= pageCount && !visiblePages.includes(activePage)) {
    visiblePages.push(activePage);
    visiblePages.sort((first, second) => first - second);
  }

  return (
    <div
      style={{
        ...outlineWindowStyle,
        height: `${pageCount * THUMBNAIL_ROW_HEIGHT}px`
      }}
    >
      {visiblePages.map((page) => (
        <PdfThumbnailRow
          key={`${props.session.id}-${page}`}
          path={path}
          page={page}
          active={activePage === page}
          onJump={props.onJump}
        />
      ))}
    </div>
  );
}

function PdfThumbnailRow(props: {
  path?: string;
  page: number;
  active: boolean;
  onJump: (location: ReaderLocation) => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    if (!props.path) {
      return;
    }

    setDataUrl("");
    setFailed(false);
    renderPdfPageImage(props.path, props.page, THUMBNAIL_SCALE)
      .then((image) => {
        if (!disposed) {
          setDataUrl(image.dataUrl);
        }
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, [props.page, props.path]);

  return (
    <button
      className={`thumbnail-row ${props.active ? "active" : ""}`}
      type="button"
      aria-label={`Page ${props.page}`}
      onClick={() => props.onJump({ kind: "page", page: props.page })}
      style={{
        position: "absolute",
        top: `${(props.page - 1) * THUMBNAIL_ROW_HEIGHT}px`,
        left: 0,
        right: 0,
        height: `${THUMBNAIL_ROW_HEIGHT}px`,
        boxSizing: "border-box"
      }}
    >
      <span className="thumbnail-box">
        {dataUrl ? <img src={dataUrl} alt={`Thumbnail page ${props.page}`} /> : failed ? "!" : props.page}
      </span>
      <span>Page {props.page}</span>
      {failed ? <small>Preview failed</small> : null}
    </button>
  );
}

function ReaderViewport(props: {
  session?: DocumentSession;
  recentFiles: RecentFile[];
  preferences: Preferences;
  documentCache: Map<string, LoadedReaderDocument>;
  scrollRevision: number;
  onOpen: () => void;
  onOpenRecent: (recent: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
  onLocationChange: (location: ReaderLocation) => void;
  onNavigate: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onPageCountChange: (pageCount: number) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>, wasmDocuments?: SearchWorkerDocument[]) => void;
  searchQuery: string;
  searchSelection?: SearchSelection;
  onPinchZoom: (event: React.WheelEvent<HTMLElement>) => void;
}) {
  const session = props.session;

  if (!session || session.status === "empty") {
    return (
      <EmptyState
        recentFiles={props.recentFiles}
        onOpen={props.onOpen}
        onOpenRecent={props.onOpenRecent}
        onClearRecent={props.onClearRecent}
      />
    );
  }

  if (session.status === "error") {
    return <ErrorState session={session} onOpen={props.onOpen} onRemoveRecent={props.onRemoveRecent} />;
  }

  return (
    <section
      className="reader-viewport"
      tabIndex={0}
      aria-label={`${session.title} reader`}
      onWheel={props.onPinchZoom}
    >
      {session.format === "pdf" ? (
        <PdfReader
          session={session}
          preferences={props.preferences}
          documentCache={props.documentCache}
          scrollRevision={props.scrollRevision}
          onLocationChange={props.onLocationChange}
          onOutlineChange={props.onOutlineChange}
          onPageCountChange={props.onPageCountChange}
          onSearchReady={props.onSearchReady}
          searchSelection={props.searchSelection}
        />
      ) : (
        <EpubReader
          session={session}
          preferences={props.preferences}
          documentCache={props.documentCache}
          onLocationChange={props.onLocationChange}
          onNavigate={props.onNavigate}
          onOutlineChange={props.onOutlineChange}
          onSearchReady={props.onSearchReady}
          searchQuery={props.searchQuery}
          searchSelection={props.searchSelection}
        />
      )}
    </section>
  );
}

function EmptyState(props: {
  recentFiles: RecentFile[];
  onOpen: () => void;
  onOpenRecent: (recent: RecentFile) => void;
  onClearRecent: () => void;
}) {
  return (
    <section className="empty-state">
      <div className="empty-panel">
        <div className="empty-mark">
          <Icon name="open" />
        </div>
        <h1>SmartReader</h1>
        <p>Open a local PDF or EPUB.</p>
        <p className="empty-hint">Drop a document here, use ⌘O, or reopen a recent file below.</p>
        <button className="primary-button" type="button" onClick={props.onOpen}>
          Open File
        </button>
      </div>
      <div className="recent-panel">
        <div className="recent-header">
          <h2>Recent</h2>
          <button type="button" onClick={props.onClearRecent} disabled={props.recentFiles.length === 0}>
            Clear
          </button>
        </div>
        {props.recentFiles.length === 0 ? (
          <p className="empty-note">Recent files appear after you open a document.</p>
        ) : (
          props.recentFiles.map((file) => (
            <button key={file.id} className="recent-row" type="button" onClick={() => props.onOpenRecent(file)}>
              <span className={`recent-format ${file.format}`}>{file.format.toUpperCase()}</span>
              <span className="recent-copy">
                <span className="recent-title">{file.title}</span>
                <span className="recent-meta">{file.parentPath}</span>
              </span>
              <span className="recent-progress">{file.resumeLabel}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function ErrorState(props: {
  session: DocumentSession;
  onOpen: () => void;
  onRemoveRecent: (path: string) => void;
}) {
  const canRemoveRecent =
    props.session.error?.kind === "access-denied" || props.session.error?.kind === "missing-file";

  return (
    <section className="error-state">
      <div className="error-panel">
        <div className="error-mark">
          <Icon name="warning" />
        </div>
        <h1>{props.session.error?.title ?? "Unable to open document"}</h1>
        <p>{props.session.error?.message ?? "The renderer could not load this file."}</p>
        <div className="error-actions">
          <button className="primary-button" type="button" onClick={props.onOpen}>
            Choose File
          </button>
          {canRemoveRecent && props.session.filePath ? (
            <button type="button" onClick={() => props.onRemoveRecent(props.session.filePath ?? "")}>
              Remove from Recent
            </button>
          ) : (
            <button type="button" disabled>
              Reveal in Finder
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function PdfReader(props: {
  session: DocumentSession;
  preferences: Preferences;
  documentCache: Map<string, LoadedReaderDocument>;
  scrollRevision: number;
  onLocationChange: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onPageCountChange: (pageCount: number) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>, wasmDocuments?: SearchWorkerDocument[]) => void;
  searchSelection?: SearchSelection;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastScrollRevisionRef = useRef<number | undefined>(undefined);
  const [pdf, setPdf] = useState<PDFDocumentProxy | undefined>(
    () => props.documentCache.get(props.session.id)?.pdf
  );
  const [error, setError] = useState("");
  const [pdfKitNotice, setPdfKitNotice] = useState("");
  const pdfKitPath =
    props.preferences.pdfKit.enabled && props.session.fileSource.kind === "desktop-path"
      ? props.session.fileSource.path
      : undefined;

  useEffect(() => {
    setPdfKitNotice("");
  }, [pdfKitPath]);

  useEffect(() => {
    let disposed = false;
    const cachedDocument = props.documentCache.get(props.session.id);
    const cached = cachedDocument?.pdf;

    async function loadPdf() {
      setError("");
      const metadataPromise = loadPdfMetadata(props.session, props.documentCache);

      if (cached) {
        setPdf(cached);
        metadataPromise.then((metadata) => {
          if (disposed) {
            return;
          }
          props.onPageCountChange(metadata.pageCount);
          props.onOutlineChange(metadata.outline);
          props.onSearchReady(createPdfSearchHandler(props.session.fileSource, cached));
        }).catch(() => {
          if (disposed) {
            return;
          }
          props.onPageCountChange(cached.numPages);
          props.onSearchReady((query) => searchPdf(cached, query));
        });
        return;
      }

      setPdf(undefined);

      try {
        if (props.session.fileSource.kind === "empty") {
          throw new Error("Missing file source");
        }
        const data = await readFileSource(props.session.fileSource);
        const pdfjs = await loadPdfJs();
        const loaded = await pdfjs.getDocument({ data }).promise;

        if (disposed) {
          loaded.destroy();
          return;
        }

        props.documentCache.set(props.session.id, {
          ...props.documentCache.get(props.session.id),
          pdf: loaded
        });
        setPdf(loaded);
        const metadata = await metadataPromise.catch(async () => ({
          id: props.session.filePath ?? props.session.id,
          pageCount: loaded.numPages,
          outline: await outlineFromPdf(loaded)
        }));
        if (disposed) {
          loaded.destroy();
          return;
        }
        props.onPageCountChange(metadata.pageCount);
        props.onOutlineChange(metadata.outline);
        props.onSearchReady(createPdfSearchHandler(props.session.fileSource, loaded));
      } catch {
        setError("This PDF could not be rendered.");
      }
    }

    loadPdf();
    return () => {
      disposed = true;
    };
  }, [props.documentCache, props.onSearchReady, props.session.id]);

  useEffect(() => {
    if (!pdf || props.session.fitMode === "single" || props.session.location.kind !== "page") {
      return;
    }

    if (lastScrollRevisionRef.current === props.scrollRevision) {
      return;
    }

    lastScrollRevisionRef.current = props.scrollRevision;
    window.requestAnimationFrame(() => {
      const pageFrame = canvasRef.current?.querySelector<HTMLElement>(
        `[data-page-number="${props.session.location.kind === "page" ? props.session.location.page : 1}"]`
      );
      pageFrame?.scrollIntoView?.({ block: "start" });
    });
  }, [pdf, props.scrollRevision, props.session.fitMode, props.session.id, props.session.location]);

  const handleVisiblePage = useCallback((pageNumber: number) => {
    if (props.session.location.kind === "page" && props.session.location.page === pageNumber) {
      return;
    }

    props.onLocationChange({ kind: "page", page: pageNumber });
  }, [props.onLocationChange, props.session.location]);

  if (error) {
    return <InlineReaderError message={error} />;
  }

  if (!pdf) {
    return <ReaderLoading title={props.session.title} detail="Preparing PDF pages" />;
  }

  const pageNumbers =
    props.session.fitMode === "single" && props.session.location.kind === "page"
      ? [props.session.location.page]
      : Array.from({ length: pdf.numPages }, (_, index) => index + 1);
  const currentPage = props.session.location.kind === "page" ? props.session.location.page : 1;
  const searchMatchedPages = new Set(
    props.session.searchResults
      .map((result) => result.location)
      .filter((location): location is Extract<ReaderLocation, { kind: "page" }> => location.kind === "page")
      .map((location) => location.page)
  );
  const currentSearchPage =
    props.searchSelection && props.searchSelection.currentIndex >= 0
      ? props.session.searchResults[props.searchSelection.currentIndex]?.location
      : undefined;

  return (
    <div ref={canvasRef} className="pdf-canvas">
      {pdfKitNotice ? <InlineReaderNotice message={pdfKitNotice} /> : null}
      {pageNumbers.map((pageNumber) => (
        <PdfPage
          key={`${props.session.id}-${pageNumber}`}
          pdf={pdf}
          pageNumber={pageNumber}
          zoom={zoomForFitMode(props.session.fitMode, props.session.zoom)}
          pdfKitPath={pdfKitPath}
          renderImmediately={props.session.fitMode === "single" || Math.abs(pageNumber - currentPage) <= 1}
          searchMatch={
            currentSearchPage?.kind === "page" && currentSearchPage.page === pageNumber
              ? "current"
              : searchMatchedPages.has(pageNumber)
                ? "match"
                : undefined
          }
          onVisiblePage={handleVisiblePage}
          onPdfKitFallback={() => setPdfKitNotice("PDFKit unavailable; using PDF.js.")}
        />
      ))}
    </div>
  );
}

function PdfPage(props: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  pdfKitPath?: string;
  renderImmediately: boolean;
  searchMatch?: "match" | "current";
  onVisiblePage: (pageNumber: number) => void;
  onPdfKitFallback?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [shouldRender, setShouldRender] = useState(props.renderImmediately);

  useEffect(() => {
    if (props.renderImmediately || shouldRender) {
      setShouldRender(true);
      return;
    }

    const element = pageRef.current;

    if (!element || !window.IntersectionObserver) {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "900px 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [props.renderImmediately, shouldRender]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: PdfRenderTask | undefined;

    async function renderPage() {
      if (!shouldRender) {
        return;
      }

      setLoading(true);
      setError("");
      setImageDataUrl("");
      try {
        if (props.pdfKitPath) {
          try {
            const image = await renderPdfPageImage(props.pdfKitPath, props.pageNumber, props.zoom);
            if (cancelled) {
              return;
            }
            setImageDataUrl(image.dataUrl);
            setLoading(false);
            return;
          } catch {
            props.onPdfKitFallback?.();
          }
        }

        const page = await props.pdf.getPage(props.pageNumber);
        if (cancelled) {
          return;
        }
        renderTask = renderPdfPage(page, canvasRef.current, props.zoom);
        if (!renderTask) {
          if (!cancelled) {
            setLoading(false);
          }
          return;
        }
        await renderTask.promise;
        if (cancelled) {
          return;
        }
        setLoading(false);
      } catch (renderError) {
        if (cancelled || isPdfRenderCancelled(renderError)) {
          return;
        }

        setError("Page render failed.");
        setLoading(false);
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // PDF.js render cancellation can throw if the task has already finished.
      }
    };
  }, [props.pageNumber, props.pdf, props.pdfKitPath, props.zoom, shouldRender]);

  useEffect(() => {
    const element = pageRef.current;

    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.45) {
          props.onVisiblePage(props.pageNumber);
        }
      },
      { threshold: [0.45] }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [props.onVisiblePage, props.pageNumber]);

  return (
    <article
      ref={pageRef}
      className={`pdf-page-frame ${props.searchMatch ? `search-${props.searchMatch}` : ""}`}
      data-page-number={props.pageNumber}
      data-search-match={props.searchMatch}
      aria-label={`Page ${props.pageNumber}`}
    >
      {loading || !shouldRender ? <div className="page-skeleton" /> : null}
      {error ? (
        <div className="page-error">
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      ) : null}
      {imageDataUrl ? (
        <img className="pdf-page-image" src={imageDataUrl} alt={`Page ${props.pageNumber}`} />
      ) : (
        <canvas ref={canvasRef} />
      )}
      <span className="page-number">{props.pageNumber}</span>
    </article>
  );
}

function EpubReader(props: {
  session: DocumentSession;
  preferences: Preferences;
  documentCache: Map<string, LoadedReaderDocument>;
  onLocationChange: (location: ReaderLocation) => void;
  onNavigate: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>, wasmDocuments?: SearchWorkerDocument[]) => void;
  searchQuery: string;
  searchSelection?: SearchSelection;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const metadataRequestRef = useRef(0);
  const chapterRequestRef = useRef(0);
  const pendingLocalChapterHrefRef = useRef<string | undefined>(undefined);
  const cachedEpub = props.documentCache.get(props.session.id)?.epub;
  const cachedMetadata = cachedEpub?.metadata;
  const [error, setError] = useState("");
  const [readerError, setReaderError] = useState<ReaderError | undefined>();
  const [metadata, setMetadata] = useState<EpubDocumentMetadata | undefined>(() => cachedMetadata);
  const [activeChapterIndex, setActiveChapterIndex] = useState(() =>
    chapterIndexForLocation(cachedMetadata?.chapters ?? [], props.session.location)
  );
  const [activeChapter, setActiveChapter] = useState<EpubChapter | undefined>(() => {
    const chapter = cachedMetadata?.chapters[activeChapterIndex];
    return chapter ? cachedEpub?.chapters.get(chapter.href) : undefined;
  });
  const selectChapterIndex = useCallback((index: number) => {
    const chapter = metadata?.chapters[index];
    if (chapter) {
      const currentChapter = metadata?.chapters[activeChapterIndex];
      if (currentChapter) {
        props.onLocationChange(locationForChapter(currentChapter, metadata.chapters, currentScrollTop(containerRef.current)));
      }
      pendingLocalChapterHrefRef.current = chapter.href;
    }

    setActiveChapterIndex(index);
  }, [activeChapterIndex, metadata, props.onLocationChange]);

  useEffect(() => {
    let disposed = false;
    const requestId = ++metadataRequestRef.current;
    pendingLocalChapterHrefRef.current = undefined;

    async function loadEpub() {
      setError("");
      setReaderError(undefined);
      setActiveChapter(undefined);

      const cached = props.documentCache.get(props.session.id)?.epub;
      if (cached?.metadata) {
        const activeIndex = chapterIndexForLocation(cached.metadata.chapters, props.session.location);
        setMetadata(cached.metadata);
        setActiveChapterIndex(activeIndex);
        setActiveChapter(cached.chapters.get(cached.metadata.chapters[activeIndex]?.href ?? ""));
        props.onOutlineChange(cached.metadata.outline);
        props.onSearchReady(
          createEpubSearchHandler(props.session.fileSource, cached),
          epubSearchWorkerDocuments(props.session.fileSource, cached)
        );
        return;
      }

      if (props.session.fileSource.kind === "empty") {
        setError("This EPUB could not be rendered.");
        return;
      }

      try {
        const loaded = props.session.fileSource.kind === "desktop-path"
          ? await loadDesktopEpubMetadata(props.session.fileSource.path)
          : await loadBrowserEpubMetadata(props.session.fileSource);

        if (disposed || requestId !== metadataRequestRef.current) {
          return;
        }

        const activeIndex = chapterIndexForLocation(loaded.metadata.chapters, props.session.location);
        props.documentCache.set(props.session.id, {
          ...props.documentCache.get(props.session.id),
          epub: loaded
        });
        setMetadata(loaded.metadata);
        setActiveChapterIndex(activeIndex);
        setActiveChapter(loaded.chapters.get(loaded.metadata.chapters[activeIndex]?.href ?? ""));
        props.onOutlineChange(loaded.metadata.outline);
        props.onSearchReady(
          createEpubSearchHandler(props.session.fileSource, loaded),
          epubSearchWorkerDocuments(props.session.fileSource, loaded)
        );
      } catch (loadError) {
        if (!disposed && requestId === metadataRequestRef.current) {
          setReaderError(readerErrorFromEpubError(loadError));
        }
      }
    }

    loadEpub();
    return () => {
      disposed = true;
      metadataRequestRef.current += 1;
    };
  }, [props.documentCache, props.onSearchReady, props.session.id]);

  useEffect(() => {
    if (props.session.location.kind !== "epub" || !props.session.location.chapterHref) {
      return;
    }

    const chapterHref = props.session.location.chapterHref;
    const pendingLocalChapterHref = pendingLocalChapterHrefRef.current;
    if (pendingLocalChapterHref) {
      if (chapterHref === pendingLocalChapterHref) {
        pendingLocalChapterHrefRef.current = undefined;
      }

      return;
    }

    const index = metadata?.chapters.findIndex((chapter) => chapter.href === chapterHref) ?? -1;
    if (index >= 0) {
      setActiveChapterIndex(index);
      containerRef.current?.scrollTo?.({ top: props.session.location.scrollTop ?? 0 });
    }
  }, [metadata, props.session.location]);

  useEffect(() => {
    const chapter = metadata?.chapters[activeChapterIndex];

    if (!chapter) {
      return;
    }

    const location = locationForChapter(chapter, metadata.chapters, props.session.location.kind === "epub" ? props.session.location.scrollTop : undefined);
    if (pendingLocalChapterHrefRef.current === chapter.href) {
      props.onNavigate(location);
    } else {
      props.onLocationChange(location);
    }
  }, [activeChapterIndex, metadata]);

  useEffect(() => {
    containerRef.current = surfaceRef.current?.closest(".reader-viewport") as HTMLElement | null;
  });

  useEffect(() => {
    const container = surfaceRef.current?.closest(".reader-viewport") as HTMLElement | null;
    const chapter = metadata?.chapters[activeChapterIndex];
    if (!container || !chapter) {
      return;
    }

    container.scrollTo?.({ top: props.session.location.kind === "epub" ? props.session.location.scrollTop ?? 0 : 0 });

    let pendingLocation: ReaderLocation | undefined;
    let saveTimer: number | undefined;
    const flushPendingLocation = () => {
      if (saveTimer !== undefined) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
      }

      if (!pendingLocation) {
        return;
      }

      const location = pendingLocation;
      pendingLocation = undefined;
      props.onLocationChange(location);
    };
    const onScroll = () => {
      pendingLocation = locationForChapter(chapter, metadata.chapters, currentScrollTop(container));
      if (saveTimer !== undefined) {
        window.clearTimeout(saveTimer);
      }
      saveTimer = window.setTimeout(flushPendingLocation, EPUB_SCROLL_SAVE_DELAY_MS);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      flushPendingLocation();
    };
  }, [activeChapter?.href, activeChapterIndex, metadata, props.onLocationChange, props.session.id]);

  useEffect(() => {
    let disposed = false;
    const requestId = ++chapterRequestRef.current;
    const chapter = metadata?.chapters[activeChapterIndex];

    if (!chapter || props.session.fileSource.kind !== "desktop-path") {
      if (chapter) {
        setActiveChapter(props.documentCache.get(props.session.id)?.epub?.chapters.get(chapter.href));
      }
      return () => {
        disposed = true;
        chapterRequestRef.current += 1;
      };
    }

    const cached = props.documentCache.get(props.session.id)?.epub?.chapters.get(chapter.href);
    if (cached) {
      setActiveChapter(cached);
      return () => {
        disposed = true;
        chapterRequestRef.current += 1;
      };
    }

    setActiveChapter(undefined);
    readEpubChapter(props.session.fileSource.path, chapter.href)
      .then((loaded) => {
        if (disposed || requestId !== chapterRequestRef.current) {
          return;
        }

        const epub = props.documentCache.get(props.session.id)?.epub;
        if (!epub) {
          return;
        }

        const nextChapter = desktopChapterToEpubChapter(loaded);
        epub.chapters.set(nextChapter.href, nextChapter);
        setActiveChapter(nextChapter);
        props.onSearchReady(
          createEpubSearchHandler(props.session.fileSource, epub),
          epubSearchWorkerDocuments(props.session.fileSource, epub)
        );
      })
      .catch((chapterError) => {
        if (!disposed && requestId === chapterRequestRef.current) {
          setReaderError(readerErrorFromEpubError(chapterError));
        }
      });

    return () => {
      disposed = true;
      chapterRequestRef.current += 1;
    };
  }, [activeChapterIndex, metadata, props.documentCache, props.onSearchReady, props.session.fileSource, props.session.id]);

  const trimmedSearchQuery = props.searchQuery.trim();
  const currentSearchResult =
    props.searchSelection && props.searchSelection.currentIndex >= 0
      ? props.session.searchResults[props.searchSelection.currentIndex]
      : undefined;
  const currentSearchChapterHref =
    currentSearchResult?.location.kind === "epub" ? currentSearchResult.location.chapterHref : undefined;
  const currentSearchMatchIndex = currentSearchResult?.matchIndex ?? 0;
  const highlightedHtml = useMemo(() => {
    if (!activeChapter) {
      return "";
    }

    if (!trimmedSearchQuery || currentSearchChapterHref !== activeChapter.href) {
      return activeChapter.html;
    }

    return highlightCurrentSearchMatch(activeChapter.html, trimmedSearchQuery, currentSearchMatchIndex);
  }, [activeChapter?.href, activeChapter?.html, currentSearchChapterHref, currentSearchMatchIndex, trimmedSearchQuery]);

  if (readerError) {
    return <InlineReaderError title={readerError.title} message={readerError.message} />;
  }

  if (error) {
    return <InlineReaderError message={error} />;
  }

  if (!metadata) {
    return <ReaderLoading title={props.session.title} detail="Preparing EPUB structure" />;
  }

  if (!activeChapter) {
    return (
      <ReaderLoading
        title={props.session.title}
        detail={`Opening ${metadata.chapters[activeChapterIndex]?.label ?? "chapter"}`}
      />
    );
  }

  const chapter = activeChapter;
  const chapterStatus = chapterProgressLabel(activeChapterIndex, metadata.chapters.length);
  const resourceCount = chapter.resources.length;
  const chapterPercent = readingProgressPercent({
    kind: "epub",
    chapterHref: chapter.href,
    chapterLabel: chapter.label,
    progress: metadata.chapters.length > 1 ? activeChapterIndex / (metadata.chapters.length - 1) : 0
  });

  return (
    <div
      ref={surfaceRef}
      className={`epub-surface theme-${props.session.epubSettings.theme}`}
      style={{ fontSize: props.session.epubSettings.fontSize || props.preferences.epubFontSize }}
    >
      <article className="epub-renderer">
        <header className="epub-chapter-bar">
          <button
            type="button"
            disabled={activeChapterIndex === 0}
            onClick={() => selectChapterIndex(Math.max(0, activeChapterIndex - 1))}
          >
            Previous
          </button>
          <span className="epub-chapter-title">
            <strong>{chapter.label}</strong>
            <small>{chapterStatus}</small>
            {resourceCount > 0 ? <small>{resourceCountLabel(resourceCount)}</small> : null}
          </span>
          <button
            type="button"
            disabled={activeChapterIndex === metadata.chapters.length - 1}
            onClick={() => selectChapterIndex(Math.min(metadata.chapters.length - 1, activeChapterIndex + 1))}
          >
            Next
          </button>
        </header>
        <div className="epub-progress-track" aria-label={chapterStatus}>
          <span style={{ width: `${chapterPercent}%` }} />
        </div>
        <div className="epub-content" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </article>
    </div>
  );
}

function ReaderLoading(props: { title: string; detail?: string }) {
  return (
    <div className="reader-loading">
      <span className="spinner" aria-hidden="true" />
      <span className="reader-loading-copy">
        <strong>Opening {props.title}</strong>
        {props.detail ? <small>{props.detail}</small> : null}
      </span>
    </div>
  );
}

function InlineReaderError(props: { title?: string; message: string }) {
  return (
    <div className="inline-reader-error">
      <Icon name="warning" />
      <span>
        {"title" in props && props.title ? <strong>{props.title}</strong> : null}
        {props.message}
      </span>
    </div>
  );
}

function InlineReaderNotice(props: { message: string }) {
  return (
    <div className="inline-reader-notice" role="status">
      <span>{props.message}</span>
    </div>
  );
}

interface EpubChapter {
  id: string;
  href: string;
  label: string;
  index: number;
  html: string;
  text: string;
  resources: EpubResourceMetadata[];
}

interface EpubDocumentMetadata {
  id: string;
  title?: string;
  chapters: EpubChapterMetadata[];
  outline: OutlineItem[];
  ncxHref?: string;
  resources: EpubResourceMetadata[];
}

interface PdfDocumentMetadata {
  id: string;
  pageCount: number;
  outline: OutlineItem[];
}

interface EpubChapterMetadata {
  id: string;
  href: string;
  label: string;
  index: number;
}

interface EpubDocumentCache {
  metadata: EpubDocumentMetadata;
  chapters: Map<string, EpubChapter>;
}

interface LoadedReaderDocument {
  pdf?: PDFDocumentProxy;
  pdfMetadata?: PdfDocumentMetadata;
  epub?: EpubDocumentCache;
}

function disposeSessionResources(session: DocumentSession | undefined, document?: LoadedReaderDocument) {
  disposeLoadedReaderDocument(document);

  const objectUrl = session?.objectUrl ?? (session?.fileSource.kind === "browser-file" ? session.fileSource.objectUrl : undefined);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
}

function applyPreferencesToSession(session: DocumentSession, preferences: Preferences): DocumentSession {
  return applyEpubPreferencesToSession(applyPdfPreferencesToSession(session, preferences), preferences);
}

function applyPdfPreferencesToSession(session: DocumentSession, preferences: Preferences): DocumentSession {
  if (session.format === "pdf" && session.fitMode !== preferences.defaultPdfFitMode) {
    return {
      ...session,
      fitMode: preferences.defaultPdfFitMode,
      zoom: preferences.defaultPdfFitMode === "actual-size" ? 1 : session.zoom
    };
  }

  return session;
}

function applyEpubPreferencesToSession(session: DocumentSession, preferences: Preferences): DocumentSession {
  if (
    session.format === "epub" &&
    (session.epubSettings.fontSize !== preferences.epubFontSize ||
      session.epubSettings.theme !== preferences.epubTheme)
  ) {
    return {
      ...session,
      epubSettings: {
        fontSize: preferences.epubFontSize,
        theme: preferences.epubTheme
      }
    };
  }

  return session;
}

function disposeLoadedReaderDocument(document?: LoadedReaderDocument) {
  if (document?.pdf) {
    void document.pdf.destroy();
  }

  document?.epub?.chapters.clear();
}

function chapterIndexForLocation(chapters: EpubChapterMetadata[], location: ReaderLocation): number {
  if (location.kind !== "epub" || !location.chapterHref) {
    return 0;
  }

  const index = chapters.findIndex((chapter) => chapter.href === location.chapterHref);
  return index >= 0 ? index : 0;
}

function locationForChapter(
  chapter: EpubChapterMetadata,
  chapters: EpubChapterMetadata[],
  scrollTop?: number
): ReaderLocation {
  return {
    kind: "epub",
    chapterHref: chapter.href,
    chapterLabel: chapter.label,
    progress: chapters.length > 1 ? chapter.index / (chapters.length - 1) : 0,
    scrollTop
  };
}

function currentScrollTop(container: HTMLElement | null): number | undefined {
  if (!container) {
    return undefined;
  }

  return Math.max(0, Math.round(container.scrollTop));
}

let pdfJsModule: Promise<typeof import("pdfjs-dist")> | undefined;

async function loadPdfMetadata(
  session: DocumentSession,
  documentCache: Map<string, LoadedReaderDocument>
): Promise<PdfDocumentMetadata> {
  const cached = documentCache.get(session.id)?.pdfMetadata;
  if (cached) {
    return cached;
  }

  if (session.fileSource.kind !== "desktop-path") {
    throw new Error("Browser-file PDF metadata is resolved through PDF.js");
  }

  const document = await openPdfDocument(session.fileSource.path);
  const metadata = desktopDocumentToPdfMetadata(session.fileSource.path, document);
  documentCache.set(session.id, {
    ...documentCache.get(session.id),
    pdfMetadata: metadata
  });

  return metadata;
}

function desktopDocumentToPdfMetadata(path: string, document: DesktopPdfDocument): PdfDocumentMetadata {
  return {
    id: document.id || path,
    pageCount: document.pageCount,
    outline: document.outline.map((item) => ({
      id: item.id,
      title: item.title,
      location: { kind: "page", page: item.page },
      level: item.level
    }))
  };
}

async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfJsModule) {
    pdfJsModule = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.mjs?url")
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }

  return pdfJsModule;
}

async function loadDesktopEpubMetadata(path: string): Promise<EpubDocumentCache> {
  const document = await openEpubDocument(path);
  const metadata = desktopDocumentToEpubMetadata(path, document);

  return {
    metadata,
    chapters: new Map()
  };
}

async function loadBrowserEpubMetadata(source: Extract<DocumentSession["fileSource"], { kind: "browser-file" }>): Promise<EpubDocumentCache> {
  const data = await readFileSource(source);
  const chapters = await parseEpub(data);
  const metadata = chaptersToEpubMetadata(source.file.name, chapters);

  return {
    metadata,
    chapters: new Map(chapters.map((chapter) => [chapter.href, chapter]))
  };
}

function desktopDocumentToEpubMetadata(path: string, document: DesktopEpubDocument): EpubDocumentMetadata {
  return {
    id: document.id || path,
    title: document.title,
    chapters: document.chapters,
    ncxHref: document.ncxHref,
    resources: safeEpubResources(document.resources),
    outline: document.outline.map((item) => {
      const chapter = typeof item.index === "number"
        ? document.chapters[item.index]
        : document.chapters.find((entry) => entry.href === item.href);

      return {
        id: item.id,
        title: item.title,
        location: {
          kind: "epub",
          chapterHref: item.href,
          chapterLabel: item.title,
          progress: chapter && document.chapters.length > 1 ? chapter.index / (document.chapters.length - 1) : 0
        },
        level: item.level
      };
    })
  };
}

function chaptersToEpubMetadata(id: string, chapters: EpubChapter[]): EpubDocumentMetadata {
  return {
    id,
    chapters,
    resources: [],
    outline: chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.label,
      location: {
        kind: "epub",
        chapterHref: chapter.href,
        chapterLabel: chapter.label,
        progress: chapters.length > 1 ? chapter.index / (chapters.length - 1) : 0
      },
      level: 0
    }))
  };
}

function desktopChapterToEpubChapter(chapter: Awaited<ReturnType<typeof readEpubChapter>>): EpubChapter {
  return {
    id: chapter.id,
    href: chapter.href,
    label: chapter.label,
    index: chapter.index,
    html: chapter.sanitizedHtml,
    text: chapter.text,
    resources: safeEpubResources(chapter.resources)
  };
}

function epubSearchWorkerDocuments(
  source: DocumentSession["fileSource"],
  epub: EpubDocumentCache
): SearchWorkerDocument[] {
  if (source.kind !== "browser-file") {
    return [];
  }

  return Array.from(epub.chapters.values())
    .filter((chapter) => chapter.text.trim())
    .map((chapter) => ({
      id: chapter.id,
      label: chapter.label,
      text: chapter.text,
      location: {
        kind: "epub",
        chapterHref: chapter.href,
        chapterLabel: chapter.label,
        progress: epub.metadata.chapters.length > 1
          ? chapter.index / (epub.metadata.chapters.length - 1)
          : 0
      }
    }));
}

function createEpubSearchHandler(
  source: DocumentSession["fileSource"],
  epub: EpubDocumentCache
): (query: string) => Promise<SearchResult[]> {
  if (source.kind === "desktop-path") {
    return (query) => searchDesktopEpub(source.path, query);
  }

  if (source.kind === "browser-file") {
    return (query) => searchEpub(Array.from(epub.chapters.values()), query);
  }

  return async () => [];
}

function createPdfSearchHandler(
  source: DocumentSession["fileSource"],
  pdf: PDFDocumentProxy
): (query: string) => Promise<SearchResult[]> {
  if (source.kind === "desktop-path") {
    return (query) => searchDesktopPdf(source.path, query);
  }

  return (query) => searchPdf(pdf, query);
}

async function searchDesktopPdf(path: string, query: string): Promise<SearchResult[]> {
  const results = await searchPdfDocument(path, query);

  return results.map((result) => ({
    id: result.id,
    label: result.label,
    snippet: result.snippet,
    location: { kind: "page", page: result.page }
  }));
}

async function searchDesktopEpub(path: string, query: string): Promise<SearchResult[]> {
  const results = await searchEpubDocument(path, query);
  const chapterMatchCounts = new Map<string, number>();

  return results.map((result) => {
    const matchIndex = chapterMatchCounts.get(result.href) ?? 0;
    chapterMatchCounts.set(result.href, matchIndex + 1);

    return {
      id: result.id,
      label: result.label,
      snippet: result.snippet,
      location: {
        kind: "epub",
        chapterHref: result.href,
        chapterLabel: result.label,
        progress: result.progress
      },
      matchIndex
    };
  });
}

async function parseEpub(data: ArrayBuffer): Promise<EpubChapter[]> {
  const zip = await JSZip.loadAsync(data);
  const containerText = await zip.file("META-INF/container.xml")?.async("text");

  if (!containerText) {
    throw new Error("Missing EPUB container");
  }

  const parser = new DOMParser();
  const container = parser.parseFromString(containerText, "application/xml");
  const packagePath = container.querySelector("rootfile")?.getAttribute("full-path");

  if (!packagePath) {
    throw new Error("Missing EPUB package path");
  }

  const packageText = await zip.file(packagePath)?.async("text");
  if (!packageText) {
    throw new Error("Missing EPUB package");
  }

  const packageDoc = parser.parseFromString(packageText, "application/xml");
  const basePath = packagePath.includes("/") ? packagePath.slice(0, packagePath.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, { href: string; label?: string }>();

  packageDoc.querySelectorAll("manifest item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");

    if (id && href) {
      manifest.set(id, { href: resolveEpubPath(basePath, href) });
    }
  });

  const navLabels = await readEpubNavLabels(zip, packageDoc, basePath);
  const chapters: EpubChapter[] = [];

  packageDoc.querySelectorAll("spine itemref").forEach((item, index) => {
    const idref = item.getAttribute("idref");
    const manifestItem = idref ? manifest.get(idref) : undefined;

    if (!manifestItem) {
      return;
    }

    chapters.push({
      id: idref ?? `chapter-${index}`,
      href: manifestItem.href,
      label: navLabels.get(manifestItem.href) ?? `Chapter ${index + 1}`,
      index,
      html: "",
      text: "",
      resources: []
    });
  });

  const loadedChapters = await Promise.all(
    chapters.map(async (chapter) => {
      const raw = await zip.file(chapter.href)?.async("text");

      if (!raw) {
        return chapter;
      }

      const htmlDoc = parser.parseFromString(raw, "text/html");
      const body = htmlDoc.body;
      return {
        ...chapter,
        html: sanitizeEpubHtml(body?.innerHTML || `<p>${escapeHtml(raw)}</p>`),
        text: body?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        resources: []
      };
    })
  );

  return loadedChapters.length > 0 ? loadedChapters : [];
}

async function readEpubNavLabels(
  zip: JSZip,
  packageDoc: Document,
  basePath: string
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const navItem = Array.from(packageDoc.querySelectorAll("manifest item")).find(
    (item) => item.getAttribute("properties")?.includes("nav")
  );
  const href = navItem?.getAttribute("href");

  if (!href) {
    return labels;
  }

  const navPath = resolveEpubPath(basePath, href);
  const navText = await zip.file(navPath)?.async("text");
  if (!navText) {
    return labels;
  }

  const navDoc = new DOMParser().parseFromString(navText, "text/html");
  navDoc.querySelectorAll("nav a").forEach((anchor) => {
    const target = anchor.getAttribute("href")?.split("#")[0];
    const text = anchor.textContent?.replace(/\s+/g, " ").trim();

    if (target && text) {
      labels.set(resolveEpubPath(basePath, target), text);
    }
  });

  return labels;
}

function resolveEpubPath(basePath: string, href: string): string {
  const parts = `${basePath}${href}`.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      resolved.pop();
      continue;
    }

    resolved.push(part);
  }

  return resolved.join("/");
}

async function searchEpub(chapters: EpubChapter[], query: string): Promise<SearchResult[]> {
  return searchEpubChapters(chapters, query);
}

function safeEpubResources(resources: EpubResourceMetadata[] | undefined): EpubResourceMetadata[] {
  return (resources ?? []).filter((resource) => {
    const href = resource.href.trim().toLowerCase();
    const rewrittenUrl = resource.rewrittenUrl?.trim();

    if (!href || href.startsWith("http:") || href.startsWith("https:") || href.startsWith("javascript:")) {
      return false;
    }

    return !rewrittenUrl || isSafeRewrittenResourceUrl(rewrittenUrl);
  }).map((resource) => ({
    id: resource.id,
    href: resource.href,
    mediaType: resource.mediaType,
    rewrittenUrl: resource.rewrittenUrl
  }));
}

function isSafeRewrittenResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "asset:" || url.protocol === "blob:";
  } catch {
    return false;
  }
}

function readerErrorFromEpubError(error: unknown): ReaderError {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("encrypted") || lowerMessage.includes("drm")) {
    return {
      kind: "encrypted-document",
      title: "Encrypted EPUB",
      message: "SmartReader cannot open DRM-protected EPUB files."
    };
  }

  return {
    kind: "renderer-failed",
    title: "Unable to open EPUB",
    message: "This EPUB could not be rendered."
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightCurrentSearchMatch(html: string, query: string, occurrenceIndex = 0): string {
  if (!query) {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escapedQuery, "i");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remainingOccurrences = Math.max(0, occurrenceIndex);

  while (node) {
    const textNode = node as Text;
    const text = textNode.nodeValue ?? "";
    let match = matcher.exec(text);

    if (!match) {
      node = walker.nextNode();
      continue;
    }

    while (match && remainingOccurrences > 0) {
      remainingOccurrences -= 1;
      matcher.lastIndex = 0;
      const nextStart = match.index + match[0].length;
      match = matcher.exec(text.slice(nextStart));
      if (match) {
        match.index += nextStart;
      }
    }

    if (!match) {
      node = walker.nextNode();
      continue;
    }

    const fragment = document.createDocumentFragment();
    if (match.index > 0) {
      fragment.append(document.createTextNode(text.slice(0, match.index)));
    }

    const mark = document.createElement("mark");
    mark.className = "search-highlight current";
    mark.textContent = match[0];
    fragment.append(mark);
    const cursor = match.index + match[0].length;
    if (cursor < text.length) {
      fragment.append(document.createTextNode(text.slice(cursor)));
    }

    textNode.replaceWith(fragment);
    break;
  }

  return document.body.innerHTML;
}

function renderPdfPage(page: PDFPageProxy, canvas: HTMLCanvasElement | null, zoom: number): PdfRenderTask | undefined {
  if (!canvas) {
    return;
  }

  const viewport = page.getViewport({ scale: zoom * 1.35 });
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  return page.render({ canvas, canvasContext: context, viewport }) as PdfRenderTask;
}

function isPdfRenderCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return name === "RenderingCancelledException" || message.includes("cancel");
}

function clampZoom(zoom: number): number {
  return Math.min(3, Math.max(0.5, Number(zoom.toFixed(2))));
}

async function searchPdf(pdf: PDFDocumentProxy, query: string): Promise<SearchResult[]> {
  return searchPdfDocumentText(pdf, query);
}

function readerShortcutLabel(commandId: string): string {
  const labels: Record<string, string> = {
    "reader.previousPage": "Previous Page",
    "reader.nextPage": "Next Page",
    "reader.zoomIn": "Reader Zoom In",
    "reader.zoomOut": "Reader Zoom Out",
    "reader.openFind": "Reader Find",
    "reader.toggleBookmark": "Reader Bookmark",
    "reader.toggleSidebar": "Reader Sidebar"
  };

  return labels[commandId] ?? commandId;
}

function locationLabel(session?: DocumentSession): string {
  if (!session) {
    return "";
  }

  if (session.location.kind === "page") {
    return `Page ${session.location.page}`;
  }

  if (session.location.kind === "epub") {
    return session.location.chapterLabel ?? `${Math.round(session.location.progress * 100)}%`;
  }

  return "";
}

function locationToStatus(location: ReaderLocation, pageCount?: number): string {
  if (location.kind === "page") {
    return pageCount ? `${location.page} / ${pageCount}` : `Page ${location.page}`;
  }

  if (location.kind === "epub") {
    return location.chapterLabel ?? `${Math.round(location.progress * 100)}%`;
  }

  return "";
}

function tabProgressLabel(session: DocumentSession): string {
  if (session.status === "empty") {
    return "New tab";
  }

  if (session.status === "error") {
    return "Needs attention";
  }

  if (session.location.kind === "page") {
    return `Page ${session.location.page}`;
  }

  if (session.location.kind === "epub") {
    return session.location.chapterLabel ?? `${readingProgressPercent(session.location)}%`;
  }

  return session.format.toUpperCase();
}

function readerStatusLabel(session?: DocumentSession): string {
  if (!session || session.status !== "ready") {
    return "";
  }

  if (session.location.kind === "page") {
    return session.pageCount
      ? `Page ${session.location.page} of ${session.pageCount}`
      : `Page ${session.location.page}`;
  }

  if (session.location.kind === "epub") {
    return session.location.chapterLabel
      ? `${session.location.chapterLabel} · ${readingProgressPercent(session.location)}%`
      : `${readingProgressPercent(session.location)}%`;
  }

  return "";
}

function visibleWasmStatus(state: WasmAdapterState): "ready" | "loading" | "fallback" | "unavailable" | "error" {
  if (state.status === "idle") {
    return "unavailable";
  }

  return state.status;
}

function wasmStatusMessage(enabled: boolean, state: WasmAdapterState): string {
  if (!enabled) {
    return "WASM adapter disabled; fallback adapters stay active.";
  }

  if (!detectWasmFeatures().supported) {
    return "WASM is unavailable in this runtime; fallback adapters stay active.";
  }

  if (state.status === "ready") {
    return "WASM worker search is ready.";
  }

  if (state.status === "loading") {
    return "WASM worker search is loading.";
  }

  if (state.status === "fallback" || state.status === "error") {
    return state.error?.message
      ? `WASM worker failed: ${state.error.message}. Fallback adapters stay active.`
      : "WASM worker failed; fallback adapters stay active.";
  }

  return "No indexed text payload is available for WASM; fallback adapters stay active.";
}

function chapterProgressLabel(index: number, total: number): string {
  return total > 0 ? `Chapter ${index + 1} of ${total}` : "Chapter";
}

function resourceCountLabel(count: number): string {
  return count === 1 ? "1 resource available" : `${count} resources available`;
}

function readingProgressPercent(location: ReaderLocation): number {
  if (location.kind !== "epub") {
    return 0;
  }

  return Math.round(Math.min(1, Math.max(0, location.progress)) * 100);
}

function zoomForFitMode(fitMode: FitMode, zoom: number): number {
  if (fitMode === "actual-size") {
    return 1;
  }

  if (fitMode === "fit-page") {
    return 0.82;
  }

  if (fitMode === "fit-width") {
    return 1.08;
  }

  return zoom;
}

function modeLabel(mode: SidebarMode): string {
  return {
    contents: "Contents",
    thumbnails: "Thumbnails",
    bookmarks: "Marks",
    search: "Search"
  }[mode];
}

type IconName =
  | "sidebar"
  | "open"
  | "back"
  | "forward"
  | "minus"
  | "plus"
  | "search"
  | "bookmark"
  | "more"
  | "warning";

function Icon(props: { name: IconName }) {
  const paths: Record<IconName, JSX.Element> = {
    sidebar: <path d="M4 5h16v14H4zM9 5v14" />,
    open: <path d="M4 17V7h5l2 2h9v8H4zm2-6h12" />,
    back: <path d="M14 6l-6 6 6 6" />,
    forward: <path d="M10 6l6 6-6 6" />,
    minus: <path d="M6 12h12" />,
    plus: <path d="M12 6v12M6 12h12" />,
    search: <path d="M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zm5-1.5L20 20" />,
    bookmark: <path d="M7 5h10v15l-5-3-5 3z" />,
    more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
    warning: <path d="M12 4l9 16H3L12 4zm0 5v5m0 3h.01" />
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      {paths[props.name]}
    </svg>
  );
}
