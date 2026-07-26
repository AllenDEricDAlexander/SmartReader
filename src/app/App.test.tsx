import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BookmarkDashboard,
  PersistedAnnotationRecord,
  PersistedBookmarkRecord,
  PersistenceApi,
} from '../persistence/persistenceApi';
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

const selectionKinds = ['highlight', 'underline', 'note'] as const;

function TestPdfRenderer({
  fileUrl,
  onPageChange,
  onHighlightSelection,
}: Parameters<PdfRenderer>[0]) {
  useEffect(() => {
    if (fileUrl === 'blob:progress-sync') {
      onPageChange(4, 10);
    }
  }, [fileUrl, onPageChange]);

  return (
    <div>
      PDF {fileUrl}
      {/* Stands in for the markup menu the real viewer shows on a text selection. */}
      {selectionKinds.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-label={`模拟标注 ${kind}`}
          onClick={() =>
            onHighlightSelection?.({
              selectedText: '被选中的原文',
              page: 2,
              areas: [{ pageIndex: 1, top: 10, left: 12, height: 2, width: 30 }],
              kind,
              color: '#4ade80',
            })
          }
        />
      ))}
    </div>
  );
}

const testViewerRenderer: PdfRenderer = (props) => <TestPdfRenderer {...props} />;

function createEmptyPersistence(): PersistenceApi {
  return {
    saveDocument: vi.fn(),
    listRecentDocuments: vi.fn().mockResolvedValue([]),
    removeRecentDocument: vi.fn(),
    clearRecentDocuments: vi.fn(),
    saveReaderSession: vi.fn(),
    loadReaderSession: vi.fn().mockResolvedValue(null),
    saveBookmark: vi.fn(),
    listBookmarks: vi.fn().mockResolvedValue([]),
    listAllBookmarks: vi.fn().mockResolvedValue([]),
    loadBookmarkDashboard: vi.fn().mockResolvedValue({
      totalBookmarks: 0,
      groups: [],
    }),
    deleteBookmark: vi.fn(),
    saveAnnotation: vi.fn(),
    listAnnotations: vi.fn().mockResolvedValue([]),
    listAllAnnotations: vi.fn().mockResolvedValue([]),
    deleteAnnotation: vi.fn(),
    savePreferences: vi.fn(),
    loadPreferences: vi.fn().mockResolvedValue(null),
    loadCacheStats: vi.fn().mockResolvedValue({
      usedBytes: 0,
      totalBytes: 5 * 1024 ** 3,
      fileCount: 0,
    }),
    setDocumentFavorite: vi.fn(),
    listFavoriteDocuments: vi.fn().mockResolvedValue([]),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    loadTagDashboard: vi.fn().mockResolvedValue({
      overview: { totalTags: 0, activeTags: 0, totalUsage: 0, orphanTags: 0 },
      tags: [],
      details: [],
      recommendations: [],
    }),
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

function dashboardFromRecords(
  records: PersistedBookmarkRecord[],
  fileSize: number | null = null,
  pageCount: number | null = null,
): BookmarkDashboard {
  const groups = new Map<string, PersistedBookmarkRecord[]>();
  for (const record of records) {
    const group = groups.get(record.documentKey) ?? [];
    group.push(record);
    groups.set(record.documentKey, group);
  }

  return {
    totalBookmarks: records.length,
    groups: [...groups.values()].map((bookmarks) => ({
      document: {
        documentKey: bookmarks[0].documentKey,
        displayName: bookmarks[0].documentDisplayName ?? bookmarks[0].documentKey,
        path: bookmarks[0].documentPath,
        missing: bookmarks[0].documentMissing,
        fileSize,
        pageCount,
      },
      bookmarkCount: bookmarks.length,
      bookmarks: bookmarks.map((bookmark) => ({
        id: bookmark.id,
        documentKey: bookmark.documentKey,
        page: bookmark.page,
        title: bookmark.title,
        note: bookmark.note,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
      })),
    })),
  };
}

function mainNavigation() {
  return within(screen.getByRole('navigation', { name: '主导航' }));
}

function topShortcuts() {
  return within(screen.getByRole('navigation', { name: '全局快捷入口' }));
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
    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
    expect(screen.getByText('拖拽到这里')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '辅助信息' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '快速上手' })).toBeInTheDocument();
    expect(screen.queryByText('AI 助手')).not.toBeInTheDocument();
  });

  it('shows sidebar data from recent files, favorites, session restore, and cache stats', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/recent-one.pdf',
          path: '/tmp/recent-one.pdf',
          displayName: 'one.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
        {
          documentKey: 'desktop:/tmp/recent-two.pdf',
          path: '/tmp/recent-two.pdf',
          displayName: 'two.pdf',
          fileSize: 4096,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 30,
          lastPage: 9,
          progress: 0.3,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      listFavoriteDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/favorite.pdf',
          displayName: 'favorite.pdf',
          path: '/tmp/favorite.pdf',
          lastPage: 3,
          progress: 0.15,
          pageCount: null,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue({
        activeDocumentKey: null,
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/one.pdf',
            tabOrder: 0,
            page: 4,
            zoom: 1,
            history: { currentPage: 4, backStack: [], forwardStack: [] },
          },
          {
            documentKey: 'desktop:/tmp/two.pdf',
            tabOrder: 1,
            page: 9,
            zoom: 1,
            history: { currentPage: 9, backStack: [], forwardStack: [] },
          },
          {
            documentKey: 'desktop:/tmp/three.pdf',
            tabOrder: 2,
            page: 1,
            zoom: 1,
            history: { currentPage: 1, backStack: [], forwardStack: [] },
          },
        ],
      }),
      loadCacheStats: vi.fn().mockResolvedValue({
        usedBytes: 1.24 * 1024 ** 3,
        totalBytes: 5 * 1024 ** 3,
        fileCount: 128,
      }),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(await screen.findByRole('button', { name: '最近文件 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏文件 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '会话恢复 3' })).toBeInTheDocument();
    expect(screen.getByText('1.24 GB / 5 GB')).toBeInTheDocument();
    expect(screen.getByText('已缓存 128 个文件')).toBeInTheDocument();
  });

  it('routes blank sidebar pages and returns to the home quick start', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '最近文件 0' }));

    expect(await screen.findByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开本地 PDF/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '首页' }));

    expect(await screen.findByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
  });

  it('binds an existing tag from the recent files workspace', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/Users/mario/Papers/Recent.pdf',
          path: '/Users/mario/Papers/Recent.pdf',
          displayName: 'Recent.pdf',
          fileSize: 1024,
          modifiedAt: '2026-07-08T09:00:00+08:00',
          pageCount: 12,
          lastPage: 3,
          progress: 0.25,
          missing: false,
          lastOpenedAt: '2026-07-08T09:00:00+08:00',
          tagIds: [],
        },
      ]),
      listTags: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'AI',
          color: '#8b5cf6',
          documentCount: 0,
          annotationCount: 0,
          createdAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      ]),
      attachDocumentTag: vi.fn().mockResolvedValue(undefined),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '最近文件 1' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑标签 Recent.pdf' }));
    fireEvent.click(await screen.findByRole('button', { name: '切换标签 AI' }));

    await waitFor(() => {
      expect(persistence.attachDocumentTag).toHaveBeenCalledWith(
        'desktop:/Users/mario/Papers/Recent.pdf',
        1,
      );
    });
  });

  it('opens cache settings from the sidebar cache management entry', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(within(screen.getByLabelText('本地缓存')).getByRole('button', { name: '管理缓存' }));

    expect(await screen.findByLabelText('设置工作区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '缓存' })).toBeInTheDocument();
  });

  it('falls back to empty cache stats when cache stats fail to load', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      loadCacheStats: vi.fn().mockRejectedValue(new Error('cache unavailable')),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    expect(await screen.findByText('0 B / 5 GB')).toBeInTheDocument();
    expect(screen.getByText('已缓存 0 个文件')).toBeInTheDocument();
  });

  it('falls back to the home browser picker when native open rejects', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    const openNativePdf = vi.fn().mockRejectedValue(new Error('native dialog failed'));

    renderApp(
      <App
        bridge={{
          canOpenNativePdf: () => true,
          openNativePdf,
          readDesktopPdf: vi.fn(),
        }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    await waitFor(() => {
      expect(inputClick).toHaveBeenCalled();
    });
    expect(openNativePdf).toHaveBeenCalledTimes(1);
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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });
  });

  it('adds a newly opened desktop PDF to recent files without reloading persistence', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }));

    fireEvent.click(screen.getByRole('button', { name: '最近文件 1' }));

    expect(await screen.findByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByText('book.pdf')).toBeInTheDocument();
    expect(persistence.listRecentDocuments).toHaveBeenCalledTimes(1);
  });

  it('updates recent file progress from viewer page changes', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:progress-sync');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/progress.pdf', name: 'progress.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'progress.pdf' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }));
    fireEvent.click(screen.getByRole('button', { name: '最近文件 1' }));

    expect(await screen.findByText('progress.pdf')).toBeInTheDocument();
    expect(screen.getByText('4 / 10 页')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();

    await waitFor(() => {
      expect(persistence.saveDocument).toHaveBeenLastCalledWith({
        documentKey: 'desktop:/tmp/progress.pdf',
        path: '/tmp/progress.pdf',
        displayName: 'progress.pdf',
        fileSize: 5,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 10,
        lastPage: 4,
        progress: 0.4,
        missing: false,
        lastOpenedAt: null,
        tagIds: [],
      });
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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));
    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: 'book.pdf' })).toHaveLength(1);
    });
  });

  it('opens a dropped browser PDF file from the reader workspace', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:book').mockReturnValue('blob:drop');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });
    const file = new File(['%PDF-1.7'], 'drop.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));
    await screen.findByRole('tab', { name: 'book.pdf' });

    fireEvent.drop(screen.getByLabelText('SmartReader workbench'), {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'drop.pdf' })).toBeInTheDocument();
    });
  });

  it('ignores workbench-level drops from the home workspace', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:home-workbench-drop');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['%PDF-1.7'], 'home-workbench-drop.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    const workbench = screen.getByLabelText('SmartReader workbench');
    const dragOverEvent = createEvent.dragOver(workbench, {
      dataTransfer: {
        files: [file],
      },
    });
    const dropEvent = createEvent.drop(workbench, {
      dataTransfer: {
        files: [file],
      },
    });

    fireEvent(workbench, dragOverEvent);
    fireEvent(workbench, dropEvent);

    await act(async () => {
      await Promise.resolve();
    });

    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'home-workbench-drop.pdf' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
  });

  it('ignores home drops outside the quick-start drop card', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:home-drop');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['%PDF-1.7'], 'home-drop.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.drop(screen.getByRole('region', { name: '欢迎使用 SmartReader' }), {
      dataTransfer: {
        files: [file],
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'home-drop.pdf' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
  });

  it('runs viewer zoom shortcuts', () => {
    const viewerController = {
      jumpToPage: vi.fn(),
      openSearch: vi.fn(),
      search: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      jumpToMatch: vi.fn(),
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
          lastOpenedAt: null,
          tagIds: [],
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
          lastOpenedAt: null,
          tagIds: [],
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
          lastOpenedAt: null,
          tagIds: [],
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

    expect(await screen.findByRole('button', { name: '恢复会话 book.pdf' })).toBeInTheDocument();
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
          lastOpenedAt: null,
          tagIds: [],
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
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));
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

  it('keeps session restore count in sync with restorable persisted desktop tabs', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      loadReaderSession: vi.fn().mockResolvedValue({
        activeDocumentKey: null,
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/old-one.pdf',
            tabOrder: 0,
            page: 1,
            zoom: 1,
            history: { currentPage: 1, backStack: [], forwardStack: [] },
          },
          {
            documentKey: 'desktop:/tmp/old-two.pdf',
            tabOrder: 1,
            page: 1,
            zoom: 1,
            history: { currentPage: 1, backStack: [], forwardStack: [] },
          },
          {
            documentKey: 'browser:old-browser.pdf:5:1783296000000',
            tabOrder: 2,
            page: 1,
            zoom: 1,
            history: { currentPage: 1, backStack: [], forwardStack: [] },
          },
        ],
      }),
    };
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

    expect(await screen.findByRole('button', { name: '会话恢复 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    expect(await screen.findByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    await waitFor(() => {
      expect(persistence.saveReaderSession).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tabs: [
            expect.objectContaining({
              documentKey: 'desktop:/tmp/book.pdf',
            }),
          ],
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '会话恢复 0' })).toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

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

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

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
      jumpToMatch: vi.fn().mockReturnValue(true),
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

    expect(viewerController.search).toHaveBeenCalledWith('method', expect.any(Object));
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
      jumpToMatch: vi.fn().mockReturnValue(true),
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

    expect(viewerController.search).toHaveBeenNthCalledWith(1, 'method', expect.any(Object));
    expect(viewerController.search).toHaveBeenNthCalledWith(2, '', expect.any(Object));
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
      jumpToMatch: vi.fn().mockReturnValue(true),
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
      jumpToMatch: vi.fn().mockReturnValue(true),
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
      expect(persistence.saveBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ note: null }),
      );
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

  it.each([
    ['highlight', 'highlight'],
    ['underline', 'underline'],
  ] as const)(
    'saves a %s annotation from a text selection with the chosen colour',
    async (kind, expectedType) => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(`blob:selection-${kind}`);
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const persistence = {
        ...createEmptyPersistence(),
        saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 7 })),
      };

      renderApp(
        <App
          bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
          persistence={persistence}
          viewerRenderer={testViewerRenderer}
        />,
      );

      fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
        target: { files: [new File(['%PDF-1.7'], 'mark.pdf', { type: 'application/pdf' })] },
      });

      await screen.findByRole('tab', { name: 'mark.pdf' });
      fireEvent.click(screen.getByLabelText(`模拟标注 ${kind}`));

      await waitFor(() => {
        expect(persistence.saveAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
            type: expectedType,
            color: '#4ade80',
            quote: '被选中的原文',
            areas: [{ pageIndex: 1, top: 10, left: 12, height: 2, width: 30 }],
          }),
        );
      });
    },
  );

  it('anchors a note to the selected text and focuses it for editing', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:selection-note');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = {
      ...createEmptyPersistence(),
      saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 11 })),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'quote.pdf', { type: 'application/pdf' })] },
    });

    await screen.findByRole('tab', { name: 'quote.pdf' });
    fireEvent.click(screen.getByLabelText('模拟标注 note'));

    await waitFor(() => {
      expect(persistence.saveAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'note', quote: '被选中的原文', page: 2 }),
      );
    });

    // A selection note keeps the quote and stays editable, so the reader can
    // type straight into the detail panel.
    expect(
      await screen.findByText('被选中的原文', { selector: 'blockquote' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Annotation note')).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Annotation note'), {
      target: { value: '这段值得复习' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));

    await waitFor(() => {
      expect(persistence.saveAnnotation).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 11, text: '这段值得复习', quote: '被选中的原文' }),
      );
    });
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
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));

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
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.click(await screen.findByRole('button', { name: '恢复会话 book.pdf' }));

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/book.pdf');
    });
    expect(await screen.findByText('PDF blob:recent')).toBeInTheDocument();
  });

  it('opens a favorite file through its matching recent document', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:favorite-recent');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/favorite.pdf', name: 'favorite.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-16T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/favorite.pdf',
          path: '/tmp/favorite.pdf',
          displayName: 'favorite.pdf',
          fileSize: 2048,
          modifiedAt: '2026-06-16T00:00:00Z',
          pageCount: 20,
          lastPage: 5,
          progress: 0.25,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      listFavoriteDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/favorite.pdf',
          displayName: 'favorite.pdf',
          path: '/tmp/favorite.pdf',
          lastPage: 5,
          progress: 0.25,
          pageCount: null,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.click(await screen.findByRole('button', { name: '打开收藏文件 favorite.pdf' }));

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/favorite.pdf');
    });
    expect(await screen.findByText('PDF blob:favorite-recent')).toBeInTheDocument();
  });

  it('shows a notice when a favorite file has no matching recent document', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listFavoriteDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/missing-favorite.pdf',
          displayName: 'missing-favorite.pdf',
          path: '/tmp/missing-favorite.pdf',
          lastPage: 1,
          progress: 0.1,
          pageCount: null,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '打开收藏文件 missing-favorite.pdf' }));

    expect(await screen.findByRole('dialog', { name: '无法打开收藏文件' })).toBeInTheDocument();
    expect(screen.getByText('该收藏文件暂无可打开的本地路径。')).toBeInTheDocument();
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

    fireEvent.click(topShortcuts().getByRole('button', { name: '设置' }));

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

    fireEvent.click(topShortcuts().getByRole('button', { name: '设置' }));
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

    fireEvent.click(topShortcuts().getByRole('button', { name: '设置' }));
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
    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await screen.findByRole('button', { name: '创建标签' });
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '论文' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

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
    await screen.findByRole('button', { name: '创建标签' });
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '论文' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(persistence.createTag).toHaveBeenCalledWith({ name: '论文', color: '#2563eb' });
    });
    expect(screen.getByLabelText('标签名称')).toHaveValue('论文');
    expect(screen.getByRole('alert')).toHaveTextContent('create failed');
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

  it('routes top bar shortcuts to local workspaces', async () => {
    const persistence = createEmptyPersistence();
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    expect(screen.getByLabelText('文献导入工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(topShortcuts().getByRole('button', { name: '对比阅读' }));
    expect(screen.getByLabelText('对比阅读工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(topShortcuts().getByRole('button', { name: '批注管理' }));
    expect(screen.getByLabelText('批注管理工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    vi.mocked(persistence.listAllAnnotations).mockClear();
    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    expect(await screen.findByRole('region', { name: '书签管理' })).toBeInTheDocument();
    expect(persistence.loadBookmarkDashboard).toHaveBeenCalledTimes(1);
    expect(persistence.listAllAnnotations).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.queryByLabelText('书签管理工作区')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    fireEvent.click(topShortcuts().getByRole('button', { name: '设置' }));
    expect(screen.getByLabelText('设置工作区')).toBeInTheDocument();
  });

  it('keeps the import workspace hidden file input out of tab order', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));

    expect(screen.getByLabelText('导入 PDF 文件')).toHaveAttribute('tabIndex', '-1');
  });

  it('opens a native PDF from the import workspace primary action when native dialogs are available', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:import-native');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/import-native.pdf', name: 'import-native.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-07-01T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{
          canOpenNativePdf: () => true,
          openNativePdf,
          readDesktopPdf: vi.fn(),
        }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(openNativePdf).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('tab', { name: 'import-native.pdf' })).toBeInTheDocument();
  });

  it('uses the import browser file picker from the primary action when native dialogs are unavailable', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:import-browser');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    const openNativePdf = vi.fn();
    const file = new File(['%PDF-1.7'], 'import-browser.pdf', { type: 'application/pdf' });

    renderApp(
      <App
        bridge={{
          canOpenNativePdf: () => false,
          openNativePdf,
          readDesktopPdf: vi.fn(),
        }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    expect(inputClick).toHaveBeenCalled();
    expect(openNativePdf).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('导入 PDF 文件'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('tab', { name: 'import-browser.pdf' })).toBeInTheDocument();
  });

  it('uses the import browser file picker from the primary action when native open rejects', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    const openNativePdf = vi.fn().mockRejectedValue(new Error('native dialog failed'));

    renderApp(
      <App
        bridge={{
          canOpenNativePdf: () => true,
          openNativePdf,
          readDesktopPdf: vi.fn(),
        }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(inputClick).toHaveBeenCalled();
    });
    expect(openNativePdf).toHaveBeenCalledTimes(1);
  });

  it('keeps the import workspace open when the native picker is cancelled', async () => {
    const openNativePdf = vi.fn().mockResolvedValue(null);

    renderApp(
      <App
        bridge={{
          canOpenNativePdf: () => true,
          openNativePdf,
          readDesktopPdf: vi.fn(),
        }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    expect(await screen.findByLabelText('文献导入工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(openNativePdf).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByLabelText('文献导入工作区')).toBeInTheDocument();
    expect(screen.queryByLabelText('阅读工作区')).not.toBeInTheDocument();
  });

  it('opens recent documents from the compare workspace', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:compare');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/compare.pdf', name: 'compare.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-07-01T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/compare.pdf',
          path: '/tmp/compare.pdf',
          displayName: 'compare.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.click(topShortcuts().getByRole('button', { name: '对比阅读' }));
    fireEvent.click((await screen.findAllByRole('button', { name: /compare\.pdf/ }))[0]);

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/compare.pdf');
    });
    expect(await screen.findByRole('tab', { name: 'compare.pdf' })).toBeInTheDocument();
  });

  it('keeps the compare workspace visible when reopening a recent document fails', async () => {
    const readDesktopPdf = vi.fn().mockRejectedValue(new Error('file does not exist'));
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/missing-compare.pdf',
          path: '/tmp/missing-compare.pdf',
          displayName: 'missing-compare.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.click(topShortcuts().getByRole('button', { name: '对比阅读' }));
    expect(await screen.findByLabelText('对比阅读工作区')).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: /missing-compare\.pdf/ }))[0]);

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/missing-compare.pdf');
    });
    expect(screen.getByLabelText('对比阅读工作区')).toBeInTheDocument();
    expect(screen.queryByLabelText('阅读工作区')).not.toBeInTheDocument();
  });

  it('refreshes and opens manager records from local workspaces', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:manager-record');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const bookmarkRecords: PersistedBookmarkRecord[] = [
      {
        id: 9,
        documentKey: 'desktop:/tmp/records.pdf',
        page: 6,
        title: '关键书签',
        note: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        documentDisplayName: 'records.pdf',
        documentPath: '/tmp/records.pdf',
        documentMissing: false,
      },
    ];
    const annotationRecords: PersistedAnnotationRecord[] = [
      {
        id: 12,
        documentKey: 'desktop:/tmp/records.pdf',
        page: 7,
        type: 'note',
        color: '#facc15',
        text: '关键批注',
        quote: null,
        areas: [],
        tagIds: [],
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        documentDisplayName: 'records.pdf',
        documentPath: '/tmp/records.pdf',
        documentMissing: false,
      },
    ];
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/records.pdf', name: 'records.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-07-01T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/records.pdf',
          path: '/tmp/records.pdf',
          displayName: 'records.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadBookmarkDashboard: vi.fn().mockResolvedValue(
        dashboardFromRecords(bookmarkRecords, 2048, 20),
      ),
      listAllAnnotations: vi.fn().mockResolvedValue(annotationRecords),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };
    const viewerController = {
      jumpToPage: vi.fn().mockReturnValue(true),
      openSearch: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue(true),
      searchNext: vi.fn().mockReturnValue(true),
      searchPrevious: vi.fn().mockReturnValue(true),
      jumpToMatch: vi.fn().mockReturnValue(true),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn().mockReturnValue(true),
      fitPage: vi.fn().mockReturnValue(true),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(topShortcuts().getByRole('button', { name: '批注管理' }));
    expect(await screen.findByText('关键批注')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /关键批注/ }));

    expect(await screen.findByRole('tab', { name: 'records.pdf' })).toBeInTheDocument();
    await waitFor(() => {
      expect(viewerController.jumpToPage).toHaveBeenCalledWith(7);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }));
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'records.pdf' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    expect(await screen.findByText('关键书签')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('关键书签'));
    fireEvent.click(screen.getByRole('button', { name: '跳转到书签 关键书签' }));

    expect(await screen.findByRole('tab', { name: 'records.pdf' })).toBeInTheDocument();
    await waitFor(() => {
      expect(viewerController.jumpToPage).toHaveBeenCalledWith(6);
    });
    expect(persistence.loadBookmarkDashboard).toHaveBeenCalled();
    expect(persistence.listAllAnnotations).toHaveBeenCalled();
  });

  it('keeps a manager workspace visible when reopening a bookmark record fails', async () => {
    const bookmarkRecords: PersistedBookmarkRecord[] = [
      {
        id: 19,
        documentKey: 'desktop:/tmp/missing-bookmark.pdf',
        page: 6,
        title: '失效书签',
        note: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        documentDisplayName: 'missing-bookmark.pdf',
        documentPath: '/tmp/missing-bookmark.pdf',
        documentMissing: false,
      },
    ];
    const readDesktopPdf = vi.fn().mockRejectedValue(new Error('file does not exist'));
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/missing-bookmark.pdf',
          path: '/tmp/missing-bookmark.pdf',
          displayName: 'missing-bookmark.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadBookmarkDashboard: vi.fn().mockResolvedValue(
        dashboardFromRecords(bookmarkRecords, 2048, 20),
      ),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    expect(await screen.findByRole('region', { name: '书签管理' })).toBeInTheDocument();
    fireEvent.click(await screen.findByText('失效书签'));
    fireEvent.click(screen.getByRole('button', { name: '跳转到书签 失效书签' }));

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/missing-bookmark.pdf');
    });
    expect(screen.getByRole('region', { name: '书签管理' })).toBeInTheDocument();
    expect(screen.queryByLabelText('阅读工作区')).not.toBeInTheDocument();
  });

  it('opens global search from the top-bar search box and shows recent file results', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/research.pdf',
          path: '/tmp/research.pdf',
          displayName: 'research.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByLabelText('全局搜索'));
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'research' },
    });

    expect(dialog).toBeInTheDocument();
    expect(await within(dialog).findByText('打开文件')).toBeInTheDocument();
    expect(persistence.loadBookmarkDashboard).toHaveBeenCalled();
    expect(persistence.listAllAnnotations).toHaveBeenCalled();
  });

  it('shows provider load errors without hiding successful global search results', async () => {
    const annotationRecords: PersistedAnnotationRecord[] = [
      {
        id: 21,
        documentKey: 'desktop:/tmp/research.pdf',
        page: 5,
        type: 'note',
        color: '#facc15',
        text: 'research note',
        quote: null,
        areas: [],
        tagIds: [],
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        documentDisplayName: 'research.pdf',
        documentPath: '/tmp/research.pdf',
        documentMissing: false,
      },
    ];
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/research.pdf',
          path: '/tmp/research.pdf',
          displayName: 'research.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadBookmarkDashboard: vi.fn().mockRejectedValue(new Error('bookmark provider failed')),
      listAllAnnotations: vi.fn().mockResolvedValue(annotationRecords),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByLabelText('全局搜索'));
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'research' },
    });

    expect(await within(dialog).findByText('打开文件')).toBeInTheDocument();
    expect(await within(dialog).findByText('research note')).toBeInTheDocument();
    expect(within(dialog).getByText('书签加载失败，请重试。')).toBeInTheDocument();
  });

  it('opens global search from Meta+K', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();
  });

  it('opens global search from Ctrl+K', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(await screen.findByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();
  });

  it('opens a recent file from a global search result', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:global-search');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/research.pdf', name: 'research.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-07-01T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/research.pdf',
          path: '/tmp/research.pdf',
          displayName: 'research.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'research' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: /research\.pdf/ }));

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/research.pdf');
    });
    expect(await screen.findByRole('tab', { name: 'research.pdf' })).toBeInTheDocument();
  });

  it('does not run reader shortcuts while global search is open', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shortcut-modal');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-1.7'], 'shortcut.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByRole('tab', { name: 'shortcut.pdf' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();

    const closeShortcut = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(closeShortcut);

    expect(closeShortcut.defaultPrevented).toBe(true);
    expect(screen.getByRole('tab', { name: 'shortcut.pdf' })).toBeInTheDocument();
  });

  it('closes global search with Escape from a result and restores prior focus', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/focus.pdf',
          path: '/tmp/focus.pdf',
          displayName: 'focus.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    const trigger = screen.getByLabelText('全局搜索');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'focus' },
    });
    const result = await within(dialog).findByRole('button', { name: /focus\.pdf/ });

    result.focus();
    fireEvent.keyDown(result, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('does not reopen global search after closing activation from an already focused search trigger', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    const trigger = screen.getByLabelText('全局搜索');

    trigger.focus();
    const focusDialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.keyDown(focusDialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const keyboardDialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.keyDown(keyboardDialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('does not reopen global search after Meta+K closes back to a focused search trigger', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    const trigger = screen.getByLabelText('全局搜索');

    trigger.focus();
    const focusDialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.keyDown(focusDialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const keyboardDialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.keyDown(keyboardDialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('returns to the reader workspace after opening a global search result from settings', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:settings-global-search');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const readDesktopPdf = vi.fn().mockResolvedValue({
      source: {
        kind: 'desktop-path',
        path: '/tmp/settings-result.pdf',
        name: 'settings-result.pdf',
      },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-07-01T00:00:00Z',
    });
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/settings-result.pdf',
          path: '/tmp/settings-result.pdf',
          displayName: 'settings-result.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
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

    fireEvent.click(topShortcuts().getByRole('button', { name: '设置' }));
    expect(await screen.findByLabelText('设置工作区')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'settings-result' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: /settings-result\.pdf/ }));

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/settings-result.pdf');
    });
    expect(await screen.findByRole('tab', { name: 'settings-result.pdf' })).toBeInTheDocument();
    expect(screen.getByLabelText('阅读工作区')).toBeInTheDocument();
    expect(screen.queryByLabelText('设置工作区')).not.toBeInTheDocument();
  });

  it('keeps a tool workspace visible when a global search result cannot reopen', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/missing-from-search.pdf',
          path: '/tmp/missing-from-search.pdf',
          displayName: 'missing-from-search.pdf',
          fileSize: 2048,
          modifiedAt: '2026-07-01T00:00:00Z',
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ]),
      loadReaderSession: vi.fn().mockResolvedValue(null),
    };
    const readDesktopPdf = vi.fn().mockRejectedValue(new Error('file does not exist'));

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(topShortcuts().getByRole('button', { name: '设置' }));
    expect(await screen.findByLabelText('设置工作区')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'missing-from-search' },
    });
    fireEvent.click(
      await within(dialog).findByRole('button', { name: /missing-from-search\.pdf/ }),
    );

    await waitFor(() => {
      expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/missing-from-search.pdf');
    });
    expect(screen.getByLabelText('设置工作区')).toBeInTheDocument();
    expect(screen.queryByLabelText('阅读工作区')).not.toBeInTheDocument();
  });

  it('keeps focus inside global search when tabbing past dialog controls', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    const searchInput = within(dialog).getByLabelText('全局搜索关键词');
    const closeButton = within(dialog).getByRole('button', { name: '关闭全局搜索' });

    closeButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(searchInput).toHaveFocus();
  });

  it('ignores stale global search collection refreshes', async () => {
    const oldBookmarks: PersistedBookmarkRecord[] = [
      {
        id: 1,
        documentKey: 'desktop:/tmp/old.pdf',
        page: 3,
        title: 'Old bookmark',
        note: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        documentDisplayName: 'old.pdf',
        documentPath: '/tmp/old.pdf',
        documentMissing: false,
      },
    ];
    const freshBookmarks: PersistedBookmarkRecord[] = [
      {
        id: 2,
        documentKey: 'desktop:/tmp/fresh.pdf',
        page: 8,
        title: 'Fresh bookmark',
        note: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        documentDisplayName: 'fresh.pdf',
        documentPath: '/tmp/fresh.pdf',
        documentMissing: false,
      },
    ];
    const firstBookmarkLoad = createDeferred<BookmarkDashboard>();
    const secondBookmarkLoad = createDeferred<BookmarkDashboard>();
    const persistence = {
      ...createEmptyPersistence(),
      loadBookmarkDashboard: vi
        .fn()
        .mockReturnValueOnce(firstBookmarkLoad.promise)
        .mockReturnValueOnce(secondBookmarkLoad.promise),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(await screen.findByRole('dialog', { name: '全局搜索' }), { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByPlaceholderText('搜索文件、书签、批注...'), {
      target: { value: 'bookmark' },
    });

    await waitFor(() => {
      expect(persistence.loadBookmarkDashboard).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondBookmarkLoad.resolve(dashboardFromRecords(freshBookmarks));
      await secondBookmarkLoad.promise;
    });
    expect(await within(dialog).findByText('Fresh bookmark')).toBeInTheDocument();

    await act(async () => {
      firstBookmarkLoad.resolve(dashboardFromRecords(oldBookmarks));
      await firstBookmarkLoad.promise;
    });

    expect(within(dialog).getByText('Fresh bookmark')).toBeInTheDocument();
    expect(within(dialog).queryByText('Old bookmark')).not.toBeInTheDocument();
  });

  it('updates a managed bookmark once and refreshes the shared dashboard', async () => {
    const original: PersistedBookmarkRecord = {
      id: 21,
      documentKey: 'desktop:/tmp/edit.pdf',
      page: 7,
      title: 'Original bookmark',
      note: null,
      createdAt: '2026-07-20T00:00:00Z',
      updatedAt: '2026-07-20T00:00:00Z',
      documentDisplayName: 'edit.pdf',
      documentPath: '/tmp/edit.pdf',
      documentMissing: false,
    };
    const updated: PersistedBookmarkRecord = {
      ...original,
      title: 'Updated bookmark',
      note: 'Review this result',
      updatedAt: '2026-07-20T01:00:00Z',
    };
    const saveBookmark = vi
      .fn()
      .mockImplementation(async (bookmark) => ({ ...bookmark, id: original.id }));
    const persistence = {
      ...createEmptyPersistence(),
      saveBookmark,
      loadBookmarkDashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboardFromRecords([original], 1024, 10))
        .mockResolvedValueOnce(dashboardFromRecords([updated], 1024, 10)),
    };
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    fireEvent.click(await screen.findByText('Original bookmark'));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注 Original bookmark' }));
    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: 'Updated bookmark' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: 'Review this result' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));

    await waitFor(() => {
      expect(saveBookmark).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 21,
          title: 'Updated bookmark',
          note: 'Review this result',
        }),
      );
    });
    expect(await screen.findAllByText('Updated bookmark')).not.toHaveLength(0);
    expect(persistence.loadBookmarkDashboard).toHaveBeenCalledTimes(2);
  });

  it('deletes selected bookmarks sequentially and retains the failed record', async () => {
    const records: PersistedBookmarkRecord[] = [
      {
        id: 31,
        documentKey: 'desktop:/tmp/batch.pdf',
        page: 3,
        title: 'Delete success',
        note: null,
        createdAt: '2026-07-20T00:00:00Z',
        updatedAt: '2026-07-20T00:00:00Z',
        documentDisplayName: 'batch.pdf',
        documentPath: '/tmp/batch.pdf',
        documentMissing: false,
      },
      {
        id: 32,
        documentKey: 'desktop:/tmp/batch.pdf',
        page: 4,
        title: 'Delete failure',
        note: null,
        createdAt: '2026-07-20T01:00:00Z',
        updatedAt: '2026-07-20T01:00:00Z',
        documentDisplayName: 'batch.pdf',
        documentPath: '/tmp/batch.pdf',
        documentMissing: false,
      },
    ];
    const calls: string[] = [];
    const deleteBookmark = vi.fn().mockImplementation(async (id: number) => {
      calls.push(`start:${id}`);
      await Promise.resolve();
      calls.push(`finish:${id}`);
      if (id === 32) {
        throw new Error('delete failed');
      }
    });
    const persistence = {
      ...createEmptyPersistence(),
      deleteBookmark,
      loadBookmarkDashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboardFromRecords(records, 1024, 10))
        .mockResolvedValueOnce(dashboardFromRecords([records[1]], 1024, 10)),
    };
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    await screen.findByText('Delete success');
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 Delete success' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 Delete failure' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条书签' }));
    fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('成功 1 条，失败 1 条');
    });
    expect(calls).toEqual([
      'start:31',
      'finish:31',
      'start:32',
      'finish:32',
    ]);
    expect(screen.queryByText('Delete success')).not.toBeInTheDocument();
    expect(screen.getByText('Delete failure')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择书签 Delete failure' })).toBeChecked();
  });

  it('retains the last successful dashboard after a background refresh fails', async () => {
    const records: PersistedBookmarkRecord[] = [
      {
        id: 41,
        documentKey: 'desktop:/tmp/retained.pdf',
        page: 5,
        title: 'Retained bookmark',
        note: null,
        createdAt: '2026-07-20T00:00:00Z',
        updatedAt: '2026-07-20T00:00:00Z',
        documentDisplayName: 'retained.pdf',
        documentPath: '/tmp/retained.pdf',
        documentMissing: false,
      },
    ];
    const persistence = {
      ...createEmptyPersistence(),
      loadBookmarkDashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboardFromRecords(records, 1024, 10))
        .mockRejectedValueOnce(new Error('refresh failed')),
    };
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    expect(await screen.findByText('Retained bookmark')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('全局搜索'));
    const searchDialog = await screen.findByRole('dialog', { name: '全局搜索' });
    await within(searchDialog).findByText('书签加载失败，请重试。');
    fireEvent.click(within(searchDialog).getByRole('button', { name: '关闭全局搜索' }));

    expect(screen.getByText('Retained bookmark')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('书签加载失败，请重试。');
    expect(screen.getByRole('button', { name: '重新加载书签' })).toBeInTheDocument();
  });

  it('shows inline manager errors when persisted records fail to load', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      loadBookmarkDashboard: vi.fn().mockRejectedValue(new Error('bookmark provider failed')),
      listAllAnnotations: vi.fn().mockRejectedValue(new Error('annotation provider failed')),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(topShortcuts().getByRole('button', { name: '批注管理' }));
    expect(await screen.findByText('批注加载失败，请重试。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    await waitFor(() => {
      expect(screen.getAllByText('书签加载失败，请重试。').length).toBeGreaterThan(0);
    });
  });
});
