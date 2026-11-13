import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { ViewerController } from '../viewer/viewerController';
import { emptySearchState } from '../viewer/viewerTypes';
import { ReaderWorkspaceView } from './ReaderWorkspaceView';

type ReaderWorkspaceViewTestProps = Omit<
  Parameters<typeof ReaderWorkspaceView>[0],
  'closeActiveTab' | 'handleBrowserFileChange' | 'openPdfAndIgnoreResult'
>;

const ReaderWorkspaceViewUnderTest =
  ReaderWorkspaceView as unknown as ComponentType<ReaderWorkspaceViewTestProps>;

function createSession(): DocumentSession {
  return {
    id: 'session-a',
    documentKey: 'desktop:/tmp/book.pdf',
    title: 'book.pdf',
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    page: 2,
    totalPages: 10,
    progress: 20,
    zoom: 1,
    history: { currentPage: 2, backStack: [1], forwardStack: [] },
    status: 'ready',
    errorMessage: null,
    restored: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('ReaderWorkspaceView', () => {
  it('renders the active reader workspace shell and routes outline jumps through reader navigation', () => {
    const activeSession = createSession();
    const annotations: ReaderAnnotation[] = [];
    const jumpToActiveDocumentPage = vi.fn();
    const toggleFavorite = vi.fn();

    render(
      <ReaderWorkspaceViewUnderTest
        activeAnnotations={annotations}
        activeBookmarks={[]}
        activeSession={activeSession}
        activeSessionIsFavorite={false}
        activeViewerController={new ViewerController()}
        availableTags={[]}
        pageInput="2"
        searchState={emptySearchState}
        documentInfo={{
          sessionId: activeSession.id, pageCount: 10, pdfVersion: null, title: null, author: null,
          subject: null, keywords: null, creator: null, producer: null,
          outline: [{ id: '0', title: '第一章', page: 3, children: [] }],
        }}
        documentRecord={null}
        searchInputRef={{ current: null }}
        searchText=""
        selectedAnnotation={null}
        sidebarOpen={true}
        viewerContent={<div>Viewer content</div>}
        addBookmarkForActivePage={vi.fn()}
        addPageNote={vi.fn()}
        deleteBookmark={vi.fn()}
        deleteAnnotationForDocument={vi.fn()}
        handleSaveAnnotationNote={vi.fn()}
        handleToggleActiveFavorite={toggleFavorite}
        handleToggleAnnotationTag={vi.fn()}
        handleViewerWheel={vi.fn()}
        importAnnotationsForDocument={vi.fn()}
        jumpToActiveDocumentPage={jumpToActiveDocumentPage}
        jumpToPage={vi.fn()}
        openSettingsWorkspace={vi.fn()}
        renameBookmark={vi.fn()}
        setPageInput={vi.fn()}
        setSearchText={vi.fn()}
        setSearchComposing={vi.fn()}
        setSelectedAnnotationId={vi.fn()}
        setSidebarOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Viewer content')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '阅读工具栏' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: '已打开文档' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择 PDF 文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close active tab' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('在文档中查找…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
    expect(screen.getByLabelText('阅读侧栏')).toBeInTheDocument();
    expect(screen.queryByLabelText('阅读检查器')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('阅读侧栏')).queryByLabelText('目录内容')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'PDF 目录' })).not.toBeInTheDocument();
    const outlineButton = screen.getByRole('button', { name: '目录' });
    outlineButton.focus();
    fireEvent.click(outlineButton);
    const drawer = screen.getByRole('complementary', { name: 'PDF 目录' });
    expect(drawer).toHaveClass('reader-drawer');
    const reading = screen.getByLabelText('阅读侧栏');
    expect(drawer.nextElementSibling).toBe(reading);
    expect(outlineButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).queryByText('书签与批注')).not.toBeInTheDocument();
    const infoButton = screen.getByRole('button', { name: '文献信息' });
    expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(infoButton);
    const infoDrawer = screen.getByRole('complementary', { name: '文献信息' });
    expect(infoDrawer.previousElementSibling).toHaveClass('viewer-pane');
    expect(within(infoDrawer).getByText('/tmp/book.pdf')).toBeInTheDocument();
    fireEvent.click(within(infoDrawer).getByRole('button', { name: '收藏文档' }));
    expect(toggleFavorite).toHaveBeenCalledOnce();
    fireEvent.click(within(infoDrawer).getByRole('button', { name: '关闭文献信息' }));
    expect(infoButton).toHaveFocus();
    expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toBeInTheDocument();
    fireEvent.click(infoButton);
    fireEvent.click(infoButton);
    expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '第一章，第 3 页' }));
    expect(jumpToActiveDocumentPage).toHaveBeenCalledExactlyOnceWith(3);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'PDF 目录' })).not.toBeInTheDocument();
    expect(outlineButton).toHaveFocus();
    fireEvent.click(outlineButton);
    fireEvent.click(screen.getByRole('button', { name: '关闭PDF 目录' }));
    expect(outlineButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(outlineButton);
    fireEvent.click(outlineButton);
    expect(outlineButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: '当前阅读' }));

    expect(screen.getByRole('button', { name: '当前阅读' })).toHaveAttribute(
      'title',
      '收起当前阅读',
    );

  });
});
