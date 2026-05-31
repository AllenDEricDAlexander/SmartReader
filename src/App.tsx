import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from "react";
import JSZip from "jszip";
import {
  AnnotationPlugin,
  DocumentManagerPlugin,
  PDFViewer,
  ScrollPlugin,
  ScrollStrategy,
  SelectionPlugin,
  SearchPlugin,
  ZoomPlugin,
  ZoomMode
} from "@embedpdf/react-pdf-viewer";
import type { PDFViewerConfig, PluginRegistry, ZoomLevel } from "@embedpdf/react-pdf-viewer";
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
  isLockedRecentFile,
  redactProtectedRecentFilesForStorage,
  removeRecentLibraryEntriesForDeletedFiles
} from "./state/recentLibraryEncryption";
import {
  loadRecentLibraryMetadata,
  saveRecentLibraryMetadata
} from "./state/recentLibrary";
import {
  createAppSessionSnapshot,
  loadAppSessionSnapshot,
  restoreAppSessionSnapshot,
  saveAppSessionSnapshot
} from "./state/sessionPersistence";
import { sanitizeEpubHtml } from "./reader/epubSanitizer";
import {
  annotationColors,
  annotationTitle as readerAnnotationTitle,
  annotationTypeLabel,
  safeAnnotationColor,
  safeAnnotationThickness
} from "./reader/annotations";
import {
  epubHrefFragment,
  isSameEpubChapterHref,
  isSameReaderLocation,
  visibleOutlineRows
} from "./reader/outlineRows";
import type { OutlineRow } from "./reader/outlineRows";
import { annotationsToMarkdown, downloadSafeName } from "./reader/annotationExport";
import { nativePdfKitUnsupportedReason } from "./reader/pdfAnnotationGeometry";
import {
  createEpubLocationCfi,
  createEpubSelectionCfi,
  renderEpubHtml
} from "./reader/epubAnnotations";
import { visibleRowRange } from "./reader/virtualRows";
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
  searchEpubDocument,
  saveSmartReaderCache,
  setSmartReaderCacheLocation,
  setupTauriMenu
} from "./platform/tauriBridge";
import type { DesktopEpubDocument, DesktopPdfDocument } from "./platform/tauriBridge";
import { createAccessErrorSession, isTauriRuntime } from "./platform/fileSources";
import { PreferencesDialog as PreferencesPanel } from "./components/PreferencesDialog";
import type { CacheInfo, CacheStatus, ShortcutConflict, ShortcutPreference } from "./components/PreferencesDialog";
import { RecentLibraryPanel } from "./components/RecentLibraryPanel";
import { AnnotationBar } from "./components/AnnotationBar";
import type { AnnotationDraft } from "./components/AnnotationBar";
import { AnnotationQuickMenu } from "./components/AnnotationQuickMenu";
import type { AnnotationSelectionContext } from "./components/AnnotationQuickMenu";
import { AnnotationSidebar } from "./components/AnnotationSidebar";
import { PdfAnnotationActions } from "./components/PdfAnnotationActions";
import {
  defaultReaderShortcutBindings,
  findShortcutConflicts,
  shouldHandleReaderShortcut,
  useReaderShortcuts
} from "./hooks/useReaderShortcuts";
import { useEpubAnchorSync } from "./hooks/useEpubAnchorSync";
import { usePdfKitAnnotationSync } from "./hooks/usePdfKitAnnotationSync";
import {
  createSmartReaderCacheEnvelope,
  validateSmartReaderCacheEnvelope,
  writeSmartReaderCache as writeLocalSmartReaderCache
} from "./state/smartReaderCache";
import { searchEpubChapters } from "./lib/fallbackSearch";
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
  ReaderAnnotation,
  AnnotationType,
  ReaderError,
  ReaderLocation,
  NativePdfAnnotationSnapshot,
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
const SEARCH_RESULT_ROW_HEIGHT = 58;
const SEARCH_RESULT_OVERSCAN_ROWS = 8;
const SEARCH_RESULT_FALLBACK_VIEWPORT_HEIGHT = 420;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 260;
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

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const searchAdapterRef = useRef<(query: string) => Promise<SearchResult[]>>(async () => []);
  const pdfSearchBridgeRef = useRef<PdfSearchBridge | undefined>(undefined);
  const pdfNativeAnnotationBridgeRef = useRef<PdfNativeAnnotationBridge | undefined>(undefined);
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
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>({
    type: "highlight",
    tag: "重点",
    color: annotationColors[0],
    thickness: 2,
    note: ""
  });
  const [selectedAnnotationId, setSelectedAnnotationId] = useState("");
  const [selectionContext, setSelectionContext] = useState<AnnotationSelectionContext | undefined>();
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
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
  const activeHasBookmark = Boolean(
    activeSession?.bookmarks.some((bookmark) => isSameReaderLocation(bookmark.location, activeSession.location))
  );
  const showSmartReaderSidebar = shouldShowSmartReaderSidebar(activeSession, sidebarOpen);

  useEffect(() => {
    if (!activeSession || !selectedAnnotationId) {
      return;
    }

    if (!activeSession.annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId("");
    }
  }, [activeSession?.annotations, activeSession?.id, selectedAnnotationId]);

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

  const toggleSmartReaderSidebar = useCallback(() => {
    if (
      activeSession?.status === "ready" &&
      activeSession.format === "pdf" &&
      !showSmartReaderSidebar
    ) {
      updateActiveSession((session) => updateSessionSidebarMode(session, "bookmarks"));
      setSidebarOpen(true);
      return;
    }

    setSidebarOpen((value) => !value);
  }, [activeSession, showSmartReaderSidebar, updateActiveSession]);

  const showHud = useCallback((message: string) => {
    if (hudTimerRef.current) {
      window.clearTimeout(hudTimerRef.current);
    }
    setHud(message);
    hudTimerRef.current = window.setTimeout(() => setHud(""), 1200);
  }, []);

  const openFind = useCallback(() => {
    if (activeSession?.status === "ready" && activeSession.format === "pdf") {
      if (!pdfSearchBridgeRef.current?.openSearch()) {
        showHud("PDF search is not ready");
      }
      return;
    }

    setFindOpen(true);
  }, [activeSession, showHud]);

  const persistNativeEpubAnchor = useEpubAnchorSync({
    activeSession,
    setSessions
  });
  const persistNativePdfKitAnnotation = usePdfKitAnnotationSync({
    enabled: preferences.pdfKit.enabled,
    sessions,
    setSessions,
    showHud
  });

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
        saveRecentFilesWithRetentionPruning(current, next);
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
      recentFiles: redactProtectedRecentFilesForStorage(recentFiles),
      readingProgress: recentFiles.filter((file) => !file.protection).map((file) => ({
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
    const recent = recentFiles.find((file) => file.path === path && !isLockedRecentFile(file));
    addSession(session.status === "ready" && recent ? createSessionFromRecentFile(recent) : session);
  }, [addSession, recentFiles]);
  openDesktopPathRef.current = openDesktopPath;

  const openRecentFile = useCallback(async (recent: RecentFile) => {
    if (isLockedRecentFile(recent)) {
      showHud("Unlock the folder first");
      return;
    }

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
  }, [addSession, isDesktop, sessions, showHud]);

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
        const nextSession = {
          ...session,
          bookmarks: session.bookmarks.filter((bookmark) => bookmark.id !== existing.id)
        };
        return session.format === "pdf" ? { ...nextSession, sidebarMode: "bookmarks" } : nextSession;
      }

      const bookmark: Bookmark = {
        id: `bookmark-${Date.now()}`,
        title: locationLabel(session),
        location: session.location,
        createdAt: Date.now()
      };

      const nextSession = { ...session, bookmarks: [bookmark, ...session.bookmarks] };
      return session.format === "pdf" ? { ...nextSession, sidebarMode: "bookmarks" } : nextSession;
    });
    if (activeSession?.status === "ready" && activeSession.format === "pdf") {
      setSidebarOpen(true);
    }
    showHud("Bookmark updated");
  }, [activeSession, showHud, updateActiveSession]);

  const addAnnotation = useCallback((typeOverride?: AnnotationType, contextOverride?: AnnotationSelectionContext) => {
    if (!activeSession || activeSession.status !== "ready" || activeSession.location.kind === "none") {
      return;
    }

    const context = contextOverride ?? selectionContext;
    const nextType = typeOverride ?? annotationDraft.type;
    if (activeSession.format === "pdf" && !preferences.pdfKit.enabled) {
      const nativeActivated = pdfNativeAnnotationBridgeRef.current?.activateTool(nextType, annotationDraft) ?? false;
      if (nativeActivated) {
        setSelectionContext(undefined);
        setAnnotationDraft((current) => ({ ...current, note: "" }));
        showHud(`${annotationTypeLabel(nextType)} tool ready`);
        return;
      }
    }

    const annotationId = createAnnotationId();
    const now = Date.now();
    const selectedText =
      nextType === "area"
        ? ""
        : (context?.selectedText ?? window.getSelection?.()?.toString() ?? "")
            .replace(/\u200b/g, "")
            .trim()
            .slice(0, 500);
    const note = annotationDraft.note.trim();
    const selection = window.getSelection?.();
    const selectionNode = selection?.anchorNode;
    const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement;
    const location =
      context?.location ??
      (
        activeSession.location.kind === "epub"
          ? {
              ...activeSession.location,
              anchorOccurrenceIndex:
                selectedText && selection && selection.rangeCount > 0
                  ? epubSelectionOccurrenceIndex(selection, selectedText, selectionElement ?? undefined)
                  : undefined,
              cfi:
                selectedText && selection && selection.rangeCount > 0
                  ? createEpubSelectionCfi(selection, activeSession.location)
                  : createEpubLocationCfi(activeSession.location)
            }
          : activeSession.location
      );
    const annotation: ReaderAnnotation = {
      id: annotationId,
      type: nextType,
      tag: annotationDraft.tag,
      color: annotationDraft.color,
      thickness: annotationDraft.thickness,
      location,
      selectedText: selectedText || undefined,
      area: annotationAreaForType(nextType, location, context),
      rects: annotationRectsForType(nextType, context),
      note: note || undefined,
      hidden: false,
      createdAt: now,
      updatedAt: now
    };

    updateActiveSession((session) => {
      if (session.id !== activeSession.id || session.status !== "ready" || session.location.kind === "none") {
        return session;
      }

      return {
        ...session,
        sidebarMode: "annotations",
        annotations: [annotation, ...session.annotations],
        updatedAt: now
      };
    });
    persistNativeEpubAnchor(activeSession, annotation);
    persistNativePdfKitAnnotation(activeSession, annotation);
    setSelectedAnnotationId(annotationId);
    setSidebarOpen(true);
    setSelectionContext(undefined);
    setAnnotationDraft((current) => ({ ...current, note: "" }));
    showHud(nextType === "area" ? "Area annotation added" : "Annotation added");
  }, [activeSession, annotationDraft, persistNativeEpubAnchor, persistNativePdfKitAnnotation, preferences.pdfKit.enabled, selectionContext, showHud, updateActiveSession]);

  const persistNativePdfAnnotations = useCallback((annotations: unknown[]) => {
    const snapshot = nativePdfAnnotationSnapshot(annotations);

    updateActiveSession((session) => {
      if (session.format !== "pdf") {
        return session;
      }

      return {
        ...session,
        nativePdfAnnotations: snapshot,
        updatedAt: Date.now()
      };
    });
  }, [updateActiveSession]);

  const exportNativePdfAnnotations = useCallback(async () => {
    if (activeSession?.format !== "pdf") {
      return;
    }

    const bridge = pdfNativeAnnotationBridgeRef.current;
    if (!bridge) {
      showHud("PDF annotations not ready");
      return;
    }

    try {
      const envelope = await bridge.exportAnnotations();
      if (envelope.annotations.length === 0) {
        showHud("No PDF annotations to export");
        return;
      }

      downloadTextFile(
        JSON.stringify(envelope, null, 2),
        `${downloadSafeName(activeSession.title)}-pdf-annotations.json`,
        "application/json"
      );
      persistNativePdfAnnotations(envelope.annotations);
      showHud("PDF annotations exported");
    } catch {
      showHud("PDF annotation export failed");
    }
  }, [activeSession, persistNativePdfAnnotations, showHud]);

  const importNativePdfAnnotations = useCallback(async (content: string) => {
    if (activeSession?.format !== "pdf") {
      return;
    }

    const bridge = pdfNativeAnnotationBridgeRef.current;
    if (!bridge) {
      showHud("PDF annotations not ready");
      return;
    }

    try {
      const annotations = parseEmbedPdfAnnotationImport(content);
      if (!annotations || annotations.length === 0) {
        showHud("No PDF annotations to import");
        return;
      }

      bridge.importAnnotations(annotations);
      persistNativePdfAnnotations(annotations);
      showHud("PDF annotations imported");
    } catch {
      showHud("PDF annotation import failed");
    }
  }, [activeSession, persistNativePdfAnnotations, showHud]);

  const updateAnnotation = useCallback((annotationId: string, patch: Partial<ReaderAnnotation>) => {
    const sourceAnnotation = activeSession?.annotations.find((annotation) => annotation.id === annotationId);
    const now = Date.now();
    const updatedNativeAnnotation = sourceAnnotation
      ? {
          ...sourceAnnotation,
          ...patch,
          updatedAt: now
        }
      : undefined;

    updateActiveSession((session) => {
      let changed = false;
      const annotations = session.annotations.map((annotation) => {
        if (annotation.id !== annotationId) {
          return annotation;
        }

        changed = true;
        return {
          ...annotation,
          ...patch,
          updatedAt: now
        };
      });

      return changed ? { ...session, annotations, updatedAt: now } : session;
    });
    if (activeSession && updatedNativeAnnotation) {
      if (
        patch.type &&
        nativePdfKitUnsupportedReason(updatedNativeAnnotation) &&
        sourceAnnotation?.nativePdfKit?.nativeId
      ) {
        persistNativePdfKitAnnotation(activeSession, sourceAnnotation, "delete");
      }
      persistNativePdfKitAnnotation(
        activeSession,
        updatedNativeAnnotation,
        patch.hidden === true ? "delete" : "upsert"
      );
    }
    setSelectedAnnotationId(annotationId);
  }, [activeSession, persistNativePdfKitAnnotation, updateActiveSession]);

  const renameBookmark = useCallback((bookmarkId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    updateActiveSession((session) => {
      let changed = false;
      const bookmarks = session.bookmarks.map((bookmark) => {
        if (bookmark.id !== bookmarkId || bookmark.title === trimmed) {
          return bookmark;
        }

        changed = true;
        return { ...bookmark, title: trimmed };
      });

      return changed ? { ...session, bookmarks, updatedAt: Date.now() } : session;
    });
  }, [updateActiveSession]);

  const handleReaderSelection = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!activeSession || activeSession.status !== "ready") {
      setSelectionContext(undefined);
      return;
    }

    const selection = window.getSelection?.();
    const targetElement = event.target instanceof Element ? event.target : undefined;
    const selectedText = (selection?.toString().replace(/\u200b/g, "").trim() || "").slice(0, 500);
    let hasExpandedRange = false;
    for (let index = 0; index < (selection?.rangeCount ?? 0); index += 1) {
      if (!selection?.getRangeAt(index).collapsed) {
        hasExpandedRange = true;
        break;
      }
    }
    if (!selection || selection.rangeCount === 0 || !hasExpandedRange || !selectedText) {
      setSelectionContext(undefined);
      return;
    }

    const node = selection.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const selectionElement = element ?? targetElement;
    if (!selectionElement?.closest(".epub-content") || activeSession.location.kind !== "epub") {
      setSelectionContext(undefined);
      return;
    }

    const occurrenceIndex = epubSelectionOccurrenceIndex(selection, selectedText, selectionElement);
    const location: ReaderLocation = {
      ...activeSession.location,
      anchorOccurrenceIndex: occurrenceIndex,
      cfi: createEpubSelectionCfi(selection, activeSession.location)
    };

    setSelectionContext({
      selectedText,
      location,
      menuLeft: event.clientX,
      menuTop: event.clientY
    });
  }, [activeSession]);

  const toggleAnnotationHidden = useCallback((annotationId: string) => {
    const sourceAnnotation = activeSession?.annotations.find((annotation) => annotation.id === annotationId);
    const now = Date.now();
    const updatedNativeAnnotation = sourceAnnotation
      ? { ...sourceAnnotation, hidden: !sourceAnnotation.hidden, updatedAt: now }
      : undefined;

    updateActiveSession((session) => {
      let changed = false;
      const annotations = session.annotations.map((annotation) => {
        if (annotation.id !== annotationId) {
          return annotation;
        }

        changed = true;
        return { ...annotation, hidden: !annotation.hidden, updatedAt: now };
      });

      return changed ? { ...session, annotations, updatedAt: now } : session;
    });
    if (activeSession && updatedNativeAnnotation) {
      persistNativePdfKitAnnotation(
        activeSession,
        updatedNativeAnnotation,
        updatedNativeAnnotation.hidden ? "delete" : "upsert"
      );
    }
  }, [activeSession, persistNativePdfKitAnnotation, updateActiveSession]);

  const toggleAllAnnotationsHidden = useCallback(() => {
    if (!activeSession || activeSession.annotations.length === 0) {
      showHud("No annotations to update");
      return;
    }

    const hidden = activeSession.annotations.some((annotation) => !annotation.hidden);
    const now = Date.now();

    updateActiveSession((session) => {
      if (session.annotations.length === 0) {
        return session;
      }

      return {
        ...session,
        annotations: session.annotations.map((annotation) =>
          annotation.hidden === hidden ? annotation : { ...annotation, hidden, updatedAt: now }
        ),
        updatedAt: now
      };
    });
    activeSession.annotations.forEach((annotation) => {
      if (annotation.hidden !== hidden) {
        persistNativePdfKitAnnotation(
          activeSession,
          { ...annotation, hidden, updatedAt: now },
          hidden ? "delete" : "upsert"
        );
      }
    });
    showHud(hidden ? "Annotations hidden" : "Annotations shown");
  }, [activeSession, persistNativePdfKitAnnotation, showHud, updateActiveSession]);

  const deleteAnnotation = useCallback((annotationId: string) => {
    const sourceAnnotation = activeSession?.annotations.find((annotation) => annotation.id === annotationId);

    updateActiveSession((session) => {
      const annotations = session.annotations.filter((annotation) => annotation.id !== annotationId);

      return annotations.length === session.annotations.length
        ? session
        : { ...session, annotations, updatedAt: Date.now() };
    });
    if (activeSession && sourceAnnotation) {
      persistNativePdfKitAnnotation(activeSession, sourceAnnotation, "delete");
    }
    setSelectedAnnotationId((current) => (current === annotationId ? "" : current));
  }, [activeSession, persistNativePdfKitAnnotation, updateActiveSession]);

  const exportAnnotations = useCallback((session: DocumentSession) => {
    if (session.annotations.length === 0) {
      showHud("No annotations to export");
      return;
    }

    downloadTextFile(
      annotationsToMarkdown(session),
      `${downloadSafeName(session.title)}-annotations.md`,
      "text/markdown;charset=utf-8"
    );
    showHud("Annotations exported");
  }, [showHud]);

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

  const configurePdfNativeAnnotationBridge = useCallback((bridge?: PdfNativeAnnotationBridge) => {
    pdfNativeAnnotationBridgeRef.current = bridge;
  }, []);

  const configurePdfSearchBridge = useCallback((bridge?: PdfSearchBridge) => {
    pdfSearchBridgeRef.current = bridge;
  }, []);

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
    if (activeSession?.status === "ready" && activeSession.format === "pdf") {
      const handled = direction === "next"
        ? pdfSearchBridgeRef.current?.nextResult()
        : pdfSearchBridgeRef.current?.previousResult();

      if (!handled) {
        showHud("PDF search is not ready");
      }
      return;
    }

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

  const selectSearchResultAtIndex = useCallback((index: number) => {
    if (!activeSession || activeSession.searchResults.length === 0) {
      return;
    }

    const boundedIndex = Math.min(Math.max(0, index), activeSession.searchResults.length - 1);
    const result = activeSession.searchResults[boundedIndex];
    setSearchSelections((current) => ({
      ...current,
      [activeSession.id]: {
        query: activeSearchSelection?.query ?? findQuery.trim(),
        currentIndex: boundedIndex,
        total: activeSession.searchResults.length
      }
    }));

    if (result) {
      jumpToLocation(result.location);
    }
  }, [activeSearchSelection?.query, activeSession, findQuery, jumpToLocation]);

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
          openFind,
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
      openFind,
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
      "reader.openFind": openFind,
      "reader.toggleBookmark": toggleBookmark,
      "reader.toggleSidebar": () => setSidebarOpen((value) => !value)
    }),
    [movePdfPage, openFind, toggleBookmark, zoomBy]
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
      saveRecentFilesWithRetentionPruning(current, next);
      return next;
    });
  }, [activeLocationKey, activeSession?.id, activeSession?.outline, activeSession?.pageCount, preferences.recentRetention]);

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
        sidebarOpen={showSmartReaderSidebar}
        locationInputRef={locationInputRef}
        onToggleSidebar={toggleSmartReaderSidebar}
        onOpen={openFilePicker}
        onZoomOut={() => zoomBy(-0.1)}
        onZoomIn={() => zoomBy(0.1)}
        onResetZoom={resetZoom}
        onOpenFind={openFind}
        onToggleBookmark={toggleBookmark}
        bookmarkActive={activeHasBookmark}
        onPreferences={() => setPreferencesOpen(true)}
        onExportNativePdfAnnotations={
          activeSession?.status === "ready" && activeSession.format === "pdf"
            ? exportNativePdfAnnotations
            : undefined
        }
        onImportNativePdfAnnotations={
          activeSession?.status === "ready" && activeSession.format === "pdf"
            ? importNativePdfAnnotations
            : undefined
        }
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

      {findOpen && activeSession?.format !== "pdf" ? (
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

      <section
        className={`reader-workspace ${showSmartReaderSidebar ? "with-sidebar" : ""}${!activeSession || activeSession.status === "empty" ? " empty-workspace" : ""}`}
        style={showSmartReaderSidebar ? ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties) : undefined}
      >
        {showSmartReaderSidebar ? (
          <ReaderSidebar
            session={activeSession}
            onModeChange={(mode) => updateActiveSession((session) => updateSessionSidebarMode(session, mode))}
            onJump={jumpToLocation}
            onRenameBookmark={renameBookmark}
            searchSelection={activeSearchSelection}
            onSelectSearchResult={selectSearchResultAtIndex}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
            onClearSelectedAnnotation={() => setSelectedAnnotationId("")}
            onUpdateAnnotation={updateAnnotation}
            onToggleAnnotationHidden={toggleAnnotationHidden}
            onToggleAllAnnotationsHidden={toggleAllAnnotationsHidden}
            onExportAnnotations={exportAnnotations}
            onDeleteAnnotation={deleteAnnotation}
          />
        ) : null}
        {showSmartReaderSidebar ? (
          <SidebarResizeHandle
            width={sidebarWidth}
            onChange={setSidebarWidth}
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
          onRecentFilesChange={(next) => {
            saveRecentFiles(next);
            setRecentFiles(next);
          }}
          onProtectedPathsLocked={(paths) => {
            const protectedPathSet = new Set(paths);
            setSessions((current) => {
              const next = current.filter((session) => !session.filePath || !protectedPathSet.has(session.filePath));

              if (next.length > 0) {
                if (!next.some((session) => session.id === activeTabId)) {
                  setActiveTabId(next[0].id);
                }
                return next;
              }

              const empty = createEmptySession();
              setActiveTabId(empty.id);
              return [empty];
            });
          }}
          onRemoveRecent={(path) => {
            setRecentFiles((current) => {
              const removedRecentFiles = current.filter((recent) => recent.path === path);
              const next = current.filter((recent) => recent.path !== path);
              const nextLibrary = removeRecentLibraryEntriesForDeletedFiles({
                library: loadRecentLibraryMetadata(),
                removedRecentFiles,
                remainingRecentFiles: next,
                pruneDocuments: false
              });

              saveRecentLibraryMetadata(nextLibrary);
              saveRecentFiles(next);
              return next;
            });
          }}
          onClearRecent={() => {
            setRecentFiles((current) => {
              const next = clearRecentFiles();
              const nextLibrary = removeRecentLibraryEntriesForDeletedFiles({
                library: loadRecentLibraryMetadata(),
                removedRecentFiles: current,
                remainingRecentFiles: next
              });

              saveRecentLibraryMetadata(nextLibrary);
              saveRecentFiles(next);
              return next;
            });
          }}
          onLocationChange={handleLocationChange}
          onNavigate={jumpToLocation}
          onOutlineChange={(outline) => updateActiveSession((session) => ({ ...session, outline }))}
          onPageCountChange={(pageCount) => updateActiveSession((session) => ({ ...session, pageCount }))}
          onSearchReady={configureSearchAdapter}
          onPdfSearchReady={configurePdfSearchBridge}
          onPdfNativeAnnotationReady={configurePdfNativeAnnotationBridge}
          onPdfNativeAnnotationsChange={persistNativePdfAnnotations}
          searchQuery={findQuery}
          searchSelection={activeSearchSelection}
          annotationDraft={annotationDraft}
          onAnnotationDraftChange={setAnnotationDraft}
          onAddAnnotation={addAnnotation}
          onExportNativePdfAnnotations={exportNativePdfAnnotations}
          onImportNativePdfAnnotations={importNativePdfAnnotations}
          onReaderSelection={handleReaderSelection}
          onPdfSelectionContextChange={setSelectionContext}
          selectionContext={selectionContext}
          selectedAnnotationId={selectedAnnotationId}
          onSelectAnnotation={setSelectedAnnotationId}
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
            setRecentFiles((current) => {
              const next = clearRecentFiles();
              const nextLibrary = removeRecentLibraryEntriesForDeletedFiles({
                library: loadRecentLibraryMetadata(),
                removedRecentFiles: current,
                remainingRecentFiles: next
              });

              saveRecentLibraryMetadata(nextLibrary);
              saveRecentFiles(next);
              return next;
            });
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
  bookmarkActive: boolean;
  onPreferences: () => void;
  onExportNativePdfAnnotations?: () => void;
  onImportNativePdfAnnotations?: (content: string) => void | Promise<void>;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onFitMode: (fitMode: FitMode) => void;
  onLocationSubmit: (location: ReaderLocation) => void;
}) {
  const hasDocument = props.session?.status === "ready";
  const isPdfDocument = hasDocument && props.session?.format === "pdf";
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
      {!isPdfDocument ? (
        <>
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
        </>
      ) : null}
      <span className="toolbar-spacer" />
      {!isPdfDocument ? (
        <ToolbarButton label="Find" icon="search" disabled={!hasDocument} onClick={props.onOpenFind} />
      ) : null}
      <ToolbarButton
        label="Bookmark"
        icon="bookmark"
        disabled={!hasDocument}
        pressed={props.bookmarkActive}
        onClick={props.onToggleBookmark}
      />
      {isPdfDocument && props.onExportNativePdfAnnotations && props.onImportNativePdfAnnotations ? (
        <PdfAnnotationActions
          onExport={props.onExportNativePdfAnnotations}
          onImport={props.onImportNativePdfAnnotations}
        />
      ) : null}
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

function shouldShowSmartReaderSidebar(session: DocumentSession | undefined, sidebarOpen: boolean): boolean {
  if (!sidebarOpen) {
    return false;
  }

  if (
    session?.status === "ready" &&
    session.format === "pdf" &&
    !pdfSmartReaderSidebarModes(session).includes(session.sidebarMode)
  ) {
    return false;
  }

  return true;
}

function pdfSmartReaderSidebarModes(session: DocumentSession): SidebarMode[] {
  return session.annotations.length > 0 || session.sidebarMode === "annotations"
    ? ["bookmarks", "annotations"]
    : ["bookmarks"];
}

function ReaderSidebar(props: {
  session?: DocumentSession;
  onModeChange: (mode: SidebarMode) => void;
  onJump: (location: ReaderLocation) => void;
  onRenameBookmark: (id: string, title: string) => void;
  searchSelection?: SearchSelection;
  onSelectSearchResult: (index: number) => void;
  selectedAnnotationId: string;
  onSelectAnnotation: (id: string) => void;
  onClearSelectedAnnotation: () => void;
  onUpdateAnnotation: (id: string, patch: Partial<ReaderAnnotation>) => void;
  onToggleAnnotationHidden: (id: string) => void;
  onToggleAllAnnotationsHidden: () => void;
  onExportAnnotations: (session: DocumentSession) => void;
  onDeleteAnnotation: (id: string) => void;
}) {
  const rawMode = props.session?.sidebarMode ?? "contents";
  const modes = props.session?.status === "ready" && props.session.format === "pdf"
    ? pdfSmartReaderSidebarModes(props.session)
    : (["contents", "bookmarks", "search", "annotations"] as SidebarMode[]);
  const normalizedMode = rawMode === "thumbnails" ? "contents" : rawMode;
  const mode = modes.includes(normalizedMode) ? normalizedMode : modes[0];
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
        {modes.map((item) => (
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
          onRenameBookmark={props.onRenameBookmark}
          searchSelection={props.searchSelection}
          onSelectSearchResult={props.onSelectSearchResult}
          selectedAnnotationId={props.selectedAnnotationId}
          onSelectAnnotation={props.onSelectAnnotation}
          onClearSelectedAnnotation={props.onClearSelectedAnnotation}
          onUpdateAnnotation={props.onUpdateAnnotation}
          onToggleAnnotationHidden={props.onToggleAnnotationHidden}
          onToggleAllAnnotationsHidden={props.onToggleAllAnnotationsHidden}
          onExportAnnotations={props.onExportAnnotations}
          onDeleteAnnotation={props.onDeleteAnnotation}
          scrollTop={scrollState.top}
          viewportHeight={scrollState.height}
        />
      </div>
    </aside>
  );
}

function SidebarResizeHandle(props: {
  width: number;
  onChange: (width: number) => void;
}) {
  const dragStartRef = useRef<{ x: number; width: number } | undefined>(undefined);
  const commitWidth = useCallback((width: number) => {
    props.onChange(clampSidebarWidth(width));
  }, [props]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) {
        return;
      }

      commitWidth(start.width + event.clientX - start.x);
    };
    const onPointerUp = () => {
      dragStartRef.current = undefined;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [commitWidth]);

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={props.width}
      tabIndex={0}
      onPointerDown={(event) => {
        dragStartRef.current = { x: event.clientX, width: props.width };
      }}
      onDoubleClick={() => props.onChange(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          commitWidth(props.width - 10);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          commitWidth(props.width + 10);
        }
      }}
    />
  );
}

function SidebarRows(props: {
  session?: DocumentSession;
  mode: SidebarMode;
  onJump: (location: ReaderLocation) => void;
  onRenameBookmark: (id: string, title: string) => void;
  searchSelection?: SearchSelection;
  onSelectSearchResult: (index: number) => void;
  selectedAnnotationId: string;
  onSelectAnnotation: (id: string) => void;
  onClearSelectedAnnotation: () => void;
  onUpdateAnnotation: (id: string, patch: Partial<ReaderAnnotation>) => void;
  onToggleAnnotationHidden: (id: string) => void;
  onToggleAllAnnotationsHidden: () => void;
  onExportAnnotations: (session: DocumentSession) => void;
  onDeleteAnnotation: (id: string) => void;
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

    const range = visibleRowRange(
      outlineRows.length,
      OUTLINE_ROW_HEIGHT,
      props.scrollTop,
      props.viewportHeight || OUTLINE_FALLBACK_VIEWPORT_HEIGHT,
      OUTLINE_OVERSCAN_ROWS
    );
    const visibleRows = outlineRows.slice(range.start, range.end);

    return (
      <div
        style={{
          ...outlineWindowStyle,
          height: `${outlineRows.length * OUTLINE_ROW_HEIGHT}px`
        }}
      >
        {visibleRows.map((row, offset) => {
          const index = range.start + offset;

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
    return <p className="empty-note">PDF thumbnails are handled by the PDF viewer.</p>;
  }

  if (props.mode === "bookmarks") {
    if (session.bookmarks.length === 0) {
      return <p className="empty-note">No bookmarks in this document.</p>;
    }

    return session.bookmarks.map((bookmark) => (
      <BookmarkSidebarRow
        key={bookmark.id}
        bookmark={bookmark}
        active={isSameReaderLocation(bookmark.location, session.location)}
        onJump={props.onJump}
        onRename={props.onRenameBookmark}
      />
    ));
  }

  if (props.mode === "annotations") {
    return (
      <AnnotationSidebar
        session={session}
        selectedAnnotationId={props.selectedAnnotationId}
        getAnnotationTitle={annotationTitle}
        onJump={props.onJump}
        onSelectAnnotation={props.onSelectAnnotation}
        onClearSelectedAnnotation={props.onClearSelectedAnnotation}
        onUpdateAnnotation={props.onUpdateAnnotation}
        onToggleAnnotationHidden={props.onToggleAnnotationHidden}
        onToggleAllAnnotationsHidden={props.onToggleAllAnnotationsHidden}
        onExportAnnotations={props.onExportAnnotations}
        onDeleteAnnotation={props.onDeleteAnnotation}
        scrollTop={props.scrollTop}
        viewportHeight={props.viewportHeight}
      />
    );
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
            className={`search-result-row ${props.searchSelection?.currentIndex === index ? "active" : ""}`}
            type="button"
            aria-label={`${result.label}, result ${index + 1}: ${result.snippet}`}
            aria-current={props.searchSelection?.currentIndex === index ? "true" : undefined}
            onClick={() => props.onSelectSearchResult(index)}
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

function BookmarkSidebarRow(props: {
  bookmark: Bookmark;
  active: boolean;
  onJump: (location: ReaderLocation) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [title, setTitle] = useState(props.bookmark.title);

  useEffect(() => {
    setTitle(props.bookmark.title);
  }, [props.bookmark.id, props.bookmark.title]);

  return (
    <div className={`sidebar-row mark-row ${props.active ? "active" : ""}`}>
      <button
        type="button"
        aria-current={props.active ? "true" : undefined}
        onClick={() => props.onJump(props.bookmark.location)}
      >
        {props.bookmark.title}
      </button>
      <input
        aria-label={`Rename mark ${props.bookmark.title}`}
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onBlur={() => {
          const trimmed = title.trim();
          if (!trimmed) {
            setTitle(props.bookmark.title);
            return;
          }

          props.onRename(props.bookmark.id, trimmed);
          setTitle(trimmed);
        }}
      />
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

function ReaderViewport(props: {
  session?: DocumentSession;
  recentFiles: RecentFile[];
  preferences: Preferences;
  documentCache: Map<string, LoadedReaderDocument>;
  scrollRevision: number;
  onOpen: () => void;
  onOpenRecent: (recent: RecentFile) => void;
  onRecentFilesChange: (recentFiles: RecentFile[]) => void;
  onProtectedPathsLocked: (paths: string[]) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
  onLocationChange: (location: ReaderLocation) => void;
  onNavigate: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onPageCountChange: (pageCount: number) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>, wasmDocuments?: SearchWorkerDocument[]) => void;
  onPdfSearchReady: (bridge?: PdfSearchBridge) => void;
  onPdfNativeAnnotationReady: (bridge?: PdfNativeAnnotationBridge) => void;
  onPdfNativeAnnotationsChange: (annotations: unknown[]) => void;
  searchQuery: string;
  searchSelection?: SearchSelection;
  annotationDraft: AnnotationDraft;
  onAnnotationDraftChange: (draft: AnnotationDraft) => void;
  onAddAnnotation: (type?: AnnotationType, context?: AnnotationSelectionContext) => void;
  onExportNativePdfAnnotations: () => void;
  onImportNativePdfAnnotations: (content: string) => void | Promise<void>;
  onReaderSelection: (event: ReactMouseEvent<HTMLElement>) => void;
  onPdfSelectionContextChange: (context?: AnnotationSelectionContext) => void;
  selectionContext?: AnnotationSelectionContext;
  selectedAnnotationId: string;
  onSelectAnnotation: (id: string) => void;
  onPinchZoom: (event: React.WheelEvent<HTMLElement>) => void;
}) {
  const session = props.session;

  if (!session || session.status === "empty") {
    return (
      <EmptyState
        recentFiles={props.recentFiles}
        onOpen={props.onOpen}
        onOpenRecent={props.onOpenRecent}
        onRecentFilesChange={props.onRecentFilesChange}
        onProtectedPathsLocked={props.onProtectedPathsLocked}
        onRemoveRecent={props.onRemoveRecent}
        onClearRecent={props.onClearRecent}
      />
    );
  }

  if (session.status === "error") {
    return (
      <ErrorState session={session} onOpen={props.onOpen} onRemoveRecent={props.onRemoveRecent} />
    );
  }

  return (
    <section
      className="reader-viewport"
      tabIndex={0}
      aria-label={`${session.title} reader`}
      onMouseUp={session.format === "pdf" ? undefined : props.onReaderSelection}
      onWheel={props.onPinchZoom}
    >
      {session.format !== "pdf" || props.preferences.pdfKit.enabled ? (
        <AnnotationBar
          draft={props.annotationDraft}
          onChange={props.onAnnotationDraftChange}
          onAdd={props.onAddAnnotation}
        />
      ) : null}
      {props.selectionContext && (session.format !== "pdf" || props.preferences.pdfKit.enabled) ? (
        <AnnotationQuickMenu
          context={props.selectionContext}
          onCreate={(type) => props.onAddAnnotation(type, props.selectionContext)}
        />
      ) : null}
      {session.format === "pdf" ? (
        <PdfReader
          key={session.id}
          session={session}
          preferences={props.preferences}
          documentCache={props.documentCache}
          scrollRevision={props.scrollRevision}
          onLocationChange={props.onLocationChange}
          onOutlineChange={props.onOutlineChange}
          onPageCountChange={props.onPageCountChange}
          onPdfSearchReady={props.onPdfSearchReady}
          onNativeAnnotationReady={props.onPdfNativeAnnotationReady}
          onNativeAnnotationsChange={props.onPdfNativeAnnotationsChange}
          selectedAnnotationId={props.selectedAnnotationId}
          onSelectAnnotation={props.onSelectAnnotation}
          onAddAnnotation={props.onAddAnnotation}
          selectionContextEnabled={props.preferences.pdfKit.enabled}
          onSelectionContextChange={
            props.preferences.pdfKit.enabled ? props.onPdfSelectionContextChange : () => undefined
          }
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
          selectedAnnotationId={props.selectedAnnotationId}
          onSelectAnnotation={props.onSelectAnnotation}
        />
      )}
    </section>
  );
}

function EmptyState(props: {
  recentFiles: RecentFile[];
  onOpen: () => void;
  onOpenRecent: (recent: RecentFile) => void;
  onRecentFilesChange: (recentFiles: RecentFile[]) => void;
  onProtectedPathsLocked: (paths: string[]) => void;
  onRemoveRecent: (path: string) => void;
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
      <RecentLibraryPanel
        recentFiles={props.recentFiles}
        onOpenRecent={props.onOpenRecent}
        onRecentFilesChange={props.onRecentFilesChange}
        onProtectedPathsLocked={props.onProtectedPathsLocked}
        onRemoveRecent={props.onRemoveRecent}
        onClearRecent={props.onClearRecent}
      />
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
  onPdfSearchReady: (bridge?: PdfSearchBridge) => void;
  onNativeAnnotationReady: (bridge?: PdfNativeAnnotationBridge) => void;
  onNativeAnnotationsChange: (annotations: unknown[]) => void;
  selectedAnnotationId: string;
  onSelectAnnotation: (id: string) => void;
  onAddAnnotation: (type?: AnnotationType, context?: AnnotationSelectionContext) => void;
  selectionContextEnabled: boolean;
  onSelectionContextChange: (context?: AnnotationSelectionContext) => void;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const lastScrollRevisionRef = useRef<number | undefined>(undefined);
  const lastSelectionPointerRef = useRef<{ left: number; top: number } | undefined>(undefined);
  const nativeAnnotationsImportKeyRef = useRef("");
  const [viewerUrl, setViewerUrl] = useState<string | undefined>(
    () => props.documentCache.get(props.session.id)?.pdfViewerUrl
  );
  const [viewerRegistry, setViewerRegistry] = useState<PluginRegistry | undefined>();
  const [error, setError] = useState("");
  const nativeAnnotationsImportKey = nativePdfAnnotationImportKey(props.session.id, props.session.nativePdfAnnotations);

  useEffect(() => {
    let disposed = false;
    const cachedDocument = props.documentCache.get(props.session.id);
    const cachedViewerUrl = cachedDocument?.pdfViewerUrl;
    const cachedMetadata = cachedDocument?.pdfMetadata;

    async function loadPdf() {
      setError("");
      setViewerRegistry(undefined);

      if (cachedViewerUrl && cachedMetadata) {
        setViewerUrl(cachedViewerUrl);
        props.onPageCountChange(cachedMetadata.pageCount);
        props.onOutlineChange(cachedMetadata.outline);
        return;
      }

      setViewerUrl(cachedViewerUrl);

      try {
        if (props.session.fileSource.kind === "empty") {
          throw new Error("Missing file source");
        }
        const metadataPromise = loadPdfMetadata(props.session, props.documentCache);
        const data = await readFileSource(props.session.fileSource);
        const nextViewerUrl = createPdfViewerBlobUrl(data);

        if (disposed) {
          URL.revokeObjectURL(nextViewerUrl);
          return;
        }

        props.documentCache.set(props.session.id, {
          ...props.documentCache.get(props.session.id),
          pdfViewerUrl: nextViewerUrl
        });
        setViewerUrl(nextViewerUrl);

        const metadata = await metadataPromise.catch(async () => {
          return {
            id: props.session.filePath ?? props.session.id,
            pageCount: props.session.pageCount ?? 0,
            outline: props.session.outline
          };
        });

        if (disposed) {
          return;
        }
        props.documentCache.set(props.session.id, {
          ...props.documentCache.get(props.session.id),
          pdfMetadata: metadata
        });
        props.onPageCountChange(metadata.pageCount);
        props.onOutlineChange(metadata.outline);
      } catch {
        setError("This PDF could not be rendered.");
      }
    }

    loadPdf();
    return () => {
      disposed = true;
    };
  }, [props.documentCache, props.session.id]);

  useEffect(() => {
    if (!viewerRegistry || props.session.location.kind !== "page") {
      return;
    }

    if (lastScrollRevisionRef.current === props.scrollRevision) {
      return;
    }

    lastScrollRevisionRef.current = props.scrollRevision;
    const frame = window.requestAnimationFrame(() => {
      scrollEmbedPdfViewerToPage(viewerRegistry, props.session.location.kind === "page" ? props.session.location.page : 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.scrollRevision, props.session.id, props.session.location, viewerRegistry]);

  useEffect(() => {
    if (!viewerRegistry) {
      return;
    }

    const scroll = embedPdfScrollCapability(viewerRegistry);
    return scroll?.onPageChange((event) => {
      if (event.totalPages > 0 && props.session.pageCount !== event.totalPages) {
        props.onPageCountChange(event.totalPages);
      }

      if (props.session.location.kind === "page" && props.session.location.page === event.pageNumber) {
        return;
      }

      props.onLocationChange({ kind: "page", page: event.pageNumber });
    });
  }, [props.onLocationChange, props.onPageCountChange, props.session.location, props.session.pageCount, viewerRegistry]);

  useEffect(() => {
    if (!viewerRegistry) {
      return;
    }

    const documentId = embedPdfActiveDocumentId(viewerRegistry);
    if (!documentId) {
      return;
    }

    embedPdfZoomCapability(viewerRegistry)?.forDocument(documentId).requestZoom(
      embedPdfZoomLevel(props.session.fitMode, props.session.zoom)
    );
  }, [props.session.fitMode, props.session.zoom, viewerRegistry]);

  useEffect(() => {
    if (!viewerRegistry) {
      props.onPdfSearchReady(undefined);
      return;
    }

    const search = embedPdfSearchCapability(viewerRegistry);
    const documentId = embedPdfActiveDocumentId(viewerRegistry);
    props.onPdfSearchReady(
      search && documentId
        ? {
            openSearch: () => {
              search.startSearch(documentId);
              search.setShowAllResults(true, documentId);
              return true;
            },
            nextResult: () => {
              search.nextResult(documentId);
              return true;
            },
            previousResult: () => {
              search.previousResult(documentId);
              return true;
            }
          }
        : undefined
    );
    return () => props.onPdfSearchReady(undefined);
  }, [props.onPdfSearchReady, viewerRegistry]);

  useEffect(() => {
    if (!viewerRegistry) {
      props.onNativeAnnotationReady(undefined);
      return;
    }

    const bridge = createEmbedPdfAnnotationBridge(viewerRegistry, (annotations) => {
      nativeAnnotationsImportKeyRef.current = nativePdfAnnotationImportKey(
        props.session.id,
        nativePdfAnnotationSnapshot(annotations)
      );
    });
    props.onNativeAnnotationReady(bridge);
    if (!bridge) {
      return () => props.onNativeAnnotationReady(undefined);
    }

    const persistedAnnotations = nativePdfAnnotationImportItems(props.session.nativePdfAnnotations);
    if (persistedAnnotations.length > 0 && nativeAnnotationsImportKeyRef.current !== nativeAnnotationsImportKey) {
      bridge.importAnnotations(persistedAnnotations);
    }

    const unsubscribe = bridge.subscribeToChanges(() => {
      bridge
        .exportAnnotations()
        .then((envelope) => props.onNativeAnnotationsChange(envelope.annotations))
        .catch(() => undefined);
    });

    return () => {
      unsubscribe();
      props.onNativeAnnotationReady(undefined);
    };
  }, [
    props.onNativeAnnotationReady,
    props.onNativeAnnotationsChange,
    props.session.id,
    nativeAnnotationsImportKey,
    viewerRegistry
  ]);

  useEffect(() => {
    if (!viewerRegistry || !props.selectionContextEnabled) {
      return;
    }

    const selection = embedPdfSelectionCapability(viewerRegistry);
    if (!selection) {
      return;
    }

    const documentId = embedPdfActiveDocumentId(viewerRegistry);
    if (!documentId) {
      return;
    }

    let disposed = false;
    const syncSelectionContext = () => {
      const context = pdfSelectionContextFromEmbedPdfSelection(
        viewerRegistry,
        selection,
        documentId,
        lastSelectionPointerRef.current
      );
      if (!context) {
        props.onSelectionContextChange(undefined);
        return;
      }

      context.then((nextContext) => {
        if (!disposed) {
          props.onSelectionContextChange(nextContext);
        }
      });
    };
    const unsubscribeSelection = selection.onSelectionChange((event) => {
      if (event.documentId !== documentId || !event.selection) {
        props.onSelectionContextChange(undefined);
      }
    });
    const unsubscribeEndSelection = selection.onEndSelection((event) => {
      if (event.documentId === documentId) {
        syncSelectionContext();
      }
    });

    return () => {
      disposed = true;
      unsubscribeSelection();
      unsubscribeEndSelection();
    };
  }, [props.onSelectionContextChange, props.selectionContextEnabled, viewerRegistry]);

  if (error) {
    return <InlineReaderError message={error} />;
  }

  if (!viewerUrl) {
    return <ReaderLoading title={props.session.title} detail="Preparing PDF pages" />;
  }

  const viewerConfig = createEmbedPdfViewerConfig(viewerUrl, props.session, props.preferences);

  return (
    <div
      ref={viewerRef}
      className="pdf-canvas embedpdf-reader-shell"
      onPointerUp={(event) => {
        lastSelectionPointerRef.current = { left: event.clientX, top: event.clientY };
      }}
      onMouseUp={(event) => {
        lastSelectionPointerRef.current = { left: event.clientX, top: event.clientY };
      }}
    >
      <PDFViewer
        key={`${props.session.id}:${viewerUrl}`}
        className="embedpdf-reader"
        config={viewerConfig}
        onReady={setViewerRegistry}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
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
  selectedAnnotationId: string;
  onSelectAnnotation: (id: string) => void;
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

    const index = metadata ? chapterIndexForLocation(metadata.chapters, props.session.location) : -1;
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

    const currentHref =
      props.session.location.kind === "epub" &&
      props.session.location.chapterHref &&
      isSameEpubChapterHref(props.session.location.chapterHref, chapter.href)
        ? props.session.location.chapterHref
        : chapter.href;
    const location = locationForChapter(
      chapter,
      metadata.chapters,
      props.session.location.kind === "epub" ? props.session.location.scrollTop : undefined,
      currentHref,
      props.session.location.kind === "epub" ? props.session.location.chapterLabel : undefined
    );
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
  const visibleChapterAnnotations = useMemo(
    () =>
      activeChapter
        ? props.session.annotations.filter((annotation) =>
            !annotation.hidden && annotation.location.kind === "epub" &&
            annotation.location.chapterHref &&
            isSameEpubChapterHref(annotation.location.chapterHref, activeChapter.href)
          )
        : [],
    [activeChapter?.href, props.session.annotations]
  );
  const highlightedHtml = useMemo(() => {
    if (!activeChapter) {
      return "";
    }

    const searchTarget =
      trimmedSearchQuery &&
      currentSearchChapterHref &&
      isSameEpubChapterHref(currentSearchChapterHref, activeChapter.href)
        ? { query: trimmedSearchQuery, occurrenceIndex: currentSearchMatchIndex }
        : undefined;

    return renderEpubHtml(
      activeChapter.html,
      visibleChapterAnnotations,
      searchTarget,
      props.selectedAnnotationId,
      annotationTitle
    );
  }, [
    activeChapter?.href,
    activeChapter?.html,
    currentSearchChapterHref,
    currentSearchMatchIndex,
    props.selectedAnnotationId,
    trimmedSearchQuery,
    visibleChapterAnnotations
  ]);

  useEffect(() => {
    if (!activeChapter || props.session.location.kind !== "epub" || !props.session.location.chapterHref) {
      return;
    }

    const fragment = epubHrefFragment(props.session.location.chapterHref);
    if (!fragment) {
      return;
    }

    window.requestAnimationFrame(() => {
      const target = surfaceRef.current?.querySelector<HTMLElement>(
        `[id="${cssEscape(fragment)}"], [name="${cssEscape(fragment)}"]`
      );
      target?.scrollIntoView?.({ block: "start" });
    });
  }, [activeChapter?.href, highlightedHtml, props.session.location]);

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
        <div
          className="epub-content"
          onClick={(event) => {
            const target = event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-annotation-id]")
              : undefined;
            if (target?.dataset.annotationId) {
              props.onSelectAnnotation(target.dataset.annotationId);
            }
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
        {visibleChapterAnnotations.length > 0 ? (
          <div className="epub-annotation-anchors" aria-label="Chapter annotations">
            {visibleChapterAnnotations.map((annotation) => (
              <span key={annotation.id} className={`epub-annotation-anchor ${annotation.type}`}>
                {annotationTitle(annotation)}
              </span>
            ))}
          </div>
        ) : null}
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
  pdfMetadata?: PdfDocumentMetadata;
  pdfViewerUrl?: string;
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

function saveRecentFilesWithRetentionPruning(current: RecentFile[], next: RecentFile[]): void {
  const nextPaths = new Set(next.map((file) => file.path));
  const removedProtectedFiles = current.filter((file) =>
    (isLockedRecentFile(file) || Boolean(file.protection)) && !nextPaths.has(file.path)
  );

  if (removedProtectedFiles.length > 0) {
    const nextLibrary = removeRecentLibraryEntriesForDeletedFiles({
      library: loadRecentLibraryMetadata(),
      removedRecentFiles: removedProtectedFiles,
      remainingRecentFiles: next
    });

    saveRecentLibraryMetadata(nextLibrary);
  }

  saveRecentFiles(next);
}

function disposeLoadedReaderDocument(document?: LoadedReaderDocument) {
  if (document?.pdfViewerUrl) {
    URL.revokeObjectURL(document.pdfViewerUrl);
  }

  document?.epub?.chapters.clear();
}

function chapterIndexForLocation(chapters: EpubChapterMetadata[], location: ReaderLocation): number {
  if (location.kind !== "epub" || !location.chapterHref) {
    return 0;
  }

  const index = chapters.findIndex((chapter) => isSameEpubChapterHref(chapter.href, location.chapterHref ?? ""));
  return index >= 0 ? index : 0;
}

function locationForChapter(
  chapter: EpubChapterMetadata,
  chapters: EpubChapterMetadata[],
  scrollTop?: number,
  chapterHref = chapter.href,
  chapterLabel = chapter.label
): ReaderLocation {
  return {
    kind: "epub",
    chapterHref,
    chapterLabel,
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

interface EmbedPdfScrollCapability {
  forDocument: (documentId: string) => {
    getMetrics: () => {
      scrollOffset: {
        x: number;
        y: number;
      };
    };
    getLayout: () => {
      virtualItems: Array<{
        pageLayouts: Array<{
          pageNumber: number;
          height: number;
        }>;
      }>;
    };
    getRectPositionForPage: (pageIndex: number, rect: EmbedPdfRect, scale?: number) => EmbedPdfRect | null;
    scrollToPage: (options: { pageNumber: number; behavior?: "instant" | "smooth" | "auto" }) => void;
  };
  onPageChange: (handler: (event: { documentId: string; pageNumber: number; totalPages: number }) => void) => () => void;
  onScroll: (handler: (event: { documentId: string }) => void) => () => void;
  onLayoutChange: (handler: (event: { documentId: string }) => void) => () => void;
}

interface EmbedPdfDocumentManagerCapability {
  getActiveDocumentId: () => string | null;
}

interface EmbedPdfSearchCapability {
  nextResult: (documentId?: string) => number;
  previousResult: (documentId?: string) => number;
  setShowAllResults: (showAll: boolean, documentId?: string) => void;
  startSearch: (documentId?: string) => void;
  stopSearch: (documentId?: string) => void;
}

interface EmbedPdfTask<T> {
  toPromise: () => Promise<T>;
}

interface EmbedPdfZoomCapability {
  forDocument: (documentId: string) => {
    requestZoom: (level: ZoomLevel) => void;
  };
}

interface PdfSearchBridge {
  openSearch: () => boolean;
  nextResult: () => boolean;
  previousResult: () => boolean;
}

interface PdfNativeAnnotationBridge {
  activateTool: (type: AnnotationType, draft: AnnotationDraft) => boolean;
  exportAnnotations: () => Promise<EmbedPdfAnnotationExportEnvelope>;
  importAnnotations: (items: unknown[]) => void;
  subscribeToChanges: (listener: () => void) => () => void;
}

interface EmbedPdfAnnotationExportEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  annotations: unknown[];
}

interface EmbedPdfAnnotationScope {
  setActiveTool: (toolId: string | null, context?: Record<string, unknown>) => void;
  exportAnnotations: () => EmbedPdfTask<unknown[]>;
  importAnnotations: (items: unknown[]) => void;
  onAnnotationEvent?: (listener: (event: unknown) => void) => () => void;
}

interface EmbedPdfAnnotationCapability {
  forDocument: (documentId: string) => EmbedPdfAnnotationScope;
  setToolDefaults: (toolId: string, patch: Record<string, unknown>) => void;
}

interface EmbedPdfRect {
  origin: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
}

interface EmbedPdfFormattedSelection {
  pageIndex: number;
  rect: EmbedPdfRect;
  segmentRects: EmbedPdfRect[];
}

interface EmbedPdfSelectionCapability {
  getFormattedSelection: (documentId?: string) => EmbedPdfFormattedSelection[];
  getSelectedText: (documentId?: string) => { toPromise(): Promise<string[]> };
  onEndSelection: (handler: (event: { documentId: string; modeId: string }) => void) => () => void;
  onSelectionChange: (handler: (event: { documentId: string; selection: unknown }) => void) => () => void;
}

interface EmbedPdfPlugin<TCapability> {
  id: string;
  provides(): TCapability;
}

function createPdfViewerBlobUrl(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);

  return URL.createObjectURL(new Blob([ownedBytes], { type: "application/pdf" }));
}

function createEmbedPdfViewerConfig(
  src: string,
  session: DocumentSession,
  preferences: Preferences
): PDFViewerConfig {
  return {
    src,
    disabledCategories: ["redaction"],
    fonts: { ui: null, signature: null },
    tabBar: "never",
    theme: {
      preference: preferences.epubTheme,
      light: embedPdfLightThemeColors,
      dark: embedPdfDarkThemeColors
    },
    scroll: {
      defaultStrategy: ScrollStrategy.Vertical,
      defaultBufferSize: session.fitMode === "single" ? 2 : 6,
      defaultPageGap: 12
    },
    annotations: {
      colorPresets: annotationColors,
      autoCommit: true,
      annotationAuthor: "SmartReader",
      deactivateToolAfterCreate: true,
      selectAfterCreate: true,
      editAfterCreate: false
    },
    search: { showAllResults: true },
    selection: { menuHeight: 48, marquee: { enabled: true } },
    zoom: {
      defaultZoomLevel: embedPdfZoomLevel(session.fitMode, session.zoom),
      maxZoom: 3,
      minZoom: 0.5,
      zoomStep: 0.1
    }
  };
}

const embedPdfLightThemeColors = {
  background: {
    app: "#e9e3d8",
    surface: "#fffdf8",
    surfaceAlt: "#f4eee5",
    elevated: "#fffdf8",
    overlay: "rgba(45, 37, 28, 0.28)",
    input: "#fffdf8"
  },
  foreground: {
    primary: "#181713",
    secondary: "#4c4439",
    muted: "#6d665c",
    disabled: "#aaa196",
    onAccent: "#fffdf8"
  },
  border: {
    default: "#cdc3b5",
    subtle: "#e6ded2",
    strong: "#aa9f92"
  },
  accent: {
    primary: "#9b633f",
    primaryHover: "#855333",
    primaryActive: "#6f4329",
    primaryLight: "#f0dfd1",
    primaryForeground: "#fffdf8"
  },
  interactive: {
    hover: "#f4eee5",
    active: "#eadbc9",
    selected: "#f0dfd1",
    focus: "#9b633f",
    focusRing: "rgba(155, 99, 63, 0.28)"
  },
  state: {
    error: "#aa4f2b",
    errorLight: "#fbebe2",
    warning: "#9a6419",
    warningLight: "#f7ead5",
    success: "#5f7f45",
    successLight: "#eef4e6",
    info: "#8b6a42",
    infoLight: "#f4eee5"
  },
  scrollbar: {
    track: "#eee8dd",
    thumb: "#aa9f92",
    thumbHover: "#928a7d"
  },
  tooltip: {
    background: "#3a2a17",
    foreground: "#fffdf8"
  }
};

const embedPdfDarkThemeColors = {
  background: {
    app: "#201a15",
    surface: "#2b241d",
    surfaceAlt: "#352c23",
    elevated: "#3a3027",
    overlay: "rgba(0, 0, 0, 0.5)",
    input: "#241e18"
  },
  foreground: {
    primary: "#f6f2ea",
    secondary: "#d8cec1",
    muted: "#b5aa9b",
    disabled: "#766d62",
    onAccent: "#fffdf8"
  },
  border: {
    default: "#5a4b3d",
    subtle: "#45392e",
    strong: "#8a7663"
  },
  accent: {
    primary: "#d19a75",
    primaryHover: "#e0aa86",
    primaryActive: "#b98462",
    primaryLight: "#4a3426",
    primaryForeground: "#21160f"
  },
  interactive: {
    hover: "#352c23",
    active: "#4a3b2f",
    selected: "#4a3426",
    focus: "#d19a75",
    focusRing: "rgba(209, 154, 117, 0.34)"
  },
  state: {
    error: "#e08b6f",
    errorLight: "#4b2a22",
    warning: "#d8a45f",
    warningLight: "#46331c",
    success: "#9fbe7c",
    successLight: "#2d3b24",
    info: "#d0b38a",
    infoLight: "#403327"
  },
  scrollbar: {
    track: "#2b241d",
    thumb: "#6d5b4a",
    thumbHover: "#8a7663"
  },
  tooltip: {
    background: "#f6f2ea",
    foreground: "#201a15"
  }
};

function embedPdfZoomLevel(fitMode: FitMode, zoom: number): ZoomLevel {
  if (fitMode === "fit-page") {
    return ZoomMode.FitPage;
  }

  if (fitMode === "fit-width") {
    return ZoomMode.FitWidth;
  }

  return zoomForFitMode(fitMode, zoom);
}

function embedPdfActiveDocumentId(registry: PluginRegistry): string | undefined {
  return embedPdfDocumentManagerCapability(registry)?.getActiveDocumentId() ?? undefined;
}

function embedPdfDocumentManagerCapability(
  registry: PluginRegistry
): EmbedPdfDocumentManagerCapability | undefined {
  return registry
    .getPlugin<EmbedPdfPlugin<EmbedPdfDocumentManagerCapability>>(DocumentManagerPlugin.id)
    ?.provides();
}

function embedPdfScrollCapability(registry: PluginRegistry): EmbedPdfScrollCapability | undefined {
  return registry
    .getPlugin<EmbedPdfPlugin<EmbedPdfScrollCapability>>(ScrollPlugin.id)
    ?.provides();
}

function embedPdfSearchCapability(registry: PluginRegistry): EmbedPdfSearchCapability | undefined {
  return registry
    .getPlugin<EmbedPdfPlugin<EmbedPdfSearchCapability>>(SearchPlugin.id)
    ?.provides();
}

function embedPdfAnnotationCapability(registry: PluginRegistry): EmbedPdfAnnotationCapability | undefined {
  return registry
    .getPlugin<EmbedPdfPlugin<EmbedPdfAnnotationCapability>>(AnnotationPlugin.id)
    ?.provides();
}

function embedPdfSelectionCapability(registry: PluginRegistry): EmbedPdfSelectionCapability | undefined {
  return registry
    .getPlugin<EmbedPdfPlugin<EmbedPdfSelectionCapability>>(SelectionPlugin.id)
    ?.provides();
}

function embedPdfZoomCapability(registry: PluginRegistry): EmbedPdfZoomCapability | undefined {
  return registry
    .getPlugin<EmbedPdfPlugin<EmbedPdfZoomCapability>>(ZoomPlugin.id)
    ?.provides();
}

function scrollEmbedPdfViewerToPage(registry: PluginRegistry, pageNumber: number) {
  const documentId = embedPdfActiveDocumentId(registry);
  if (!documentId) {
    return;
  }

  embedPdfScrollCapability(registry)?.forDocument(documentId).scrollToPage({
    pageNumber,
    behavior: "instant"
  });
}

function createEmbedPdfAnnotationBridge(
  registry: PluginRegistry,
  onSnapshotSynced?: (annotations: unknown[]) => void
): PdfNativeAnnotationBridge | undefined {
  const documentId = embedPdfActiveDocumentId(registry);
  const annotation = embedPdfAnnotationCapability(registry);
  if (!documentId || !annotation) {
    return undefined;
  }

  const scope = annotation.forDocument(documentId);

  return {
    activateTool: (type, draft) => {
      const toolId = embedPdfAnnotationToolId(type);
      if (!toolId) {
        return false;
      }

      annotation.setToolDefaults(toolId, embedPdfAnnotationDefaults(type, draft));
      scope.setActiveTool(toolId, {
        smartReaderTag: draft.tag,
        smartReaderNote: draft.note.trim() || undefined
      });
      return true;
    },
    exportAnnotations: async () => {
      const annotations = await scope.exportAnnotations().toPromise();
      onSnapshotSynced?.(annotations);

      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        annotations
      };
    },
    importAnnotations: (items) => {
      scope.importAnnotations(items);
      onSnapshotSynced?.(items);
    },
    subscribeToChanges: (listener) => scope.onAnnotationEvent?.(() => listener()) ?? (() => undefined)
  };
}

function nativePdfAnnotationSnapshot(annotations: unknown[]): NativePdfAnnotationSnapshot | undefined {
  const safeAnnotations = jsonCloneArray(annotations);
  if (!safeAnnotations || safeAnnotations.length === 0) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    annotations: safeAnnotations,
    updatedAt: Date.now()
  };
}

function jsonCloneArray(value: unknown[]): unknown[] | undefined {
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;

    return Array.isArray(cloned) ? cloned : undefined;
  } catch {
    return undefined;
  }
}

function nativePdfAnnotationImportItems(snapshot: NativePdfAnnotationSnapshot | undefined): unknown[] {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.annotations)) {
    return [];
  }

  return snapshot.annotations;
}

function nativePdfAnnotationImportKey(sessionId: string, snapshot: NativePdfAnnotationSnapshot | undefined): string {
  return `${sessionId}:${JSON.stringify(nativePdfAnnotationImportItems(snapshot))}`;
}

function embedPdfAnnotationToolId(type: AnnotationType): string | undefined {
  const toolIds: Record<AnnotationType, string> = {
    highlight: "highlight",
    underline: "underline",
    strike: "strikeout",
    wavy: "squiggly",
    "red-text": "freeText",
    note: "textComment",
    area: "square"
  };

  return toolIds[type];
}

function embedPdfAnnotationDefaults(type: AnnotationType, draft: AnnotationDraft): Record<string, unknown> {
  const color = safeAnnotationColor(draft.color);
  const thickness = safeAnnotationThickness(draft.thickness);

  if (type === "area") {
    return {
      color: "transparent",
      strokeColor: color,
      strokeWidth: thickness
    };
  }

  if (type === "note") {
    return {
      strokeColor: color,
      contents: draft.note.trim()
    };
  }

  if (type === "red-text") {
    return {
      fontColor: color,
      color: "transparent",
      backgroundColor: "transparent",
      contents: draft.note.trim()
    };
  }

  return {
    color,
    strokeColor: color,
    strokeWidth: thickness
  };
}

function pdfSelectionContextFromEmbedPdfSelection(
  registry: PluginRegistry,
  selection: EmbedPdfSelectionCapability,
  documentId: string,
  pointer?: { left: number; top: number }
): Promise<AnnotationSelectionContext | undefined> | undefined {
  const formattedSelection = selection.getFormattedSelection(documentId);
  const selectedPages = new Set(formattedSelection.map((item) => item.pageIndex));

  if (formattedSelection.length === 0 || selectedPages.size !== 1) {
    return;
  }

  return selection.getSelectedText(documentId).toPromise().then((selectedTextItems) => {
    const selectedText = selectedTextItems.join("\n").replace(/\u200b/g, "").trim().slice(0, 500);
    if (!selectedText) {
      return undefined;
    }

    const firstSelection = formattedSelection[0];
    const rects = formattedSelection.flatMap((item) => {
      const sourceRects = item.segmentRects.length > 0 ? item.segmentRects : [item.rect];
      return sourceRects.map((rect) => embedPdfRectToAnnotationRect(registry, documentId, item.pageIndex, rect));
    });
    const area = rects[0];
    const menuPoint = pointer ?? embedPdfSelectionMenuPoint(registry, documentId, firstSelection);

    return {
      selectedText,
      location: { kind: "page" as const, page: firstSelection.pageIndex + 1 },
      menuLeft: menuPoint.left,
      menuTop: menuPoint.top,
      area,
      rects
    };
  }).catch(() => undefined);
}

function embedPdfRectToAnnotationRect(
  registry: PluginRegistry,
  documentId: string,
  pageIndex: number,
  rect: EmbedPdfRect
): NonNullable<ReaderAnnotation["rects"]>[number] {
  const page = pageIndex + 1;
  const pageHeight = embedPdfRenderedPageHeight(registry, documentId, page);

  return {
    page,
    left: roundViewportPoint(rect.origin.x),
    top: roundViewportPoint(rect.origin.y),
    width: roundViewportPoint(rect.size.width),
    height: roundViewportPoint(rect.size.height),
    viewportHeight: pageHeight,
    viewportScale: 1
  };
}

function embedPdfSelectionMenuPoint(
  registry: PluginRegistry,
  documentId: string,
  selection: EmbedPdfFormattedSelection
): { left: number; top: number } {
  const scroll = embedPdfScrollCapability(registry);
  const viewportRect = scroll?.forDocument(documentId).getRectPositionForPage(
    selection.pageIndex,
    selection.rect
  );

  if (!viewportRect) {
    return { left: 48, top: 96 };
  }

  return {
    left: Math.max(12, Math.round(viewportRect.origin.x + viewportRect.size.width / 2)),
    top: Math.max(12, Math.round(viewportRect.origin.y))
  };
}

function embedPdfRenderedPageHeight(
  registry: PluginRegistry,
  documentId: string,
  pageNumber: number
): number | undefined {
  const layout = embedPdfScrollCapability(registry)?.forDocument(documentId).getLayout();
  const pageLayout = layout?.virtualItems
    .flatMap((item) => item.pageLayouts)
    .find((page) => page.pageNumber === pageNumber);

  return pageLayout?.height && Number.isFinite(pageLayout.height) ? roundViewportPoint(pageLayout.height) : undefined;
}

async function loadPdfMetadata(
  session: DocumentSession,
  documentCache: Map<string, LoadedReaderDocument>
): Promise<PdfDocumentMetadata> {
  const cached = documentCache.get(session.id)?.pdfMetadata;
  if (cached) {
    return cached;
  }

  if (session.fileSource.kind !== "desktop-path") {
    throw new Error("Browser-file PDF metadata is resolved after the EmbedPDF document loads");
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
        : document.chapters.find((entry) => isSameEpubChapterHref(entry.href, item.href));

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

function clampZoom(zoom: number): number {
  return Math.min(3, Math.max(0.5, Number(zoom.toFixed(2))));
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
    search: "Search",
    annotations: "Annotations"
  }[mode];
}

function annotationTitle(annotation: ReaderAnnotation): string {
  return readerAnnotationTitle(annotation, locationToStatus(annotation.location));
}

function createAnnotationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `annotation-${globalThis.crypto.randomUUID()}`;
  }

  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultAnnotationArea(location: ReaderLocation): ReaderAnnotation["area"] {
  return location.kind === "page"
    ? {
        page: location.page,
        left: 24,
        top: 24,
        width: 180,
        height: 48
      }
    : undefined;
}

function annotationAreaForType(
  type: AnnotationType,
  location: ReaderLocation,
  context: AnnotationSelectionContext | undefined
): ReaderAnnotation["area"] {
  if (type === "area") {
    return context?.area ?? defaultAnnotationArea(location);
  }

  return location.kind === "page" && isPdfTextMarkupAnnotation(type) ? context?.area : undefined;
}

function annotationRectsForType(
  type: AnnotationType,
  context: AnnotationSelectionContext | undefined
): ReaderAnnotation["rects"] {
  return isPdfTextMarkupAnnotation(type) ? context?.rects : undefined;
}

function isPdfTextMarkupAnnotation(type: AnnotationType): boolean {
  return (
    type === "note" ||
    type === "highlight" ||
    type === "underline" ||
    type === "strike" ||
    type === "wavy" ||
    type === "red-text"
  );
}

function epubSelectionOccurrenceIndex(
  selection: Selection,
  selectedText: string,
  selectionElement: Element | undefined
): number | undefined {
  const content = selectionElement?.closest(".epub-content");
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;

  if (!range || !selectedText) {
    return undefined;
  }

  if (content) {
    try {
      const prefixRange = range.cloneRange();
      prefixRange.selectNodeContents(content);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      return epubAnchorOccurrenceIndex(prefixRange.toString(), selectedText);
    } catch {
      const selectionPrefix = epubTextBeforeSelectionStart(content, selection);

      if (typeof selectionPrefix === "string") {
        return epubAnchorOccurrenceIndex(selectionPrefix, selectedText);
      }

      return epubSelectionOccurrenceIndexFromBoundary(content, range, selectedText);
    }
  }

  const selectionPrefix = epubTextBeforeDetachedSelectionStart(selection);

  return typeof selectionPrefix === "string"
    ? epubAnchorOccurrenceIndex(selectionPrefix, selectedText)
    : undefined;
}

function epubSelectionOccurrenceIndexFromBoundary(
  content: Element,
  range: Range,
  selectedText: string
): number | undefined {
  const prefix = epubTextBeforeRangeStart(content, range);

  if (typeof prefix === "string") {
    return epubAnchorOccurrenceIndex(prefix, selectedText);
  }

  const detachedPrefix = epubTextBeforeDetachedBoundary(range.startContainer, range.startOffset);

  return typeof detachedPrefix === "string"
    ? epubAnchorOccurrenceIndex(detachedPrefix, selectedText)
    : undefined;
}

function epubTextBeforeRangeStart(content: Element, range: Range): string | undefined {
  return epubTextBeforeBoundary(content, range.startContainer, range.startOffset);
}

function epubTextBeforeSelectionStart(content: Element, selection: Selection): string | undefined {
  const boundary = epubSelectionStartBoundary(selection);

  if (boundary) {
    const prefix = epubTextBeforeBoundary(content, boundary.node, boundary.offset);

    if (typeof prefix === "string") {
      return prefix;
    }
  }

  return epubTextBeforeDetachedSelectionStart(selection);
}

function epubTextBeforeDetachedSelectionStart(selection: Selection): string | undefined {
  const boundary = epubSelectionStartBoundary(selection);

  return boundary ? epubTextBeforeDetachedBoundary(boundary.node, boundary.offset) : undefined;
}

function epubSelectionStartBoundary(selection: Selection): { node: Node; offset: number } | undefined {
  const anchorNode = selection.anchorNode;

  if (!anchorNode) {
    return undefined;
  }

  if (selection.focusNode) {
    try {
      const range = document.createRange();
      range.setStart(anchorNode, selection.anchorOffset);
      range.setEnd(selection.focusNode, selection.focusOffset);

      if (
        range.collapsed &&
        (selection.focusNode !== anchorNode || selection.focusOffset !== selection.anchorOffset)
      ) {
        return { node: selection.focusNode, offset: selection.focusOffset };
      }
    } catch {
      return { node: anchorNode, offset: selection.anchorOffset };
    }
  }

  return { node: anchorNode, offset: selection.anchorOffset };
}

function epubTextBeforeDetachedBoundary(startContainer: Node, startOffset: number): string | undefined {
  if (startContainer.nodeType === Node.TEXT_NODE) {
    return (startContainer.nodeValue ?? "").slice(0, startOffset);
  }

  if (startContainer instanceof Element) {
    return Array.from(startContainer.childNodes)
      .slice(0, startOffset)
      .map((node) => node.textContent ?? "")
      .join("");
  }

  return undefined;
}

function epubTextBeforeBoundary(content: Element, startContainer: Node, startOffset: number): string | undefined {
  if (startContainer !== content && !content.contains(startContainer)) {
    return undefined;
  }

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const chunks: string[] = [];
    let node = walker.nextNode();

    while (node) {
      if (node === startContainer) {
        chunks.push((node.nodeValue ?? "").slice(0, startOffset));
        return chunks.join("");
      }

      chunks.push(node.nodeValue ?? "");
      node = walker.nextNode();
    }
  }

  if (startContainer instanceof Element) {
    const prefixRange = content.ownerDocument.createRange();
    prefixRange.selectNodeContents(content);
    prefixRange.setEnd(startContainer, startOffset);
    return prefixRange.toString();
  }

  return undefined;
}

function countTextOccurrences(text: string, query: string): number {
  if (!query) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let count = 0;
  let cursor = normalizedText.indexOf(normalizedQuery);

  while (cursor >= 0) {
    count += 1;
    cursor = normalizedText.indexOf(normalizedQuery, cursor + normalizedQuery.length);
  }

  return count;
}

function epubAnchorOccurrenceIndex(textBeforeSelection: string, selectedText: string): number | undefined {
  const occurrenceIndex = countTextOccurrences(textBeforeSelection.replace(/\u200b/g, ""), selectedText);

  return occurrenceIndex > 0 ? occurrenceIndex : undefined;
}

function roundViewportPoint(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function parseEmbedPdfAnnotationImport(content: string): unknown[] | undefined {
  const payload = JSON.parse(content) as unknown;
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { annotations?: unknown }).annotations)) {
    return (payload as { annotations: unknown[] }).annotations;
  }

  return undefined;
}

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
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
