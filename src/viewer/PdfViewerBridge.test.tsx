import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';
import { ViewerController } from './viewerController';
import { emptySearchState } from './viewerTypes';

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

const pdfViewerZoomMock = vi.hoisted(() => ({ zoomTo: vi.fn() }));

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
        zoomPluginInstance: pdfViewerZoomMock,
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
  it('publishes resolved PDF chapters with document metadata', async () => {
    const onDocumentInfo = vi.fn();
    render(<PdfViewerBridge source={{ sessionId: 'outline', url: 'blob:outline' }} onProgressChange={vi.fn()} onDocumentInfo={onDocumentInfo} />);
    const loaded = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: { doc: unknown }) => void;
    await act(async () => { loaded({ doc: {
      numPages: 10, getMetadata: async () => ({ info: { Title: 'Book' } }),
      getOutline: async () => [{ title: '第一章', dest: [2] }],
    } }); });
    expect(onDocumentInfo).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'outline', title: 'Book', outline: [{ id: '0', title: '第一章', page: 3, children: [] }],
    }));
  });

  it('keeps the PDF readable when its embedded outline cannot be loaded', async () => {
    const onDocumentInfo = vi.fn();
    const onLoadError = vi.fn();
    render(<PdfViewerBridge source={{ sessionId: 'outline', url: 'blob:outline' }} onProgressChange={vi.fn()}
      onDocumentInfo={onDocumentInfo} onLoadError={onLoadError} />);
    const loaded = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: { doc: unknown }) => void;
    await act(async () => { loaded({ doc: {
      numPages: 10, getMetadata: async () => ({ info: {} }),
      getOutline: async () => { throw new Error('broken outline'); },
    } }); });
    expect(onDocumentInfo).toHaveBeenCalledWith(expect.objectContaining({ outline: [], outlineError: expect.stringContaining('目录读取失败') }));
    expect(onLoadError).not.toHaveBeenCalled();
    expect(screen.getByText('Real PDF viewer')).toBeInTheDocument();
  });

  it('ignores a late outline after the same session is replaced with a different PDF', async () => {
    let resolve!: (items: unknown[]) => void;
    const pending = new Promise<unknown[]>((done) => { resolve = done; });
    const onDocumentInfo = vi.fn();
    const view = render(<PdfViewerBridge source={{ sessionId: 'same', url: 'blob:first' }} onProgressChange={vi.fn()} onDocumentInfo={onDocumentInfo} />);
    const loaded = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: { doc: unknown }) => void;
    act(() => { loaded({ doc: { numPages: 10, getMetadata: async () => ({ info: {} }), getOutline: () => pending } }); });
    view.rerender(<PdfViewerBridge source={{ sessionId: 'same', url: 'blob:second' }} onProgressChange={vi.fn()} onDocumentInfo={onDocumentInfo} />);
    await act(async () => { resolve([{ title: 'Old chapter', dest: [2] }]); });
    expect(onDocumentInfo).not.toHaveBeenCalled();
  });

  it('maps white PDF pixels to the eye-care paper color while preserving black and opacity', () => {
    const { container } = render(<PdfViewerBridge
      source={{ sessionId: 'eye-care', url: 'blob:eye-care', restore: { page: 1, zoom: 1.1 } }}
      onProgressChange={vi.fn()}
    />);
    const matrix = container.querySelector('feColorMatrix')!;
    expect(matrix.closest('filter')).toHaveAttribute('color-interpolation-filters', 'sRGB');
    const values = matrix.getAttribute('values')!.trim().split(/\s+/).map(Number);
    const transform = (pixel: number[]) => Array.from({ length: 4 }, (_, channel) => {
      const row = values.slice(channel * 5, channel * 5 + 5);
      return Math.round(row.slice(0, 4).reduce((value, coefficient, index) => value + coefficient * pixel[index], row[4] * 255));
    });
    expect(values).toHaveLength(20);
    expect(transform([255, 255, 255, 255])).toEqual([199, 237, 204, 255]);
    expect(transform([0, 0, 0, 255])).toEqual([0, 0, 0, 255]);
    expect(transform([255, 255, 255, 128])).toEqual([199, 237, 204, 128]);
  });

  it('keeps each PDF tint reference valid when zoom crosses 100–120% and another viewer closes', () => {
    const onProgressChange = vi.fn();
    const first = render(<PdfViewerBridge source={{ sessionId: 'first', url: 'blob:first' }} onProgressChange={onProgressChange} />);
    const second = render(<PdfViewerBridge source={{ sessionId: 'second', url: 'blob:second' }} onProgressChange={onProgressChange} />);
    const firstId = first.container.querySelector('filter')!.id;
    const secondId = second.container.querySelector('filter')!.id;
    expect(firstId).not.toBe(secondId);
    first.unmount();
    const zoomed = pdfViewerCoreMock.lastViewerProps?.onZoom as (event: { scale: number }) => void;
    for (const scale of [0.9, 1, 1.1, 1.2, 1.3, 1.5]) {
      act(() => zoomed({ scale }));
      expect(onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'second', zoom: scale }));
      expect(second.container.querySelector('.pdf-viewer-bridge')).toHaveStyle({ '--sr-eye-care-filter': `url("#${secondId}")` });
      expect(document.getElementById(secondId)).toBeInTheDocument();
    }
  });

  it('scopes the eye-care filter to the PDF canvas and removes its dependency on background blending', () => {
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    expect(styles).toMatch(/:root\[data-theme="eye-care"\]\s*{[^}]*--sr-page-bg:\s*#C7EDCC;[^}]*--sr-pdf-blend:\s*normal;/s);
    expect(styles).toMatch(/:root\[data-theme="eye-care"\] \.pdf-viewer-bridge \.rpv-core__canvas-layer > canvas\s*{\s*filter:\s*var\(--sr-eye-care-filter, none\);\s*}/);
  });

  it('ignores renderer callbacks from a replaced URL even when the session id is reused', () => {
    let old!: Parameters<PdfRenderer>[0];
    const renderer: PdfRenderer = (props) => {
      if (props.fileUrl === 'blob:private') old = props;
      return <div>{props.fileUrl}</div>;
    };
    const onProgressChange = vi.fn();
    const onLoadError = vi.fn();
    const onSearchStateChange = vi.fn();
    const onHighlightSelection = vi.fn();
    const callbacks = { onProgressChange, onLoadError, onSearchStateChange, onHighlightSelection };
    const { rerender } = render(<PdfViewerBridge source={{ sessionId: 'same', url: 'blob:private' }} renderer={renderer} {...callbacks} />);
    rerender(<PdfViewerBridge source={{ sessionId: 'same', url: 'blob:reopened' }} renderer={renderer} {...callbacks} />);
    act(() => {
      old.onPageChange(9, 10);
      old.onSearchStateChange?.({ ...emptySearchState, keyword: 'private excerpt' });
      old.onLoadError?.({ status: 'error', message: 'old failure' });
      old.onHighlightSelection?.({ page: 1, selectedText: 'private excerpt', areas: [], kind: 'note', color: '#fff' });
    });
    expect(onProgressChange).not.toHaveBeenCalled();
    expect(onLoadError).not.toHaveBeenCalled();
    expect(onSearchStateChange).not.toHaveBeenCalled();
    expect(onHighlightSelection).not.toHaveBeenCalled();
    expect(screen.getByText('blob:reopened')).toBeInTheDocument();
  });

  it('does not publish late metadata from a previous document', async () => {
    let finish!: (value: { info: { Title: string } }) => void;
    const metadata = new Promise<{ info: { Title: string } }>((resolve) => { finish = resolve; });
    const onDocumentInfo = vi.fn();
    const props = { onProgressChange: vi.fn(), onDocumentInfo };
    const { rerender } = render(<PdfViewerBridge source={{ sessionId: 'a', url: 'blob:a' }} {...props} />);
    const load = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: { doc: { numPages: number; getMetadata(): Promise<unknown> } }) => void;
    act(() => load({ doc: { numPages: 2, getMetadata: () => metadata } }));
    rerender(<PdfViewerBridge source={{ sessionId: 'b', url: 'blob:b' }} {...props} />);
    await act(async () => { finish({ info: { Title: 'Private title' } }); await metadata; });
    expect(onDocumentInfo).not.toHaveBeenCalled();
  });

  it('keeps the latest search when earlier searches finish out of order', async () => {
    let first!: (value: never[]) => void;
    let second!: (value: never[]) => void;
    pdfViewerSearchMock.highlight.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    const controller = new ViewerController();
    const onSearchStateChange = vi.fn();
    render(<PdfViewerBridge source={{ sessionId: 'a', url: 'blob:a' }} controller={controller}
      onProgressChange={vi.fn()} onSearchStateChange={onSearchStateChange} />);
    act(() => { controller.search('first'); controller.search('second'); });
    await act(async () => { second([]); });
    await act(async () => { first([]); });
    expect(onSearchStateChange).toHaveBeenCalledTimes(1);
    expect(onSearchStateChange).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'second' }));
  });
  afterEach(() => {
    pdfViewerSearchMock.highlight.mockClear();
    pdfViewerZoomMock.zoomTo.mockClear();
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

  it('reports restored zoom on the first document load and increments from that scale before any zoom event', async () => {
    const controller = new ViewerController();
    const onProgressChange = vi.fn();
    render(<PdfViewerBridge source={{ sessionId: 'restored', url: 'blob:restored', restore: { page: 2, zoom: 1.1 } }}
      controller={controller} onProgressChange={onProgressChange} />);
    const loaded = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: { doc: unknown }) => void;
    await act(async () => {
      loaded({ doc: { numPages: 6, getMetadata: async () => ({ info: {} }) } });
    });
    expect(onProgressChange).toHaveBeenLastCalledWith({ sessionId: 'restored', page: 2, totalPages: 6, zoom: 1.1 });
    act(() => { controller.zoomIn(); });
    expect(pdfViewerZoomMock.zoomTo.mock.calls.at(-1)?.[0]).toBeCloseTo(1.2);

    const zoomed = pdfViewerCoreMock.lastViewerProps?.onZoom as (event: { scale: number }) => void;
    act(() => { zoomed({ scale: 1.2 }); controller.zoomOut(); });
    expect(onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 1.2 }));
    expect(pdfViewerZoomMock.zoomTo.mock.calls.at(-1)?.[0]).toBeCloseTo(1.1);
  });

  it('initializes zoom from the replacement source rather than the previous document scale', async () => {
    const controller = new ViewerController();
    const onProgressChange = vi.fn();
    const view = render(<PdfViewerBridge source={{ sessionId: 'same', url: 'blob:first', restore: { page: 2, zoom: 1.5 } }}
      controller={controller} onProgressChange={onProgressChange} />);
    const zoomed = pdfViewerCoreMock.lastViewerProps?.onZoom as (event: { scale: number }) => void;
    act(() => { zoomed({ scale: 2 }); });
    view.rerender(<PdfViewerBridge source={{ sessionId: 'same', url: 'blob:second', restore: { page: 3, zoom: 0.8 } }}
      controller={controller} onProgressChange={onProgressChange} />);
    const loaded = pdfViewerCoreMock.lastViewerProps?.onDocumentLoad as (event: { doc: unknown }) => void;
    await act(async () => { loaded({ doc: { numPages: 6, getMetadata: async () => ({ info: {} }) } }); });
    expect(onProgressChange).toHaveBeenLastCalledWith({ sessionId: 'same', page: 3, totalPages: 6, zoom: 0.8 });
    act(() => { controller.zoomOut(); });
    expect(pdfViewerZoomMock.zoomTo.mock.calls.at(-1)?.[0]).toBeCloseTo(0.7);
  });

  it('passes the twenty-page dynamic render window to the real viewer', () => {
    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        onProgressChange={vi.fn()}
      />,
    );

    const setRenderRange = pdfViewerCoreMock.lastViewerProps?.setRenderRange as
      | ((range: { startPage: number; endPage: number; numPages: number }) => {
          startPage: number;
          endPage: number;
        })
      | undefined;

    expect(setRenderRange).toBeTypeOf('function');
    expect(setRenderRange?.({ startPage: 20, endPage: 20, numPages: 100 })).toEqual({
      startPage: 0,
      endPage: 40,
    });
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
