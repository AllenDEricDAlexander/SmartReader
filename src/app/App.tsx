import { FileText, FolderOpen, PanelLeftClose, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BlobUrlCache } from '../cache/blobUrlCache';
import { CommandRegistry, defaultShortcuts } from '../commands/commandRegistry';
import { handleShortcutEvent } from '../commands/shortcutController';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import { getPdfFilesFromDrop } from '../platform/dropZone';
import { getDocumentKey, type FileSource } from '../platform/fileSource';
import { createTauriBridge, type TauriBridge } from '../platform/tauriBridge';
import { PdfViewerBridge, type PdfRenderer } from '../viewer/PdfViewerBridge';
import { ViewerController, type ViewerActions } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';

type AppProps = {
  bridge?: TauriBridge;
  viewerController?: ViewerActions;
  viewerRenderer?: PdfRenderer;
};

export function App({ bridge = createTauriBridge(), viewerController, viewerRenderer }: AppProps) {
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const blobUrlCache = useMemo(() => new BlobUrlCache(), []);
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;
  const bridgeViewerController =
    activeViewerController instanceof ViewerController
      ? activeViewerController
      : defaultViewerController;

  const activeSession =
    documents.sessions.find((session) => session.id === documents.activeSessionId) ?? null;

  const openBytes = (source: FileSource, bytes: Uint8Array) => {
    setDocuments((current) => {
      const next = addDocumentSession(current, source);
      const documentKey = getDocumentKey(source);
      const session = next.sessions.find((candidate) => candidate.documentKey === documentKey);

      if (session) {
        const url = blobUrlCache.createForSession(session.id, bytes);
        setViewerSource({ sessionId: session.id, url });
      }

      return next;
    });
  };

  const openPdf = async () => {
    const opened = await bridge.openNativePdf();

    if (!opened) {
      return;
    }

    openBytes(opened.source, opened.bytes);
  };

  const closeActiveTab = () => {
    if (!activeSession) {
      return;
    }

    blobUrlCache.revokeForSession(activeSession.id);
    setDocuments((current) => closeDocumentSession(current, activeSession.id));
    setViewerSource(null);
  };

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
      id: 'history.back',
      label: 'History Back',
      shortcut: defaultShortcuts.historyBack,
      run: () => undefined,
    });
    registry.register({
      id: 'history.forward',
      label: 'History Forward',
      shortcut: defaultShortcuts.historyForward,
      run: () => undefined,
    });
    registry.register({
      id: 'tab.next',
      label: 'Next Tab',
      shortcut: defaultShortcuts.nextTab,
      run: () => undefined,
    });
    registry.register({
      id: 'tab.previous',
      label: 'Previous Tab',
      shortcut: defaultShortcuts.previousTab,
      run: () => undefined,
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

    openBytes(
      {
        kind: 'browser-file',
        file,
        name: file.name,
      },
      new Uint8Array(await file.arrayBuffer()),
    );
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
        <button type="button" aria-label="Find in PDF">
          <Search size={16} />
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
              <p>{Math.round(activeSession.progress * 100)}% complete</p>
            ) : (
              <p>No document selected</p>
            )}
          </aside>
        ) : null}

        <section className="viewer-pane">
          {activeSession ? (
            <PdfViewerBridge
              source={viewerSource}
              controller={bridgeViewerController}
              renderer={viewerRenderer}
              onProgressChange={(progress) => {
                setDocuments((current) =>
                  updateSessionProgress(current, progress.sessionId, {
                    page: progress.page,
                    totalPages: progress.totalPages,
                    zoom: progress.zoom,
                  }),
                );
              }}
            />
          ) : (
            <section className="empty-reader" aria-label="SmartReader empty reader">
              <p className="eyebrow">SmartReader</p>
              <h1>Open a PDF to start reading</h1>
              <p>Use the file picker, drag a PDF here, or open one from the desktop app menu.</p>
            </section>
          )}
        </section>
      </section>
    </main>
  );
}
