import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import JSZip from "jszip";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  createEmptySession,
  createSessionFromFile,
  updateSessionFitMode,
  updateSessionLocation,
  updateSessionSidebarMode,
  updateSessionZoom
} from "./state/documentSessions";
import { createCommandRegistry, shortcutFromKeyboardEvent } from "./state/commandRegistry";
import type { CommandId } from "./state/commandRegistry";
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
import {
  createDesktopSession,
  listenForDesktopOpenFiles,
  openDesktopFileDialog,
  openEpubDocument,
  openPendingDesktopFiles,
  readEpubChapter,
  readFileSource,
  searchEpubDocument,
  setupTauriMenu
} from "./platform/tauriBridge";
import type { DesktopEpubDocument } from "./platform/tauriBridge";
import { createAccessErrorSession, isTauriRuntime } from "./platform/fileSources";
import type {
  Bookmark,
  DocumentSession,
  FitMode,
  OutlineItem,
  Preferences,
  ReaderLocation,
  RecentFile,
  SearchResult,
  SidebarMode
} from "./types/reader";

const defaultPreferences: Preferences = {
  reopenLastSession: true,
  rememberPosition: true,
  defaultSidebarVisible: true,
  defaultPdfFitMode: "continuous",
  epubFontSize: 18,
  epubTheme: "system",
  recentRetention: 12
};

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
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecentFiles());
  const documentCacheRef = useRef(new Map<string, LoadedReaderDocument>());
  const hudTimerRef = useRef<number | undefined>(undefined);
  const sessionsRef = useRef<DocumentSession[]>(initialAppState.sessions);
  const isDesktop = isTauriRuntime();

  const activeSession = sessions.find((session) => session.id === activeTabId);
  const activeLocationKey = activeSession ? JSON.stringify(activeSession.location) : "";

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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
    setSessions((current) => {
      const next = current.some((item) => item.status === "empty")
        ? current.map((item) => (item.id === activeTabId && item.status === "empty" ? session : item))
        : [...current, session];

      return next;
    });
    setActiveTabId(session.id);
    recordSessionRecent(session);
  }, [activeTabId, recordSessionRecent]);

  const openDesktopPath = useCallback(async (path: string) => {
    const session = await createDesktopSession(path);
    addSession(session);
  }, [addSession]);
  openDesktopPathRef.current = openDesktopPath;

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

  const closeTab = useCallback((tabId = activeTabId) => {
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === tabId);
      const closingSession = current[index];

      if (!closingSession) {
        return current;
      }

      disposeSessionResources(closingSession, documentCacheRef.current.get(tabId));
      documentCacheRef.current.delete(tabId);

      if (current.length === 1) {
        const empty = createEmptySession();
        setActiveTabId(empty.id);
        searchAdapterRef.current = async () => [];
        return [empty];
      }

      const next = current.filter((session) => session.id !== tabId);
      if (tabId === activeTabId) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
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

  const resetZoom = useCallback(() => {
    updateActiveSession((session) => updateSessionZoom(session, 1));
    showHud("100%");
  }, [showHud, updateActiveSession]);

  const toggleBookmark = useCallback(() => {
    updateActiveSession((session) => {
      const existing = session.bookmarks.find((bookmark) =>
        sameLocation(bookmark.location, session.location)
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

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      updateActiveSession((session) => ({ ...session, searchResults: [] }));
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchAdapterRef.current(query.trim());
      updateActiveSession((session) => ({
        ...session,
        sidebarMode: "search",
        searchResults: results
      }));
      setSidebarOpen(true);
    } finally {
      setIsSearching(false);
    }
  }, [updateActiveSession]);

  const handleLocationChange = useCallback((location: ReaderLocation) => {
    updateActiveSession((session) => updateSessionLocation(session, location));
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
          findNext: () => showHud("Next result"),
          findPrevious: () => showHud("Previous result"),
          zoomIn: () => zoomBy(0.1),
          zoomOut: () => zoomBy(-0.1),
          resetZoom,
          toggleBookmark,
          openPreferences: () => setPreferencesOpen(true),
          focusLocationInput: () => locationInputRef.current?.focus(),
          navigateBack: () => showHud("Back"),
          navigateForward: () => showHud("Forward")
        }
      }),
    [activeSession, closeTab, createNewTab, openFilePicker, resetZoom, showHud, toggleBookmark, zoomBy]
  );

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
    if (activeSession?.status !== "ready") {
      searchAdapterRef.current = async () => [];
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
        onFitMode={(fitMode) => updateActiveSession((session) => updateSessionFitMode(session, fitMode))}
        onLocationSubmit={(location) => {
          updateActiveSession((session) => updateSessionLocation(session, location));
          showHud(locationToStatus(location, activeSession?.pageCount));
        }}
      />

      {findOpen ? (
        <FindBar
          query={findQuery}
          isSearching={isSearching}
          onChange={setFindQuery}
          onSubmit={() => runSearch(findQuery)}
          onClose={() => setFindOpen(false)}
        />
      ) : null}

      <section className={`reader-workspace ${sidebarOpen ? "with-sidebar" : ""}`}>
        {sidebarOpen ? (
          <ReaderSidebar
            session={activeSession}
            onModeChange={(mode) => updateActiveSession((session) => updateSessionSidebarMode(session, mode))}
            onJump={(location) => updateActiveSession((session) => updateSessionLocation(session, location))}
          />
        ) : null}

        <ReaderViewport
          session={activeSession}
          recentFiles={recentFiles}
          preferences={preferences}
          documentCache={documentCacheRef.current}
          onOpen={openFilePicker}
          onOpenRecent={async (recent) => {
            if (recent.access === "desktop-path" && isDesktop) {
              await openDesktopPath(recent.path);
              return;
            }

            addSession(createAccessErrorSession(recent.path));
          }}
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
          onOutlineChange={(outline) => updateActiveSession((session) => ({ ...session, outline }))}
          onPageCountChange={(pageCount) => updateActiveSession((session) => ({ ...session, pageCount }))}
          onSearchReady={(handler) => {
            searchAdapterRef.current = handler;
          }}
        />
      </section>

      {hud ? <div className="reader-hud">{hud}</div> : null}

      {preferencesOpen ? (
        <PreferencesDialog
          preferences={preferences}
          onChange={setPreferences}
          onClose={() => setPreferencesOpen(false)}
          onClearRecent={() => {
            const next = clearRecentFiles();
            saveRecentFiles(next);
            setRecentFiles(next);
          }}
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
        disabled={!hasDocument}
        onClick={() => undefined}
      />
      <ToolbarButton
        className="history-control"
        label="Forward"
        icon="forward"
        disabled={!hasDocument}
        onClick={() => undefined}
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
  onClose: () => void;
}) {
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
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
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
      <div className="sidebar-content">
        <SidebarRows session={props.session} mode={mode} onJump={props.onJump} />
      </div>
    </aside>
  );
}

function SidebarRows(props: {
  session?: DocumentSession;
  mode: SidebarMode;
  onJump: (location: ReaderLocation) => void;
}) {
  const session = props.session;

  if (!session || session.status !== "ready") {
    return <p className="empty-note">Open a PDF or EPUB to show navigation.</p>;
  }

  if (props.mode === "contents") {
    if (session.outline.length === 0) {
      return <p className="empty-note">No outline in this document.</p>;
    }

    return session.outline.map((item) => (
      <button
        key={item.id}
        className={`sidebar-row ${sameLocation(item.location, session.location) ? "active" : ""}`}
        type="button"
        style={{ paddingLeft: `${12 + (item.level ?? 0) * 14}px` }}
        onClick={() => props.onJump(item.location)}
      >
        {item.title}
      </button>
    ));
  }

  if (props.mode === "thumbnails") {
    if (session.format !== "pdf") {
      return <p className="empty-note">Thumbnails are available for PDFs.</p>;
    }

    return Array.from({ length: Math.min(session.pageCount ?? 0, 24) }, (_, index) => (
      <button
        key={index}
        className={`thumbnail-row ${session.location.kind === "page" && session.location.page === index + 1 ? "active" : ""}`}
        type="button"
        onClick={() => props.onJump({ kind: "page", page: index + 1 })}
      >
        <span className="thumbnail-box">{index + 1}</span>
        <span>Page {index + 1}</span>
      </button>
    ));
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

  return session.searchResults.map((result, index) => (
    <button
      key={result.id}
      className="search-result-row"
      type="button"
      aria-label={`${result.label}, result ${index + 1}: ${result.snippet}`}
      onClick={() => props.onJump(result.location)}
    >
      <strong>{result.label}</strong>
      <span>{result.snippet}</span>
    </button>
  ));
}

function ReaderViewport(props: {
  session?: DocumentSession;
  recentFiles: RecentFile[];
  preferences: Preferences;
  documentCache: Map<string, LoadedReaderDocument>;
  onOpen: () => void;
  onOpenRecent: (recent: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
  onLocationChange: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onPageCountChange: (pageCount: number) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>) => void;
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
    <section className="reader-viewport" tabIndex={0} aria-label={`${session.title} reader`}>
      {session.format === "pdf" ? (
        <PdfReader
          session={session}
          documentCache={props.documentCache}
          onLocationChange={props.onLocationChange}
          onOutlineChange={props.onOutlineChange}
          onPageCountChange={props.onPageCountChange}
          onSearchReady={props.onSearchReady}
        />
      ) : (
        <EpubReader
          session={session}
          preferences={props.preferences}
          documentCache={props.documentCache}
          onLocationChange={props.onLocationChange}
          onOutlineChange={props.onOutlineChange}
          onSearchReady={props.onSearchReady}
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
  documentCache: Map<string, LoadedReaderDocument>;
  onLocationChange: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onPageCountChange: (pageCount: number) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | undefined>(
    () => props.documentCache.get(props.session.id)?.pdf
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    const cached = props.documentCache.get(props.session.id)?.pdf;

    async function loadPdf() {
      setError("");

      if (cached) {
        setPdf(cached);
        props.onPageCountChange(cached.numPages);
        props.onSearchReady((query) => searchPdf(cached, query));
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
        props.onPageCountChange(loaded.numPages);
        props.onOutlineChange(await outlineFromPdf(loaded));
        props.onSearchReady((query) => searchPdf(loaded, query));
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
    if (!pdf || props.session.fitMode === "single" || props.session.location.kind !== "page") {
      return;
    }

    window.requestAnimationFrame(() => {
      const pageFrame = canvasRef.current?.querySelector<HTMLElement>(
        `[data-page-number="${props.session.location.kind === "page" ? props.session.location.page : 1}"]`
      );
      pageFrame?.scrollIntoView?.({ block: "start" });
    });
  }, [pdf, props.session.id]);

  const handleVisiblePage = useCallback((pageNumber: number) => {
    props.onLocationChange({ kind: "page", page: pageNumber });
  }, [props.onLocationChange]);

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

  return (
    <div ref={canvasRef} className="pdf-canvas">
      {pageNumbers.map((pageNumber) => (
        <PdfPage
          key={`${props.session.id}-${pageNumber}`}
          pdf={pdf}
          pageNumber={pageNumber}
          zoom={zoomForFitMode(props.session.fitMode, props.session.zoom)}
          renderImmediately={props.session.fitMode === "single" || Math.abs(pageNumber - currentPage) <= 1}
          onVisiblePage={handleVisiblePage}
        />
      ))}
    </div>
  );
}

function PdfPage(props: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  renderImmediately: boolean;
  onVisiblePage: (pageNumber: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
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

    async function renderPage() {
      if (!shouldRender) {
        return;
      }

      setLoading(true);
      setError("");
      try {
        const page = await props.pdf.getPage(props.pageNumber);
        if (cancelled) {
          return;
        }
        await renderPdfPage(page, canvasRef.current, props.zoom);
        setLoading(false);
      } catch {
        setError("Page render failed.");
        setLoading(false);
      }
    }

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [props.pageNumber, props.pdf, props.zoom, shouldRender]);

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
      className="pdf-page-frame"
      data-page-number={props.pageNumber}
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
      <canvas ref={canvasRef} />
      <span className="page-number">{props.pageNumber}</span>
    </article>
  );
}

function EpubReader(props: {
  session: DocumentSession;
  preferences: Preferences;
  documentCache: Map<string, LoadedReaderDocument>;
  onLocationChange: (location: ReaderLocation) => void;
  onOutlineChange: (outline: OutlineItem[]) => void;
  onSearchReady: (handler: (query: string) => Promise<SearchResult[]>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const metadataRequestRef = useRef(0);
  const chapterRequestRef = useRef(0);
  const pendingLocalChapterHrefRef = useRef<string | undefined>(undefined);
  const cachedEpub = props.documentCache.get(props.session.id)?.epub;
  const cachedMetadata = cachedEpub?.metadata;
  const [error, setError] = useState("");
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
      pendingLocalChapterHrefRef.current = chapter.href;
    }

    setActiveChapterIndex(index);
  }, [metadata]);

  useEffect(() => {
    let disposed = false;
    const requestId = ++metadataRequestRef.current;
    pendingLocalChapterHrefRef.current = undefined;

    async function loadEpub() {
      setError("");
      setActiveChapter(undefined);

      const cached = props.documentCache.get(props.session.id)?.epub;
      if (cached?.metadata) {
        const activeIndex = chapterIndexForLocation(cached.metadata.chapters, props.session.location);
        setMetadata(cached.metadata);
        setActiveChapterIndex(activeIndex);
        setActiveChapter(cached.chapters.get(cached.metadata.chapters[activeIndex]?.href ?? ""));
        props.onOutlineChange(cached.metadata.outline);
        props.onSearchReady(createEpubSearchHandler(props.session.fileSource, cached));
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
        props.onSearchReady(createEpubSearchHandler(props.session.fileSource, loaded));
      } catch {
        if (!disposed && requestId === metadataRequestRef.current) {
          setError("This EPUB could not be rendered.");
        }
      }
    }

    loadEpub();
    return () => {
      disposed = true;
      metadataRequestRef.current += 1;
    };
  }, [props.documentCache, props.session.id]);

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
      containerRef.current?.scrollTo?.({ top: 0 });
    }
  }, [metadata, props.session.location]);

  useEffect(() => {
    const chapter = metadata?.chapters[activeChapterIndex];

    if (!chapter) {
      return;
    }

    props.onLocationChange({
      kind: "epub",
      chapterHref: chapter.href,
      chapterLabel: chapter.label,
      progress: metadata.chapters.length > 1 ? activeChapterIndex / (metadata.chapters.length - 1) : 0
    });
  }, [activeChapterIndex, metadata]);

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
        props.onSearchReady(createEpubSearchHandler(props.session.fileSource, epub));
      })
      .catch(() => {
        if (!disposed && requestId === chapterRequestRef.current) {
          setError("This EPUB could not be rendered.");
        }
      });

    return () => {
      disposed = true;
      chapterRequestRef.current += 1;
    };
  }, [activeChapterIndex, metadata, props.documentCache, props.session.fileSource, props.session.id]);

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
  const chapterPercent = readingProgressPercent({
    kind: "epub",
    chapterHref: chapter.href,
    chapterLabel: chapter.label,
    progress: metadata.chapters.length > 1 ? activeChapterIndex / (metadata.chapters.length - 1) : 0
  });

  return (
    <div
      className={`epub-surface theme-${props.session.epubSettings.theme}`}
      style={{ fontSize: props.session.epubSettings.fontSize || props.preferences.epubFontSize }}
    >
      <article ref={containerRef} className="epub-renderer">
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
        <div className="epub-content" dangerouslySetInnerHTML={{ __html: chapter.html }} />
      </article>
    </div>
  );
}

