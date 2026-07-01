import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistenceApi } from '../persistence/persistenceApi';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { renderApp } from '../test/renderApp';
import type { PdfRenderer } from '../viewer/PdfViewerBridge';
import { App } from './App';

let openWithListener: ((paths: string[]) => void) | null = null;

vi.mock('../platform/openWithEvents', () => ({
  listenForOpenWith: vi.fn(async (listener: (paths: string[]) => void) => {
    openWithListener = listener;
    return () => {
      openWithListener = null;
    };
  }),
}));

const testViewerRenderer: PdfRenderer = ({ fileUrl }) => <div>PDF {fileUrl}</div>;

function createEmptyPersistence(): PersistenceApi {
  return {
    saveDocument: vi.fn(),
    listRecentDocuments: vi.fn().mockResolvedValue([]),
    saveReaderSession: vi.fn(),
    loadReaderSession: vi.fn().mockResolvedValue(null),
    saveBookmark: vi.fn(),
    listBookmarks: vi.fn().mockResolvedValue([]),
    listAllBookmarks: vi.fn().mockResolvedValue([]),
    deleteBookmark: vi.fn(),
    saveAnnotation: vi.fn(),
    listAnnotations: vi.fn().mockResolvedValue([]),
    listAllAnnotations: vi.fn().mockResolvedValue([]),
    deleteAnnotation: vi.fn(),
    savePreferences: vi.fn(),
    loadPreferences: vi.fn().mockResolvedValue(null),
    setDocumentFavorite: vi.fn(),
    listFavoriteDocuments: vi.fn().mockResolvedValue([]),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    attachDocumentTag: vi.fn(),
    detachDocumentTag: vi.fn(),
    attachAnnotationTag: vi.fn(),
    detachAnnotationTag: vi.fn(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe('App', () => {
  afterEach(() => {
    openWithListener = null;
    vi.restoreAllMocks();
  });

  it('renders the ReaderApp through the thin App entry', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(screen.getByLabelText('SmartReader workbench')).toBeInTheDocument();
  });

  it('shows the home dashboard with primary open actions', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开本地 PDF' })).toBeInTheDocument();
    expect(screen.getByText('拖拽到这里')).toBeInTheDocument();
    expect(screen.getByText('AI 助手')).toHaveAttribute('aria-disabled', 'true');
  });

  it('switches to the reader workspace after opening a PDF', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    expect(await screen.findByLabelText('阅读工作区')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
  });

  it('opens a PDF from the native dialog and displays a tab', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });
  });

  it('mounts an opened PDF inside the sized viewer surface', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:surface');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    const viewerSurface = await screen.findByLabelText('PDF viewer surface');
    expect(viewerSurface).toHaveClass('viewer-surface');
    expect(viewerSurface).toHaveTextContent('PDF blob:surface');
  });

  it('does not create a duplicate tab for the same path', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: 'book.pdf' })).toHaveLength(1);
    });
  });

  it('opens a dropped browser PDF file', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:drop');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['%PDF-1.7'], 'drop.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.drop(screen.getByLabelText('SmartReader workbench'), {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'drop.pdf' })).toBeInTheDocument();
    });
  });

  it('runs viewer zoom shortcuts', () => {
    const viewerController = {
      jumpToPage: vi.fn(),
      openSearch: vi.fn(),
      search: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: '=', metaKey: true });
    fireEvent.keyDown(window, { key: '-', metaKey: true });

    expect(viewerController.zoomIn).toHaveBeenCalledTimes(1);
    expect(viewerController.zoomOut).toHaveBeenCalledTimes(1);
  });

  it('uses saved shortcut preferences for commands', async () => {
    const openNativePdf = vi.fn().mockResolvedValue(null);
    const persistence = {
      ...createEmptyPersistence(),
      loadPreferences: vi.fn().mockResolvedValue({
        ...defaultReaderPreferences,
        shortcuts: {
          ...defaultReaderPreferences.shortcuts,
          'file.open': 'Shift+Meta+O',
        },
      }),
    };

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    await waitFor(() => {
      expect(persistence.loadPreferences).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, { key: 'o', metaKey: true });
    expect(openNativePdf).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'o', metaKey: true, shiftKey: true });
    expect(openNativePdf).toHaveBeenCalledTimes(1);
  });

  it('restores desktop sessions by reading the PDF bytes again', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:restored');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      saveDocument: vi.fn(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/book.pdf',
          path: '/tmp/book.pdf',
          displayName: 'book.pdf',
          fileSize: 100,
          modifiedAt: '2026-06-15T00:00:00Z',
          pageCount: 20,
          lastPage: 6,
          progress: 0.3,
          missing: false,
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue({
        activeDocumentKey: 'desktop:/tmp/book.pdf',
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/book.pdf',
            tabOrder: 0,
            page: 6,
            zoom: 1.25,
            history: { currentPage: 6, backStack: [1], forwardStack: [] },
          },
        ],
      }),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('PDF blob:restored')).toBeInTheDocument();
    });

    expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/book.pdf');
  });

  it('keeps a restored tab in error state when the PDF is missing', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/missing.pdf',
          path: '/tmp/missing.pdf',
          displayName: 'missing.pdf',
          fileSize: 100,
          modifiedAt: '2026-06-16T00:00:00Z',
          pageCount: 20,
          lastPage: 6,
          progress: 0.3,
          missing: false,
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue({
        activeDocumentKey: 'desktop:/tmp/missing.pdf',
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/missing.pdf',
            tabOrder: 0,
            page: 6,
            zoom: 1,
            history: { currentPage: 6, backStack: [], forwardStack: [] },
          },
        ],
      }),
    };

    renderApp(
      <App
        bridge={{
          openNativePdf: vi.fn(),
          readDesktopPdf: vi.fn().mockRejectedValue(new Error('file does not exist')),
        }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('file does not exist')).toBeInTheDocument();
    });
  });

  it('does not restore reader tabs when session restore is disabled', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:disabled-restore');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      loadPreferences: vi.fn().mockResolvedValue({
        ...defaultReaderPreferences,
        sessionRestoreEnabled: false,
      }),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/book.pdf',
          path: '/tmp/book.pdf',
          displayName: 'book.pdf',
          fileSize: 100,
          modifiedAt: '2026-06-15T00:00:00Z',
          pageCount: 20,
          lastPage: 6,
          progress: 0.3,
          missing: false,
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue({
        activeDocumentKey: 'desktop:/tmp/book.pdf',
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/book.pdf',
            tabOrder: 0,
            page: 6,
            zoom: 1,
            history: { currentPage: 6, backStack: [], forwardStack: [] },
          },
        ],
      }),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Open recent book.pdf' })).toBeInTheDocument();
    expect(readDesktopPdf).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'book.pdf' })).not.toBeInTheDocument();
  });

  it('restores only the active tab when restore scope is active', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:active-restore');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockImplementation(async (path: string) => ({
      source: { kind: 'desktop-path', path, name: path.split('/').at(-1) ?? 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    }));
    const persistence = {
      ...createEmptyPersistence(),
      loadPreferences: vi.fn().mockResolvedValue({
        ...defaultReaderPreferences,
        restoreScope: 'active',
      }),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/one.pdf',
          path: '/tmp/one.pdf',
          displayName: 'one.pdf',
          fileSize: 100,
          modifiedAt: '2026-06-15T00:00:00Z',
          pageCount: 20,
          lastPage: 3,
          progress: 0.15,
          missing: false,
        },
        {
          documentKey: 'desktop:/tmp/two.pdf',
          path: '/tmp/two.pdf',
          displayName: 'two.pdf',
          fileSize: 100,
          modifiedAt: '2026-06-15T00:00:00Z',
          pageCount: 20,
          lastPage: 8,
          progress: 0.4,
          missing: false,
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue({
        activeDocumentKey: 'desktop:/tmp/two.pdf',
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/one.pdf',
            tabOrder: 0,
            page: 3,
            zoom: 1,
            history: { currentPage: 3, backStack: [], forwardStack: [] },
          },
          {
            documentKey: 'desktop:/tmp/two.pdf',
            tabOrder: 1,
            page: 8,
            zoom: 1.25,
            history: { currentPage: 8, backStack: [2], forwardStack: [] },
          },
        ],
      }),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(await screen.findByRole('tab', { name: 'two.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'one.pdf' })).not.toBeInTheDocument();
    expect(readDesktopPdf).toHaveBeenCalledTimes(1);
    expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/two.pdf');
  });

  it('keeps one reader workspace per render', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(screen.getAllByLabelText('SmartReader workbench')).toHaveLength(1);
  });

  it('opens a PDF from the browser file picker', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:picker');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['%PDF-1.7'], 'picker.pdf', { type: 'application/pdf' });
    const persistence = createEmptyPersistence();

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'picker.pdf' })).toBeInTheDocument();
    });
    expect(persistence.saveDocument).not.toHaveBeenCalled();
  });

  it('persists an empty reader session after closing the final tab', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));
    expect(await screen.findByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }));

    await waitFor(
      () => {
        expect(persistence.saveReaderSession).toHaveBeenLastCalledWith(
          expect.objectContaining({
            activeDocumentKey: null,
            tabs: [],
          }),
        );
      },
      { timeout: 1000 },
    );
  });

  it('keeps the fallback PDF visible after closing the active tab', async () => {
    let blobIndex = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      blobIndex += 1;
      return `blob:tab-${blobIndex}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'one.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('PDF blob:tab-1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'two.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('PDF blob:tab-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }));

    await waitFor(() => {
      expect(screen.getByText('PDF blob:tab-1')).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: 'two.pdf' })).not.toBeInTheDocument();
  });

  it('keeps the PDF source in sync when switching tabs with shortcuts', async () => {
    let blobIndex = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      blobIndex += 1;
      return `blob:tab-${blobIndex}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'one.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('PDF blob:tab-1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'two.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('PDF blob:tab-2')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('PDF blob:tab-1')).toBeInTheDocument();
    });
  });

  it('marks the active session as failed when the viewer reports a load error', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['not a pdf'], 'broken.pdf', { type: 'application/pdf' });
    const failingViewerRenderer: PdfRenderer = ({ onLoadError }) => (
      <button
        type="button"
        onClick={() =>
          onLoadError?.({
            status: 'error',
            message: 'PDF failed in viewer',
          })
        }
      >
        Fail viewer load
      </button>
    );

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={failingViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Fail viewer load' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('broken.pdf');
    expect(alert).toHaveTextContent('PDF failed in viewer');
  });

  it('saves desktop documents when they are opened', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(persistence.saveDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          documentKey: 'desktop:/tmp/book.pdf',
          path: '/tmp/book.pdf',
          displayName: 'book.pdf',
        }),
      );
    });
  });

  it('does not overwrite desktop metadata when favoriting an opened desktop document', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:desktop-favorite');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(persistence.saveDocument).toHaveBeenCalledTimes(1);
    });
    expect(persistence.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        fileSize: 5,
        modifiedAt: '2026-06-16T00:00:00Z',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '收藏当前文档' }));

    await waitFor(() => {
      expect(persistence.setDocumentFavorite).toHaveBeenCalledWith('desktop:/tmp/book.pdf', true);
    });
    expect(persistence.saveDocument).toHaveBeenCalledTimes(1);
  });

  it('runs search and page jump commands from the toolbar', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:toolbar');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const viewerController = {
      jumpToPage: vi.fn().mockReturnValue(true),
      openSearch: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue(true),
      searchNext: vi.fn().mockReturnValue(true),
      searchPrevious: vi.fn().mockReturnValue(true),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn().mockReturnValue(true),
      fitPage: vi.fn().mockReturnValue(true),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'toolbar.pdf', { type: 'application/pdf' })] },
    });

    await screen.findByRole('tab', { name: 'toolbar.pdf' });

    fireEvent.change(screen.getByLabelText('Search text'), { target: { value: 'method' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search PDF' }));
    fireEvent.change(screen.getByLabelText('Page number'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to page' }));

    expect(viewerController.search).toHaveBeenCalledWith('method');
    expect(viewerController.jumpToPage).toHaveBeenCalledWith(8);
  });

  it('clears search through the viewer without showing fabricated match counts', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:search-clear');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const viewerController = {
      jumpToPage: vi.fn().mockReturnValue(true),
      openSearch: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue(true),
      searchNext: vi.fn().mockReturnValue(true),
      searchPrevious: vi.fn().mockReturnValue(true),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn().mockReturnValue(true),
      fitPage: vi.fn().mockReturnValue(true),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'search.pdf', { type: 'application/pdf' })] },
    });

    await screen.findByRole('tab', { name: 'search.pdf' });

    fireEvent.change(screen.getByLabelText('Search text'), { target: { value: 'method' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(viewerController.search).toHaveBeenNthCalledWith(1, 'method');
    expect(viewerController.search).toHaveBeenNthCalledWith(2, '');
    expect(screen.getByLabelText('Search text')).toHaveValue('');
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });

  it('runs tab and fit mode shortcuts', () => {
    const viewerController = {
      jumpToPage: vi.fn().mockReturnValue(true),
      openSearch: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue(true),
      searchNext: vi.fn().mockReturnValue(true),
      searchPrevious: vi.fn().mockReturnValue(true),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn().mockReturnValue(true),
      fitPage: vi.fn().mockReturnValue(true),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: '0', metaKey: true });
    fireEvent.keyDown(window, { key: '9', metaKey: true });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });

    expect(viewerController.fitWidth).toHaveBeenCalledTimes(1);
    expect(viewerController.fitPage).toHaveBeenCalledTimes(1);
    expect(viewerController.openSearch).toHaveBeenCalledTimes(1);
  });

  it('adds and jumps to bookmarks', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bookmark');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      saveBookmark: vi.fn().mockImplementation(async (bookmark) => ({ ...bookmark, id: 7 })),
      listBookmarks: vi.fn().mockResolvedValue([]),
      deleteBookmark: vi.fn(),
      listAnnotations: vi.fn().mockResolvedValue([]),
    };
    const viewerController = {
      jumpToPage: vi.fn().mockReturnValue(true),
      openSearch: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue(true),
      searchNext: vi.fn().mockReturnValue(true),
      searchPrevious: vi.fn().mockReturnValue(true),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn().mockReturnValue(true),
      fitPage: vi.fn().mockReturnValue(true),
    };
    const file = new File(['%PDF-1.7'], 'book.pdf', {
      type: 'application/pdf',
      lastModified: 0,
    });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'd', metaKey: true });

    await waitFor(() => {
      expect(persistence.saveBookmark).toHaveBeenCalled();
    });
  });

  it('adds page notes through the note shortcut', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:note');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 3 })),
      listAnnotations: vi.fn().mockResolvedValue([]),
      listBookmarks: vi.fn().mockResolvedValue([]),
    };
    const file = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'N', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(persistence.saveAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          documentKey: expect.stringMatching(/^browser:book\.pdf:8:/),
          page: 1,
          type: 'note',
        }),
      );
    });

    expect(screen.getByText('页面笔记')).toBeInTheDocument();
  });

  it('adds a page note and lets the user tag the annotation', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tagged-note');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 3 })),
      listAnnotations: vi.fn().mockResolvedValue([]),
      listBookmarks: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: '重点',
          color: '#2563eb',
          documentCount: 0,
          annotationCount: 0,
          createdAt: '2026-06-18T00:00:00Z',
          updatedAt: '2026-06-18T00:00:00Z',
        },
      ]),
    };
    const file = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '新建批注' }));

    expect(await screen.findByText('页面笔记')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添加标签 重点' }));

    await waitFor(() => {
      expect(persistence.attachAnnotationTag).toHaveBeenCalledWith(3, 1);
    });
  });

  it('edits a persisted page note through the annotation detail', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:edit-note');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 3 })),
      listAnnotations: vi.fn().mockResolvedValue([]),
      listBookmarks: vi.fn().mockResolvedValue([]),
    };
    const file = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await screen.findByRole('tab', { name: 'book.pdf' });
    fireEvent.click(screen.getByRole('button', { name: '新建批注' }));

    fireEvent.change(await screen.findByLabelText('Annotation note'), {
      target: { value: '更新后的笔记' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => {
      expect(persistence.saveAnnotation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 3,
          text: '更新后的笔记',
          quote: null,
          type: 'note',
        }),
      );
    });
    expect(vi.mocked(persistence.saveAnnotation).mock.lastCall?.[0]).not.toHaveProperty('tagIds');
  });

  it('favorites the active reader document from the toolbar', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:favorite');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const file = new File(['%PDF-1.7'], 'favorite.pdf', {
      type: 'application/pdf',
      lastModified: 0,
    });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await screen.findByRole('tab', { name: 'favorite.pdf' });
    fireEvent.click(screen.getByRole('button', { name: '收藏当前文档' }));

    await waitFor(() => {
      expect(persistence.saveDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          documentKey: 'browser:favorite.pdf:8:0',
          path: null,
          displayName: 'favorite.pdf',
          fileSize: 8,
          modifiedAt: '1970-01-01T00:00:00.000Z',
        }),
      );
      expect(persistence.setDocumentFavorite).toHaveBeenCalledWith(
        'browser:favorite.pdf:8:0',
        true,
      );
    });
    expect(
      vi.mocked(persistence.saveDocument).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(persistence.setDocumentFavorite).mock.invocationCallOrder[0]);
    expect(screen.getByRole('button', { name: '取消收藏当前文档' })).toBeInTheDocument();
  });

  it('does not mark a favorite locally when persistence rejects it', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:favorite-reject');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      setDocumentFavorite: vi.fn().mockRejectedValue(new Error('missing document')),
    };
    const file = new File(['%PDF-1.7'], 'favorite.pdf', {
      type: 'application/pdf',
      lastModified: 0,
    });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await screen.findByRole('tab', { name: 'favorite.pdf' });
    fireEvent.click(screen.getByRole('button', { name: '收藏当前文档' }));

    await waitFor(() => {
      expect(persistence.setDocumentFavorite).toHaveBeenCalledWith(
        'browser:favorite.pdf:8:0',
        true,
      );
    });
    expect(screen.getByRole('button', { name: '收藏当前文档' })).toBeInTheDocument();
  });

  it('keeps existing annotations when annotation import JSON is invalid', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invalid-import');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 3 })),
      listAnnotations: vi.fn().mockResolvedValue([]),
      listBookmarks: vi.fn().mockResolvedValue([]),
    };
    const file = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [file] },
    });

    await screen.findByRole('tab', { name: 'book.pdf' });
    fireEvent.click(screen.getByRole('button', { name: '新建批注' }));

    expect(await screen.findByText('页面笔记')).toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Annotation import JSON'), {
      target: { value: '{invalid json' },
    });

    expect(screen.getByText('页面笔记')).toBeInTheDocument();
    expect(persistence.saveAnnotation).toHaveBeenCalledTimes(1);
  });

  it('shows recent files and reopens one from the empty state', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recent');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/book.pdf',
          path: '/tmp/book.pdf',
          displayName: 'book.pdf',
          fileSize: 2048,
          modifiedAt: '2026-06-16T00:00:00Z',
          pageCount: 20,
          lastPage: 5,
          progress: 0.25,
          missing: false,
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open recent book.pdf' }));

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/book.pdf');
    });
    expect(await screen.findByText('PDF blob:recent')).toBeInTheDocument();
  });

  it('opens PDF paths from desktop Open With events', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:open-with');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/open-with.pdf', name: 'open-with.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    await waitFor(() => {
      expect(openWithListener).toBeTruthy();
    });

    openWithListener?.(['/tmp/open-with.pdf']);

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/open-with.pdf');
    });
    expect(await screen.findByRole('tab', { name: 'open-with.pdf' })).toBeInTheDocument();
  });

  it('opens settings and saves preferences', async () => {
    const persistence = createEmptyPersistence();

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(persistence.savePreferences).toHaveBeenCalled();
    });
  });

  it('saves session restore scope through explicit preferences save', async () => {
    const persistence = createEmptyPersistence();

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '会话恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '当前文档' }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(persistence.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ restoreScope: 'active' }),
      );
    });
  });

  it('does not overwrite dirty settings draft when preferences load late', async () => {
    const preferencesLoad = createDeferred<ReaderPreferences | null>();
    const persistence = {
      ...createEmptyPersistence(),
      loadPreferences: vi.fn().mockReturnValue(preferencesLoad.promise),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '会话恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '当前文档' }));

    await act(async () => {
      preferencesLoad.resolve({
        ...defaultReaderPreferences,
        restoreScope: 'all',
      });
      await preferencesLoad.promise;
    });

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(persistence.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ restoreScope: 'active' }),
      );
    });
  });

  it('opens tag manager and creates a tag', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      createTag: vi.fn().mockImplementation(async (input) => ({
        id: 1,
        ...input,
        documentCount: 0,
        annotationCount: 0,
        createdAt: '2026-06-18T00:00:00Z',
        updatedAt: '2026-06-18T00:00:00Z',
      })),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '标签管理' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '论文' } });
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }));

    await waitFor(() => {
      expect(persistence.createTag).toHaveBeenCalledWith({ name: '论文', color: '#2563eb' });
    });
  });

  it('keeps tag create input when creation fails', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      createTag: vi.fn().mockRejectedValue(new Error('create failed')),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '标签管理' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '论文' } });
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }));

    await waitFor(() => {
      expect(persistence.createTag).toHaveBeenCalledWith({ name: '论文', color: '#2563eb' });
    });
    expect(screen.getByLabelText('标签名称')).toHaveValue('论文');
    expect(screen.getByRole('status')).toHaveTextContent('标签创建失败');
  });

  it('opens settings from the preferences shortcut', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByText('当前没有快捷键冲突。')).toBeInTheDocument();
  });
});
