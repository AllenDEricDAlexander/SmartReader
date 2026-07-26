import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';
import { ViewerController } from './viewerController';

const pdfViewerCoreMock = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'error' | 'password',
  errorMessage: 'Mock PDF failure',
  lastViewerProps: null as Record<string, unknown> | null,
  verifyPassword: vi.fn(),
}));

vi.mock('@react-pdf-viewer/core', async () => {
  const React = await import('react');

  return {
    SpecialZoomLevel: {
      PageFit: 'PageFit',
      PageWidth: 'PageWidth',
    },
    PasswordStatus: {
      RequiredPassword: 'RequiredPassword',
      WrongPassword: 'WrongPassword',
    },
    Viewer: (props: {
      renderError(error: { message?: string }): React.ReactElement;
      renderProtectedView(p: {
        passwordStatus: string;
        verifyPassword(password: string): void;
      }): React.ReactElement;
      onDocumentAskPassword?(): void;
    }) => {
      pdfViewerCoreMock.lastViewerProps = props as unknown as Record<string, unknown>;
      const askPassword = props.onDocumentAskPassword;
      React.useEffect(() => {
        if (pdfViewerCoreMock.mode === 'password') {
          askPassword?.();
        }
      }, [askPassword]);

      if (pdfViewerCoreMock.mode === 'error') {
        return props.renderError({ message: pdfViewerCoreMock.errorMessage });
      }
      if (pdfViewerCoreMock.mode === 'password') {
        return props.renderProtectedView({
          passwordStatus: 'RequiredPassword',
          verifyPassword: pdfViewerCoreMock.verifyPassword,
        });
      }
      return React.createElement('div', null, 'Real PDF viewer');
    },
    Worker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

const pdfViewerSearchMock = vi.hoisted(() => ({
  highlight: vi.fn().mockResolvedValue([]),
  clearHighlights: vi.fn(),
  jumpToMatch: vi.fn(),
  jumpToNextMatch: vi.fn(),
  jumpToPreviousMatch: vi.fn(),
}));

vi.mock('@react-pdf-viewer/toolbar', async () => {
  const React = await import('react');
  const Button = ({ label }: { label: string }) =>
    React.createElement('button', { type: 'button' }, label);

  return {
    toolbarPlugin: () => {
      React.useRef(null);

      return {
        pageNavigationPluginInstance: { jumpToPage: vi.fn() },
        searchPluginInstance: pdfViewerSearchMock,
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
    pdfViewerSearchMock.highlight.mockClear();
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

  it('prompts for a password instead of waiting for the load watchdog', async () => {
    vi.useFakeTimers();
    pdfViewerCoreMock.mode = 'password';
    const onLoadError = vi.fn();

    try {
      render(
        <PdfViewerBridge
          source={{ sessionId: 'session-a', url: 'blob:locked' }}
          loadingTimeoutMs={1000}
          onLoadError={onLoadError}
          onProgressChange={vi.fn()}
        />,
      );

      // Well past the watchdog: an encrypted document is waiting on the user,
      // so it must not be reported as a failed load.
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(onLoadError).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('文档密码')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards a typed password to the viewer', () => {
    pdfViewerCoreMock.mode = 'password';
    pdfViewerCoreMock.verifyPassword.mockClear();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:locked' }}
        onProgressChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('PDF 密码'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: '解锁文档' }));

    expect(pdfViewerCoreMock.verifyPassword).toHaveBeenCalledWith('hunter2');
  });

  it('reports embedded document metadata after load', async () => {
    const onDocumentInfo = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        onProgressChange={vi.fn()}
        onDocumentInfo={onDocumentInfo}
      />,
    );

    const onDocumentLoad = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: {
      doc: unknown;
    }) => void;

    await act(async () => {
      onDocumentLoad({
        doc: {
          numPages: 86,
          getMetadata: () =>
            Promise.resolve({
              info: { PDFFormatVersion: '1.7', Author: '张明', Keywords: 'AI, ML' },
            }),
        },
      });
    });

    expect(onDocumentInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-a',
        pageCount: 86,
        pdfVersion: '1.7',
        author: '张明',
        keywords: 'AI, ML',
        subject: null,
      }),
    );
  });

  it('still opens a document whose metadata cannot be read', async () => {
    const onDocumentInfo = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        onProgressChange={vi.fn()}
        onDocumentInfo={onDocumentInfo}
      />,
    );

    const onDocumentLoad = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: {
      doc: unknown;
    }) => void;

    await act(async () => {
      onDocumentLoad({
        doc: { numPages: 3, getMetadata: () => Promise.reject(new Error('no metadata')) },
      });
    });

    expect(onDocumentInfo).toHaveBeenCalledWith(
      expect.objectContaining({ pageCount: 3, pdfVersion: null, author: null }),
    );
  });

  it('passes case and whole-word options through to the search plugin', async () => {
    const controller = new ViewerController();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        controller={controller}
        onProgressChange={vi.fn()}
      />,
    );

    await act(async () => {
      controller.search('method', { matchCase: true, wholeWords: true });
    });

    expect(pdfViewerSearchMock.highlight).toHaveBeenCalledWith({
      keyword: 'method',
      matchCase: true,
      wholeWords: true,
    });
  });

  it('opens the real viewer at the restored page and zoom', () => {
    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book', restore: { page: 42, zoom: 1.5 } }}
        onProgressChange={vi.fn()}
      />,
    );

    // initialPage is zero-based in react-pdf-viewer.
    expect(pdfViewerCoreMock.lastViewerProps?.initialPage).toBe(41);
    expect(pdfViewerCoreMock.lastViewerProps?.defaultScale).toBe(1.5);
  });

  it('opens at the first page when there is nothing to restore', () => {
    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        onProgressChange={vi.fn()}
      />,
    );

    expect(pdfViewerCoreMock.lastViewerProps?.initialPage).toBe(0);
    expect(pdfViewerCoreMock.lastViewerProps?.defaultScale).toBeUndefined();
  });

  it('reports the restored page on load instead of resetting to page 1', () => {
    // A restored document must not have its saved position overwritten by the
    // viewer's own initial load report.
    const renderer: PdfRenderer = ({ onPageChange }) => (
      <button type="button" onClick={() => onPageChange(42, 500)}>
        Load
      </button>
    );
    const onProgressChange = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book', restore: { page: 42, zoom: 1.5 } }}
        renderer={renderer}
        onProgressChange={onProgressChange}
      />,
    );

    act(() => {
      screen.getByRole('button', { name: 'Load' }).click();
    });

    expect(onProgressChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 42, totalPages: 500 }),
    );
  });

  it('keeps progress callbacks stable when the parent passes new handlers', () => {
    // Viewer progress feeds app state, which re-renders this subtree with fresh
    // handler identities. If those reached the viewer as new props they would
    // defeat its memo boundary on every scrolled page.
    const seenPageHandlers: unknown[] = [];
    const seenZoomHandlers: unknown[] = [];
    const renderer: PdfRenderer = ({ onPageChange, onZoomChange }) => {
      seenPageHandlers.push(onPageChange);
      seenZoomHandlers.push(onZoomChange);
      return <div>Rendered PDF</div>;
    };

    const { rerender } = render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={vi.fn()}
      />,
    );

    rerender(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={vi.fn()}
      />,
    );

    expect(seenPageHandlers.length).toBeGreaterThan(1);
    expect(new Set(seenPageHandlers).size).toBe(1);
    expect(new Set(seenZoomHandlers).size).toBe(1);
  });

  it('reports progress through the newest parent handler', () => {
    const renderer: PdfRenderer = ({ onPageChange }) => (
      <button type="button" onClick={() => onPageChange(3, 12)}>
        Report page
      </button>
    );
    const stale = vi.fn();
    const fresh = vi.fn();

    const { rerender } = render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={stale}
      />,
    );
    rerender(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={fresh}
      />,
    );

    act(() => {
      screen.getByRole('button', { name: 'Report page' }).click();
    });

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-a', page: 3, totalPages: 12 }),
    );
  });
});