function PreferencesDialog(props: {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
  onClearRecent: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="preferences-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h1 id="preferences-title">Preferences</h1>
          <button type="button" aria-label="Close preferences" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="preferences-grid">
          <fieldset>
            <legend>General</legend>
            <label>
              <input
                type="checkbox"
                checked={props.preferences.reopenLastSession}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, reopenLastSession: event.currentTarget.checked })
                }
              />
              Reopen last session
            </label>
            <label>
              <input
                type="checkbox"
                checked={props.preferences.rememberPosition}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, rememberPosition: event.currentTarget.checked })
                }
              />
              Remember position
            </label>
            <label>
              <input
                type="checkbox"
                checked={props.preferences.defaultSidebarVisible}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, defaultSidebarVisible: event.currentTarget.checked })
                }
              />
              Show sidebar by default
            </label>
          </fieldset>
          <fieldset>
            <legend>Reading</legend>
            <label>
              PDF default fit
              <select
                value={props.preferences.defaultPdfFitMode}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, defaultPdfFitMode: event.currentTarget.value as FitMode })
                }
              >
                <option value="continuous">Continuous</option>
                <option value="fit-width">Fit Width</option>
                <option value="fit-page">Fit Page</option>
                <option value="actual-size">Actual Size</option>
              </select>
            </label>
            <label>
              EPUB font size
              <input
                type="number"
                min="14"
                max="28"
                value={props.preferences.epubFontSize}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, epubFontSize: Number(event.currentTarget.value) })
                }
              />
            </label>
            <label>
              EPUB theme
              <select
                value={props.preferences.epubTheme}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, epubTheme: event.currentTarget.value as Preferences["epubTheme"] })
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>Files</legend>
            <label>
              Recent retention
              <input
                type="number"
                min="4"
                max="30"
                value={props.preferences.recentRetention}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, recentRetention: Number(event.currentTarget.value) })
                }
              />
            </label>
            <button type="button" onClick={props.onClearRecent}>
              Clear recent files
            </button>
          </fieldset>
          <fieldset>
            <legend>Shortcuts</legend>
            <p>⌘O open, ⌘F find, ⌘B sidebar, ⌘D bookmark, ⌘L location, ⌘1-9 tabs.</p>
          </fieldset>
        </div>
      </section>
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

