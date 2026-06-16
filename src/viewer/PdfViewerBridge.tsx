import { SpecialZoomLevel, Worker, Viewer } from '@react-pdf-viewer/core';
import { highlightPlugin, Trigger, type HighlightArea } from '@react-pdf-viewer/highlight';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { useEffect, useRef } from 'react';
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
  ViewerProgress,
  ViewerSource,
} from './viewerTypes';

export type PdfRendererProps = {
  fileUrl: string;
  annotations: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onPageChange(page: number, totalPages: number | null): void;
  onZoomChange(zoom: number): void;
};

export type PdfRenderer = (props: PdfRendererProps) => JSX.Element;

export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  annotations?: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onProgressChange(progress: ViewerProgress): void;
  controller?: ViewerController;
  renderer?: PdfRenderer;
};

export function PdfViewerBridge({
  source,
  annotations = [],
  onHighlightSelection,
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
      annotations={annotations}
      controller={controller}
      renderer={renderer}
      onHighlightSelection={onHighlightSelection}
      onProgressChange={onProgressChange}
    />
  );
}

function ActivePdfViewerBridge({
  source,
  annotations,
  onHighlightSelection,
  onProgressChange,
  controller,
  renderer,
}: {
  source: ViewerSource;
  annotations: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
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

  if (renderer) {
    return renderer({
      fileUrl: source.url,
      annotations,
      onHighlightSelection,
      onPageChange: reportPage,
      onZoomChange: reportZoom,
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
}: PdfRendererProps & { controller?: ViewerController }) {
  const scaleRef = useRef(1);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarPluginInstance = toolbarPlugin({
    pageNavigationPlugin: { enableShortcuts: false },
    searchPlugin: { enableShortcuts: false },
    zoomPlugin: { enableShortcuts: false },
  });
  const {
    pageNavigationPluginInstance,
    searchPluginInstance,
    zoomPluginInstance,
    Toolbar,
  } = toolbarPluginInstance;
  const highlightPluginInstance = highlightPlugin({
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
  });

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

function mapHighlightArea(area: HighlightArea): ViewerHighlightArea {
  return {
    pageIndex: area.pageIndex,
    top: area.top,
    left: area.left,
    height: area.height,
    width: area.width,
  };
}
