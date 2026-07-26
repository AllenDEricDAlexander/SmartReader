import { PasswordStatus, SpecialZoomLevel, Worker, Viewer } from '@react-pdf-viewer/core';
import { highlightPlugin, Trigger, type HighlightArea } from '@react-pdf-viewer/highlight';
import type { Match } from '@react-pdf-viewer/search';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  annotationColors,
  defaultAnnotationColor,
  type ReaderAnnotation,
} from '../annotations/annotationModels';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/highlight/lib/styles/index.css';
import '@react-pdf-viewer/page-navigation/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import { PdfPasswordPrompt } from './PdfPasswordPrompt';
import { createRenderRange } from './renderRange';
import type { ViewerController } from './viewerController';
import {
  emptySearchState,
  type ViewerHighlightArea,
  type ViewerHighlightSelection,
  type ViewerLoadError,
  type ViewerProgress,
  type ViewerRestoreState,
  type ViewerSearchMatch,
  type ViewerSearchState,
  type ViewerSelectionKind,
  type ViewerSource,
} from './viewerTypes';

export type PdfRendererProps = {
  fileUrl: string;
  annotations: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onPageChange(page: number, totalPages: number | null): void;
  onZoomChange(zoom: number): void;
  onLoadError?(error: ViewerLoadError): void;
  onSearchStateChange?(state: ViewerSearchState): void;
};

export type PdfRenderer = (props: PdfRendererProps) => JSX.Element;

export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  annotations?: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onProgressChange(progress: ViewerProgress): void;
  loadingTimeoutMs?: number;
  onLoadError?(error: ViewerLoadError): void;
  onSearchStateChange?(state: ViewerSearchState): void;
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
  onSearchStateChange,
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
      onSearchStateChange={onSearchStateChange}
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
  onSearchStateChange,
  controller,
  renderer,
}: {
  source: ViewerSource;
  annotations: ReaderAnnotation[];
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onProgressChange(progress: ViewerProgress): void;
  loadingTimeoutMs: number;
  onLoadError?(error: ViewerLoadError): void;
  onSearchStateChange?(state: ViewerSearchState): void;
  controller?: ViewerController;
  renderer?: PdfRenderer;
}) {
  const currentPageRef = useRef(1);
  const totalPageCountRef = useRef<number | null>(null);
  const currentZoomRef = useRef(1);
  const hasReportedLoadRef = useRef(false);
  const onLoadErrorRef = useRef(onLoadError);
  const onProgressChangeRef = useRef(onProgressChange);
  const [loadError, setLoadError] = useState<ViewerLoadError | null>(null);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
    onProgressChangeRef.current = onProgressChange;
  }, [onLoadError, onProgressChange]);

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

  // A document asking for a password has responded — it is waiting on the user,
  // not hung. Without this the watchdog fires while the password is being typed
  // and reports a perfectly good file as broken.
  const handlePasswordRequired = useCallback(() => {
    hasReportedLoadRef.current = true;
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

  // Progress reporting feeds app state, which re-renders this subtree. Keeping
  // these callbacks stable stops that feedback from reaching the viewer as new
  // props on every scrolled page.
  const reportProgress = useCallback(() => {
    onProgressChangeRef.current({
      sessionId: source.sessionId,
      page: currentPageRef.current,
      totalPages: totalPageCountRef.current,
      zoom: currentZoomRef.current,
    });
  }, [source.sessionId]);

  const reportPage = useCallback(
    (page: number, totalPages: number | null) => {
      hasReportedLoadRef.current = true;
      currentPageRef.current = page;
      totalPageCountRef.current = totalPages;
      reportProgress();
    },
    [reportProgress],
  );

  const reportZoom = useCallback(
    (zoom: number) => {
      hasReportedLoadRef.current = true;
      currentZoomRef.current = zoom;
      reportProgress();
    },
    [reportProgress],
  );

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
      jumpToMatch: () => undefined,
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
      onSearchStateChange,
    });
  }

  return (
    <ReactPdfViewer
      fileUrl={source.url}
      restore={source.restore}
      annotations={annotations}
      controller={controller}
      onHighlightSelection={onHighlightSelection}
      onPageChange={reportPage}
      onZoomChange={reportZoom}
      onLoadError={handleLoadError}
      onPasswordRequired={handlePasswordRequired}
      onSearchStateChange={onSearchStateChange}
    />
  );
}