function InlineReaderError(props: { message: string }) {
  return (
    <div className="inline-reader-error">
      <Icon name="warning" />
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
}

interface EpubDocumentMetadata {
  id: string;
  title?: string;
  chapters: EpubChapterMetadata[];
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
  epub?: EpubDocumentCache;
}

function disposeSessionResources(session: DocumentSession | undefined, document?: LoadedReaderDocument) {
  disposeLoadedReaderDocument(document);

  const objectUrl = session?.objectUrl ?? (session?.fileSource.kind === "browser-file" ? session.fileSource.objectUrl : undefined);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
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

let pdfJsModule: Promise<typeof import("pdfjs-dist")> | undefined;

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
    text: chapter.text
  };
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
  const results = await searchEpubDocument(path, query, 50);

  return results.map((result) => ({
    id: result.id,
    label: result.label,
    snippet: result.snippet,
    location: {
      kind: "epub",
      chapterHref: result.href,
      chapterLabel: result.label,
      progress: result.progress
    }
  }));
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
      text: ""
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
        text: body?.textContent?.replace(/\s+/g, " ").trim() ?? ""
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
  const lowerQuery = query.toLowerCase();

  return chapters.flatMap((chapter, index) => {
    const matchIndex = chapter.text.toLowerCase().indexOf(lowerQuery);

    if (matchIndex < 0) {
      return [];
    }

    return [
      {
        id: `epub-search-${chapter.id}-${matchIndex}`,
        label: chapter.label,
        snippet: chapter.text.slice(Math.max(0, matchIndex - 40), matchIndex + query.length + 60),
        location: {
          kind: "epub",
          chapterHref: chapter.href,
          chapterLabel: chapter.label,
          progress: chapters.length > 1 ? index / (chapters.length - 1) : 0
        }
      }
    ];
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderPdfPage(page: PDFPageProxy, canvas: HTMLCanvasElement | null, zoom: number) {
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

  await page.render({ canvas, canvasContext: context, viewport }).promise;
}

async function searchPdf(pdf: PDFDocumentProxy, query: string): Promise<SearchResult[]> {
  const normalizedQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    const index = text.toLowerCase().indexOf(normalizedQuery);

    if (index >= 0) {
      results.push({
        id: `search-${pageNumber}-${index}`,
        label: `Page ${pageNumber}`,
        snippet: text.slice(Math.max(0, index - 40), index + query.length + 60),
        location: { kind: "page", page: pageNumber }
      });
    }

    if (results.length >= 50) {
      break;
    }
  }

  return results;
}

function sameLocation(first: ReaderLocation, second: ReaderLocation): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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

function chapterProgressLabel(index: number, total: number): string {
  return total > 0 ? `Chapter ${index + 1} of ${total}` : "Chapter";
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
    thumbnails: "Thumbs",
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
