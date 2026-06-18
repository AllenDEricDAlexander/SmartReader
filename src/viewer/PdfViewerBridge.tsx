import { SpecialZoomLevel, Worker, Viewer } from '@react-pdf-viewer/core';
import { highlightPlugin, Trigger, type HighlightArea } from '@react-pdf-viewer/highlight';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/highlight/lib/styles/index.css';
import '@react-pdf-viewer/page-navigation/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import type { ViewerController } from './viewerController';
import type {
  ViewerHighlightArea,
  ViewerHighlightSelection,
  ViewerLoadError,
  ViewerProgress,
  ViewerSource,
} from './viewerTypes';

export type PdfRendererProps = {
  fileUrl: string;
  annotations: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onPageChange(page: number, totalPages: number | null): void;
  onZoomChange(zoom: number): void;
  onLoadError?(error: ViewerLoadError): void;
};

export type PdfRenderer = (props: PdfRendererProps) => JSX.Element;

export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  annotations?: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onProgressChange(progress: ViewerProgress): void;
  loadingTimeoutMs?: number;
  onLoadError?(error: ViewerLoadError): void;
  controller?: ViewerController;
  renderer?: PdfRenderer;
};

export function PdfViewerBridge({
  source,
  annotations = [],
  onHighlightSelection,
  onProgressChange,
  loadingTimeoutMs = 15000,
  onLoadError,
  controller,
  renderer,
}: PdfViewerBridgeProps) {
  if (!source) {
    return <div className="viewer-empty">No PDF selected</div>;
  }

  return (
    <ActivePdfViewerBridge
      source={source}
      annotations={annotations}
      controller={controller}
      renderer={renderer}
      onHighlightSelection={onHighlightSelection}
      onProgressChange={onProgressChange}
      loadingTimeoutMs={loadingTimeoutMs}
      onLoadError={onLoadError}
    />
  );
}

function ActivePdfViewerBridge({
  source,
  annotations,
  onHighlightSelection,
  onProgressChange,
  loadingTimeoutMs,
  onLoadError,
  controller,
  renderer,
}: {
  source: ViewerSource;
  annotations: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onProgressChange(progress: ViewerProgress): void;
  loadingTimeoutMs: number;
  onLoadError?(error: ViewerLoadError): void;
  controller?: ViewerController;
  renderer?: PdfRenderer;
}) {
  const currentPageRef = useRef(1);
  const totalPageCountRef = useRef<number | null>(null);
  const currentZoomRef = useRef(1);
  const hasReportedLoadRef = useRef(false);
  const onLoadErrorRef = useRef(onLoadError);
  const [loadError, setLoadError] = useState<ViewerLoadError | null>(null);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useLayoutEffect(() => {
    currentPageRef.current = 1;
    totalPageCountRef.current = null;
    currentZoomRef.current = 1;
    hasReportedLoadRef.current = false;
    setLoadError(null);
  }, [source.sessionId, source.url]);

  const handleLoadError = useCallback((error: ViewerLoadError) => {
    hasReportedLoadRef.current = true;
    setLoadError(error);
    onLoadErrorRef.current?.(error);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (hasReportedLoadRef.current) {
        return;
      }

      const timeoutError: ViewerLoadError = {
        status: 'timeout',
        message: 'PDF loading timed out',
      };
      handleLoadError(timeoutError);
    }, loadingTimeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [source.sessionId, source.url, loadingTimeoutMs, handleLoadError]);

  const reportPage = (page: number, totalPages: number | null) => {
    hasReportedLoadRef.current = true;
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
    hasReportedLoadRef.current = true;
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
      openSearch: () => undefined,
      search: () => undefined,
      searchNext: () => undefined,
      searchPrevious: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      fitWidth: () => undefined,
      fitPage: () => undefined,
    });

    return () => controller.clear();
  }, [controller, renderer]);

  if (loadError) {
    const isTimeout = loadError.status === 'timeout';

    return (
      <section className="viewer-load-error" role="alert">
        <h2>{isTimeout ? 'PDF loading timed out' : 'PDF failed to load'}</h2>
        <p>
          {isTimeout
            ? 'The PDF viewer did not finish loading this document.'
            : loadError.message}
        </p>
      </section>
    );
  }

  if (renderer) {
    return renderer({
      fileUrl: source.url,
      annotations,
      onHighlightSelection,
      onPageChange: reportPage,
      onZoomChange: reportZoom,
      onLoadError: handleLoadError,
    });
  }

  return (
    <ReactPdfViewer
      fileUrl={source.url}
      annotations={annotations}
      controller={controller}
      onHighlightSelection={onHighlightSelection}
      onPageChange={reportPage}
      onZoomChange={reportZoom}
      onLoadError={handleLoadError}
    />
  );
}

