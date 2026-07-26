import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';
import { ViewerController } from './viewerController';

const pdfViewerCoreMock = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'error',
  errorMessage: 'Mock PDF failure',
}));

vi.mock('@react-pdf-viewer/core', async () => {
  const React = await import('react');

  return {
    SpecialZoomLevel: {
      PageFit: 'PageFit',
      PageWidth: 'PageWidth',
    },
    Viewer: (props: {
      renderError(error: { message?: string }): React.ReactElement;
    }) =>
      pdfViewerCoreMock.mode === 'error'
        ? props.renderError({ message: pdfViewerCoreMock.errorMessage })
        : React.createElement('div', null, 'Real PDF viewer'),
    Worker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@react-pdf-viewer/toolbar', async () => {
  const React = await import('react');
  const Button = ({ label }: { label: string }) =>
    React.createElement('button', { type: 'button' }, label);

  return {
    toolbarPlugin: () => {
      React.useRef(null);

      return {
        pageNavigationPluginInstance: { jumpToPage: vi.fn() },
        searchPluginInstance: {
          highlight: vi.fn(),
          jumpToNextMatch: vi.fn(),
          jumpToPreviousMatch: vi.fn(),
        },
        zoomPluginInstance: { zoomTo: vi.fn() },
        Toolbar: ({ children }: { children(slots: Record<string, unknown>): React.ReactNode }) =>
          React.createElement(
            'div',
            null,
            children({
              CurrentPageInput: () =>
                React.createElement('input', { 'aria-label': 'Current page' }),
              GoToNextPage: () => React.createElement(Button, { label: 'Next page' }),
              GoToPreviousPage: () => React.createElement(Button, { label: 'Previous page' }),
              NumberOfPages: ({
                children: renderPages,
              }: {
                children(props: { numberOfPages: number }): React.ReactNode;
              }) => React.createElement('span', null, renderPages({ numberOfPages: 1 })),
              ShowSearchPopover: ({
                children: renderSearch,
              }: {
                children(props: { onClick(): void }): React.ReactNode;
              }) => React.createElement('span', null, renderSearch({ onClick: vi.fn() })),
              Zoom: () => React.createElement('span', null, '100%'),
              ZoomIn: () => React.createElement(Button, { label: 'Zoom in' }),
              ZoomOut: () => React.createElement(Button, { label: 'Zoom out' }),
            }),
          ),
      };
    },
  };
});

vi.mock('@react-pdf-viewer/highlight', async () => {
  const React = await import('react');

  return {
    highlightPlugin: () => {
      const pluginRef = React.useRef({});

      return pluginRef.current;
    },
    Trigger: {
      TextSelection: 'TextSelection',
    },
  };
});

describe('PdfViewerBridge', () => {
  afterEach(() => {
    pdfViewerCoreMock.mode = 'ready';
    pdfViewerCoreMock.errorMessage = 'Mock PDF failure';
  });

  it('shows an empty message without a source', () => {
    render(<PdfViewerBridge source={null} onProgressChange={vi.fn()} />);

    expect(screen.getByText('No PDF selected')).toBeInTheDocument();
  });

  it('passes source and callbacks to the renderer', () => {
    const renderer: PdfRenderer = ({
      annotations,
      fileUrl,
      onHighlightSelection,
      onPageChange,
      onZoomChange,
    }) => (
      <button
        type="button"
        onClick={() => {
          onPageChange(4, 10);
          onZoomChange(1.25);
          onHighlightSelection?.({
            selectedText: annotations[0]?.quote ?? '',
            page: 4,
            areas: [{ pageIndex: 3, top: 1, left: 2, height: 3, width: 4 }],
            kind: 'highlight',
            color: '#facc15',
          });
        }}
      >
        Render {fileUrl}
      </button>
    );
    const onProgressChange = vi.fn();
    const onHighlightSelection = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        annotations={[
          {
            id: 1,
            documentKey: 'desktop:/tmp/book.pdf',
            page: 4,
            type: 'highlight',
            color: '#facc15',
            text: null,
            quote: 'Selected text',
            areas: [{ pageIndex: 3, top: 1, left: 2, height: 3, width: 4 }],
            createdAt: '2026-06-16T00:00:00Z',
            updatedAt: '2026-06-16T00:00:00Z',
          },
        ]}
        renderer={renderer}
        onHighlightSelection={onHighlightSelection}
        onProgressChange={onProgressChange}
      />,
    );

    screen.getByText('Render blob:book').click();

    expect(onProgressChange).toHaveBeenCalledWith({
      sessionId: 'session-a',
      page: 4,
      totalPages: 10,
      zoom: 1.25,
    });
    expect(onHighlightSelection).toHaveBeenCalledWith({
      selectedText: 'Selected text',
      page: 4,
      areas: [{ pageIndex: 3, top: 1, left: 2, height: 3, width: 4 }],
      kind: 'highlight',
      color: '#facc15',
    });
  });

  it('reports document load progress with total pages', () => {
    const renderer: PdfRenderer = ({ onPageChange, onZoomChange }) => (
      <button
        type="button"
        onClick={() => {
          onPageChange(2, 12);
          onZoomChange(1.5);
        }}
      >
        Load
      </button>
    );
    const onProgressChange = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={onProgressChange}
      />,
    );

    screen.getByRole('button', { name: 'Load' }).click();

    expect(onProgressChange).toHaveBeenLastCalledWith({
      sessionId: 'session-a',
      page: 2,
      totalPages: 12,
      zoom: 1.5,
    });
  });

  it('shows a recoverable timeout instead of spinning forever', async () => {
    vi.useFakeTimers();
    const renderer: PdfRenderer = () => <div>Loading forever</div>;
    const onLoadError = vi.fn();

    try {
      render(
        <PdfViewerBridge
          source={{ sessionId: 'session-a', url: 'blob:book' }}
          renderer={renderer}
          loadingTimeoutMs={1000}
          onLoadError={onLoadError}
          onProgressChange={vi.fn()}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByRole('alert')).toHaveTextContent('PDF loading timed out');
      expect(onLoadError).toHaveBeenCalledWith({
        status: 'timeout',
        message: 'PDF loading timed out',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not call react-pdf-viewer plugin hooks from inside built-in hooks', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(
        <PdfViewerBridge
          source={{ sessionId: 'session-a', url: 'blob:book' }}
          onProgressChange={vi.fn()}
        />,
      );

      const hookWarnings = consoleError.mock.calls.filter((call) =>
        call.some(
          (entry) =>
            typeof entry === 'string' &&
            entry.includes('Do not call Hooks inside useEffect'),
        ),
      );

      expect(hookWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not replace a real PDF load error with a later timeout', async () => {
    vi.useFakeTimers();
    pdfViewerCoreMock.mode = 'error';
    pdfViewerCoreMock.errorMessage = 'Invalid PDF bytes';
    const onLoadError = vi.fn();

    try {
      render(
        <PdfViewerBridge
          source={{ sessionId: 'session-a', url: 'blob:book' }}
          loadingTimeoutMs={1000}
          onLoadError={onLoadError}
          onProgressChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('PDF failed to load');
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid PDF bytes');

      expect(onLoadError).toHaveBeenCalledWith({
        status: 'error',
        message: 'Invalid PDF bytes',
      });

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      expect(screen.getByRole('alert')).toHaveTextContent('PDF failed to load');
      expect(screen.getByRole('alert')).not.toHaveTextContent('PDF loading timed out');
      expect(onLoadError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('binds and clears a provided viewer controller', () => {
    const renderer: PdfRenderer = () => <div>Rendered PDF</div>;
    const controller = new ViewerController();
    const { unmount } = render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        controller={controller}
        onProgressChange={vi.fn()}
      />,
    );

    expect(controller.fitPage()).toBe(true);

    unmount();

    expect(controller.fitPage()).toBe(false);
  });
});