const ReactPdfViewer = memo(function ReactPdfViewer({
  fileUrl,
  restore,
  annotations,
  onHighlightSelection,
  controller,
  onPageChange,
  onZoomChange,
  onLoadError,
  onPasswordRequired,
  onSearchStateChange,
}: PdfRendererProps & {
  restore?: ViewerRestoreState;
  controller?: ViewerController;
  onLoadError?(error: ViewerLoadError): void;
  onPasswordRequired?(): void;
}) {
  // The viewer opens directly at the restored position. Rendering page 1 and
  // jumping afterwards costs a wasted render and shows the wrong page first.
  const initialPage = Math.max(0, (restore?.page ?? 1) - 1);
  const renderRange = useMemo(() => createRenderRange(), []);
  const scaleRef = useRef(1);
  const searchStateRef = useRef<ViewerSearchState>(emptySearchState);
  const onSearchStateChangeRef = useRef(onSearchStateChange);
  const onHighlightSelectionRef = useRef(onHighlightSelection);

  useEffect(() => {
    onSearchStateChangeRef.current = onSearchStateChange;
    onHighlightSelectionRef.current = onHighlightSelection;
  }, [onSearchStateChange, onHighlightSelection]);

  // These plugin factories are themselves React hooks: each one calls useMemo
  // internally to build its store, so the store already survives re-renders and
  // the factory must be called unconditionally here. Wrapping them in useMemo
  // would break the Rules of Hooks. Re-render churn is instead kept away from
  // this component by the memo() boundary below.
  const toolbarPluginInstance = toolbarPlugin({
    pageNavigationPlugin: { enableShortcuts: false },
    searchPlugin: { enableShortcuts: false },
    zoomPlugin: { enableShortcuts: false },
  });
  const { pageNavigationPluginInstance, searchPluginInstance, zoomPluginInstance } =
    toolbarPluginInstance;
  // Selection callbacks are read through a ref so a changing handler identity
  // never has to reach this component as a new prop.
  const highlightPluginInstance = highlightPlugin({
    trigger: Trigger.TextSelection,
    renderHighlightTarget: (props) => (
      <SelectionMarkupMenu
        left={props.selectionRegion.left}
        top={props.selectionRegion.top + props.selectionRegion.height}
        onApply={(kind, color) => {
          onHighlightSelectionRef.current?.({
            selectedText: props.selectedText,
            page: props.selectionRegion.pageIndex + 1,
            areas: props.highlightAreas.map(mapHighlightArea),
            kind,
            color,
          });
          props.cancel();
        }}
        onDismiss={props.cancel}
      />
    ),
    renderHighlights: (props) => (
      <>
        {annotations
          .flatMap((annotation) =>
            annotation.areas.map((area) => ({
              area,
              color: annotation.color,
              type: annotation.type,
            })),
          )
          .filter(({ area }) => area.pageIndex === props.pageIndex)
          .map(({ area, color, type }, index) => (
            <div
              key={`${area.pageIndex}-${area.top}-${area.left}-${index}`}
              className={`reader-highlight reader-highlight-${type}`}
              style={{
                ...props.getCssProperties(area, props.rotation),
                // An underline only paints its baseline, so it uses a border
                // instead of a fill; a note marks its anchor with a soft tint.
                ...(type === 'underline'
                  ? { borderBottom: `2px solid ${color}` }
                  : { background: color }),
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

    const publishSearchState = (state: ViewerSearchState) => {
      searchStateRef.current = state;
      onSearchStateChangeRef.current?.(state);
    };

    // `jumpToMatch` is 1-based and wraps at both ends, so the focused index is
    // tracked here and fed back in rather than inferred from the returned match.
    const focusMatch = (index: number) => {
      const { matches } = searchStateRef.current;

      if (matches.length === 0) {
        return;
      }

      const wrapped = ((index - 1 + matches.length) % matches.length) + 1;
      searchPluginInstance.jumpToMatch(wrapped);
      publishSearchState({ ...searchStateRef.current, currentIndex: wrapped });
    };

    controller.bind({
      jumpToPage: (page) => pageNavigationPluginInstance.jumpToPage(Math.max(0, page - 1)),
      // SmartReader owns the find UI, so opening search focuses the reader's own
      // search field rather than the plugin's popover, which keeps a separate
      // keyword and match count that would contradict the toolbar.
      openSearch: () => undefined,
      search: (keyword) => {
        const trimmed = keyword.trim();

        if (!trimmed) {
          searchPluginInstance.clearHighlights();
          publishSearchState(emptySearchState);
          return;
        }

        void searchPluginInstance.highlight(trimmed).then((matches) => {
          publishSearchState({
            keyword: trimmed,
            matches: matches.map(toSearchMatch),
            currentIndex: matches.length > 0 ? 1 : 0,
          });
        });
      },
      searchNext: () => focusMatch(searchStateRef.current.currentIndex + 1),
      searchPrevious: () => focusMatch(searchStateRef.current.currentIndex - 1),
      jumpToMatch: (index) => focusMatch(index),
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

  const plugins = [toolbarPluginInstance, highlightPluginInstance];

  return (
    <div className="pdf-viewer-bridge">
      <Worker workerUrl="/pdf.worker.min.js">
        <Viewer
          fileUrl={fileUrl}
          plugins={plugins}
          initialPage={initialPage}
          defaultScale={restore?.zoom}
          setRenderRange={renderRange}
          renderLoader={(percentage) => (
            <div className="viewer-loading" role="status">
              Loading PDF {Math.round(percentage)}%
            </div>
          )}
          renderError={(error) => (
            <ReactPdfLoadError errorMessage={error.message} onLoadError={onLoadError} />
          )}
          onDocumentAskPassword={onPasswordRequired}
          renderProtectedView={({ passwordStatus, verifyPassword }) => (
            <PdfPasswordPrompt
              status={passwordStatus === PasswordStatus.WrongPassword ? 'wrong' : 'required'}
              onSubmit={verifyPassword}
            />
          )}
          onDocumentLoad={(event) =>
            // Report the page actually opened. Reporting a hard-coded 1 here
            // overwrote the restored reading position on every open.
            onPageChange(Math.min(initialPage + 1, event.doc.numPages), event.doc.numPages)
          }
          onPageChange={(event) => onPageChange(event.currentPage + 1, event.doc.numPages)}
          onZoom={(event) => {
            scaleRef.current = event.scale;
            onZoomChange(event.scale);
          }}
        />
      </Worker>
    </div>
  );
});

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

const selectionActions: { kind: ViewerSelectionKind; label: string }[] = [
  { kind: 'highlight', label: '高亮' },
  { kind: 'underline', label: '下划线' },
  { kind: 'note', label: '笔记' },
];

/**
 * Markup menu shown next to a text selection. It lets the reader pick a colour
 * and choose between a highlight, an underline, or a note anchored to the
 * selected text, instead of always producing the same yellow highlight.
 */
function SelectionMarkupMenu({
  left,
  top,
  onApply,
  onDismiss,
}: {
  /** Position of the selection within the page, in percent. */
  left: number;
  top: number;
  onApply(kind: ViewerSelectionKind, color: string): void;
  onDismiss(): void;
}) {
  const [color, setColor] = useState(defaultAnnotationColor);

  return (
    <div
      className="selection-markup-menu"
      role="group"
      aria-label="标注所选文本"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <div className="selection-markup-colors">
        {annotationColors.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              option.value === color
                ? 'selection-color-swatch selected'
                : 'selection-color-swatch'
            }
            style={{ backgroundColor: option.value }}
            aria-label={option.label}
            aria-pressed={option.value === color}
            onClick={() => setColor(option.value)}
          />
        ))}
      </div>
      <div className="selection-markup-actions">
        {selectionActions.map((action) => (
          <button
            key={action.kind}
            type="button"
            className="selection-markup-action"
            onClick={() => onApply(action.kind, color)}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          className="selection-markup-action ghost"
          aria-label="取消标注"
          onClick={onDismiss}
        >
          取消
        </button>
      </div>
    </div>
  );
}

const excerptPadding = 40;

/**
 * Builds a result-list entry from a viewer match. `highlight()` returns matches
 * in document order, so the array position doubles as the 1-based global index
 * that `jumpToMatch` expects.
 */
function toSearchMatch(match: Match, position: number): ViewerSearchMatch {
  const start = Math.max(0, match.startIndex - excerptPadding);
  const end = Math.min(match.pageText.length, match.endIndex + excerptPadding);
  const excerpt = match.pageText.slice(start, end).replace(/\s+/g, ' ').trim();

  return {
    index: position + 1,
    page: match.pageIndex + 1,
    excerpt: `${start > 0 ? '…' : ''}${excerpt}${end < match.pageText.length ? '…' : ''}`,
  };
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