function ReactPdfViewer({
  fileUrl,
  annotations,
  onHighlightSelection,
  controller,
  onPageChange,
  onZoomChange,
  onLoadError,
}: PdfRendererProps & {
  controller?: ViewerController;
  onLoadError?(error: ViewerLoadError): void;
}) {
  const scaleRef = useRef(1);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const highlightPluginInstance = useMemo(
    () =>
      highlightPlugin({
        trigger: Trigger.TextSelection,
        renderHighlightTarget: (props) => (
          <button
            type="button"
            className="highlight-target"
            onClick={() => {
              onHighlightSelection?.({
                selectedText: props.selectedText,
                page: props.selectionRegion.pageIndex + 1,
                areas: props.highlightAreas.map(mapHighlightArea),
              });
              props.cancel();
            }}
          >
            Save highlight
          </button>
        ),
        renderHighlights: (props) => (
          <>
            {annotations
              .flatMap((annotation) =>
                annotation.areas.map((area) => ({ area, color: annotation.color })),
              )
              .filter(({ area }) => area.pageIndex === props.pageIndex)
              .map(({ area, color }, index) => (
                <div
                  key={`${area.pageIndex}-${area.top}-${area.left}-${index}`}
                  className="reader-highlight"
                  style={{
                    ...props.getCssProperties(area, props.rotation),
                    background: color,
                  }}
                />
              ))}
          </>
        ),
      }),
    [annotations, onHighlightSelection],
  );

  useEffect(() => {
    if (!controller) {
      return undefined;
    }

    controller.bind({
      jumpToPage: (page) => pageNavigationPluginInstance.jumpToPage(Math.max(0, page - 1)),
      openSearch: () => {
        searchButtonRef.current?.click();
      },
      search: (keyword) => {
        void searchPluginInstance.highlight(keyword);
      },
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
                <ShowSearchPopover>
                  {(props) => (
                    <button
                      ref={searchButtonRef}
                      type="button"
                      aria-label="Search in PDF"
                      onClick={props.onClick}
                    >
                      Search
                    </button>
                  )}
                </ShowSearchPopover>
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
          plugins={[toolbarPluginInstance, highlightPluginInstance]}
          renderLoader={(percentage) => (
            <div className="viewer-loading" role="status">
              Loading PDF {Math.round(percentage)}%
            </div>
          )}
          renderError={(error) => (
            <ReactPdfLoadError errorMessage={error.message} onLoadError={onLoadError} />
          )}
          onDocumentLoad={(event) => onPageChange(1, event.doc.numPages)}
          onPageChange={(event) => onPageChange(event.currentPage + 1, event.doc.numPages)}
          onZoom={(event) => {
            scaleRef.current = event.scale;
            onZoomChange(event.scale);
          }}
        />
      </Worker>
    </div>
  );
}

function ReactPdfLoadError({
  errorMessage,
  onLoadError,
}: {
  errorMessage?: string;
  onLoadError?(error: ViewerLoadError): void;
}) {
  const message = errorMessage ?? 'PDF failed to load';

  useEffect(() => {
    onLoadError?.({ status: 'error', message });
  }, [message, onLoadError]);

  return (
    <section className="viewer-load-error" role="alert">
      <h2>PDF failed to load</h2>
      <p>{message}</p>
    </section>
  );
}

function mapHighlightArea(area: HighlightArea): ViewerHighlightArea {
  return {
    pageIndex: area.pageIndex,
    top: area.top,
    left: area.left,
    height: area.height,
    width: area.width,
  };
}
