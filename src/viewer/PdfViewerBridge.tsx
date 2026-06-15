import { SpecialZoomLevel, Worker, Viewer } from '@react-pdf-viewer/core';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { useEffect, useMemo, useRef } from 'react';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/page-navigation/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import type { ViewerController } from './viewerController';
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
  controller?: ViewerController;
  renderer?: PdfRenderer;
};

export function PdfViewerBridge({
  source,
  onProgressChange,
  controller,
  renderer,
}: PdfViewerBridgeProps) {
  if (!source) {
    return <div className="viewer-empty">No PDF selected</div>;
  }

  return (
    <ActivePdfViewerBridge
      source={source}
      controller={controller}
      renderer={renderer}
      onProgressChange={onProgressChange}
    />
  );
}

function ActivePdfViewerBridge({
  source,
  onProgressChange,
  controller,
  renderer,
}: {
  source: ViewerSource;
  onProgressChange(progress: ViewerProgress): void;
  controller?: ViewerController;
  renderer?: PdfRenderer;
}) {
  const currentPageRef = useRef(1);
  const totalPageCountRef = useRef<number | null>(null);
  const currentZoomRef = useRef(1);

  const reportPage = (page: number, totalPages: number | null) => {
    currentPageRef.current = page;
    totalPageCountRef.current = totalPages;
    onProgressChange({
      sessionId: source.sessionId,
      page: currentPageRef.current,
      totalPages: totalPageCountRef.current,
      zoom: currentZoomRef.current,
    });
  };

  const reportZoom = (zoom: number) => {
    currentZoomRef.current = zoom;
    onProgressChange({
      sessionId: source.sessionId,
      page: currentPageRef.current,
      totalPages: totalPageCountRef.current,
      zoom: currentZoomRef.current,
    });
  };

  useEffect(() => {
    if (!renderer || !controller) {
      return undefined;
    }

    controller.bind({
      jumpToPage: () => undefined,
      searchNext: () => undefined,
      searchPrevious: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      fitWidth: () => undefined,
      fitPage: () => undefined,
    });

    return () => controller.clear();
  }, [controller, renderer]);

  if (renderer) {
    return renderer({
      fileUrl: source.url,
      onPageChange: reportPage,
      onZoomChange: reportZoom,
    });
  }

  return (
    <ReactPdfViewer
      fileUrl={source.url}
      controller={controller}
      onPageChange={reportPage}
      onZoomChange={reportZoom}
    />
  );
}

function ReactPdfViewer({
  fileUrl,
  controller,
  onPageChange,
  onZoomChange,
}: PdfRendererProps & { controller?: ViewerController }) {
  const scaleRef = useRef(1);
  const toolbarPluginInstance = useMemo(
    () =>
      toolbarPlugin({
        pageNavigationPlugin: { enableShortcuts: false },
        searchPlugin: { enableShortcuts: false },
        zoomPlugin: { enableShortcuts: false },
      }),
    [],
  );
  const {
    pageNavigationPluginInstance,
    searchPluginInstance,
    zoomPluginInstance,
    Toolbar,
  } = toolbarPluginInstance;

  useEffect(() => {
    if (!controller) {
      return undefined;
    }

    controller.bind({
      jumpToPage: (page) => pageNavigationPluginInstance.jumpToPage(Math.max(0, page - 1)),
      searchNext: () => {
        searchPluginInstance.jumpToNextMatch();
      },
      searchPrevious: () => {
        searchPluginInstance.jumpToPreviousMatch();
      },
      zoomIn: () => {
        zoomPluginInstance.zoomTo(Math.min(3, scaleRef.current + 0.1));
      },
      zoomOut: () => {
        zoomPluginInstance.zoomTo(Math.max(0.3, scaleRef.current - 0.1));
      },
      fitWidth: () => zoomPluginInstance.zoomTo(SpecialZoomLevel.PageWidth),
      fitPage: () => zoomPluginInstance.zoomTo(SpecialZoomLevel.PageFit),
    });

    return () => controller.clear();
  }, [controller, pageNavigationPluginInstance, searchPluginInstance, zoomPluginInstance]);

  return (
    <div className="pdf-viewer-bridge">
      <div className="viewer-plugin-toolbar">
        <Toolbar>
          {(slots) => {
            const CurrentPageInput = slots.CurrentPageInput;
            const GoToNextPage = slots.GoToNextPage;
            const GoToPreviousPage = slots.GoToPreviousPage;
            const NumberOfPages = slots.NumberOfPages;
            const ShowSearchPopover = slots.ShowSearchPopover;
            const Zoom = slots.Zoom;
            const ZoomIn = slots.ZoomIn;
            const ZoomOut = slots.ZoomOut;

            return (
              <div className="viewer-plugin-toolbar-inner">
                <GoToPreviousPage />
                <CurrentPageInput />
                <NumberOfPages>
                  {({ numberOfPages }) => (
                    <span className="viewer-page-count">/ {numberOfPages}</span>
                  )}
                </NumberOfPages>
                <GoToNextPage />
                <ShowSearchPopover />
                <ZoomOut />
                <Zoom />
                <ZoomIn />
              </div>
            );
          }}
        </Toolbar>
      </div>
      <Worker workerUrl="/pdf.worker.min.js">
        <Viewer
          fileUrl={fileUrl}
          plugins={[toolbarPluginInstance]}
          onPageChange={(event) => onPageChange(event.currentPage + 1, null)}
          onZoom={(event) => {
            scaleRef.current = event.scale;
            onZoomChange(event.scale);
          }}
        />
      </Worker>
    </div>
  );
}
