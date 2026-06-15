import { FileText, FolderOpen, PanelLeftClose, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BlobUrlCache } from '../cache/blobUrlCache';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import { getDocumentKey } from '../platform/fileSource';
import { createTauriBridge, type TauriBridge } from '../platform/tauriBridge';
import { PdfViewerBridge, type PdfRenderer } from '../viewer/PdfViewerBridge';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';

type AppProps = {
  bridge?: TauriBridge;
  viewerController?: ViewerController;
  viewerRenderer?: PdfRenderer;
};

export function App({ bridge = createTauriBridge(), viewerController, viewerRenderer }: AppProps) {
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const blobUrlCache = useMemo(() => new BlobUrlCache(), []);
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;

  const activeSession =
    documents.sessions.find((session) => session.id === documents.activeSessionId) ?? null;

  const openPdf = async () => {
    const opened = await bridge.openNativePdf();

    if (!opened) {
      return;
    }

    setDocuments((current) => {
      const next = addDocumentSession(current, opened.source);
      const documentKey = getDocumentKey(opened.source);
      const session = next.sessions.find((candidate) => candidate.documentKey === documentKey);

      if (session) {
        const url = blobUrlCache.createForSession(session.id, opened.bytes);
        setViewerSource({ sessionId: session.id, url });
      }

      return next;
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

  return (
    <main className="app-shell">
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
              controller={activeViewerController}
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
