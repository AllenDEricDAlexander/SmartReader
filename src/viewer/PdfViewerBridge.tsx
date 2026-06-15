import { Worker, Viewer } from '@react-pdf-viewer/core';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { searchPlugin } from '@react-pdf-viewer/search';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import type { ViewerProgress, ViewerSource } from './viewerTypes';

export type PdfRendererProps = {
  fileUrl: string;
  onPageChange(page: number, totalPages: number | null): void;
  onZoomChange(zoom: number): void;
};

export type PdfRenderer = (props: PdfRendererProps) => JSX.Element;

export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  onProgressChange(progress: ViewerProgress): void;
  renderer?: PdfRenderer;
};

export function PdfViewerBridge({ source, onProgressChange, renderer }: PdfViewerBridgeProps) {
  if (!source) {
    return <div className="viewer-empty">No PDF selected</div>;
  }

  let currentPage = 1;
  let totalPageCount: number | null = null;
  let currentZoom = 1;

  const reportPage = (page: number, totalPages: number | null) => {
    currentPage = page;
    totalPageCount = totalPages;
    onProgressChange({
      sessionId: source.sessionId,
      page: currentPage,
      totalPages: totalPageCount,
      zoom: currentZoom,
    });
  };

  const reportZoom = (zoom: number) => {
    currentZoom = zoom;
    onProgressChange({
      sessionId: source.sessionId,
      page: currentPage,
      totalPages: totalPageCount,
      zoom: currentZoom,
    });
  };

  if (renderer) {
    return renderer({
      fileUrl: source.url,
      onPageChange: reportPage,
      onZoomChange: reportZoom,
    });
  }

  return <ReactPdfViewer fileUrl={source.url} onPageChange={reportPage} onZoomChange={reportZoom} />;
}

function ReactPdfViewer({ fileUrl, onPageChange, onZoomChange }: PdfRendererProps) {
  pageNavigationPlugin();
  searchPlugin();
  toolbarPlugin();
  zoomPlugin();

  return (
    <Worker workerUrl="/pdf.worker.min.js">
      <Viewer
        fileUrl={fileUrl}
        onPageChange={(event) => onPageChange(event.currentPage + 1, null)}
        onZoom={(event) => onZoomChange(event.scale)}
      />
    </Worker>
  );
}
