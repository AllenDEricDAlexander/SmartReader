import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistenceApi } from '../persistence/persistenceApi';
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
    deleteBookmark: vi.fn(),
    saveAnnotation: vi.fn(),
    listAnnotations: vi.fn().mockResolvedValue([]),
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

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

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

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose PDF file'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'picker.pdf' })).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Choose PDF file'), {
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

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

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

  it('runs search and page jump commands from the toolbar', () => {
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

    fireEvent.change(screen.getByLabelText('Search text'), { target: { value: 'method' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search PDF' }));
    fireEvent.change(screen.getByLabelText('Page number'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to page' }));

    expect(viewerController.search).toHaveBeenCalledWith('method');
    expect(viewerController.jumpToPage).toHaveBeenCalledWith(8);
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

    fireEvent.change(screen.getByLabelText('Choose PDF file'), {
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

    fireEvent.change(screen.getByLabelText('Choose PDF file'), {
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

    expect(screen.getByText('Page 1: Page note')).toBeInTheDocument();
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

  it('shows shortcut conflicts in preferences', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByText('Session restore')).toBeInTheDocument();
    expect(screen.getByText('Shortcut conflicts')).toBeInTheDocument();
  });
});
