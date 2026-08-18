import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { ViewerController } from '../viewer/viewerController';
import { defaultSearchOptions, emptySearchState } from '../viewer/viewerTypes';
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
  it('renders the active reader workspace shell', () => {
    const activeSession = createSession();
    const annotations: ReaderAnnotation[] = [];

    render(
      <ReaderWorkspaceViewUnderTest
        activeAnnotations={annotations}
        activeBookmarks={[]}
        activeSession={activeSession}
        activeSessionIsFavorite={false}
        activeViewerController={new ViewerController()}
        availableTags={[]}
        lastSearchCommand=""
        pageInput="2"
        searchState={emptySearchState}
        searchOptions={defaultSearchOptions}
        documentInfo={null}
        documentRecord={null}
        searchInputRef={{ current: null }}
        searchText=""
        selectedAnnotation={null}
        sidebarOpen={true}
        rightPanelOpen={true}
        viewerContent={<div>Viewer content</div>}
        addBookmarkForActivePage={vi.fn()}
        addPageNote={vi.fn()}
        clearSearch={vi.fn()}
        deleteBookmark={vi.fn()}
        deleteAnnotationForDocument={vi.fn()}
        handleSaveAnnotationNote={vi.fn()}
        handleToggleActiveFavorite={vi.fn()}
        handleToggleAnnotationTag={vi.fn()}
        handleViewerWheel={vi.fn()}
        importAnnotationsForDocument={vi.fn()}
        jumpToActiveDocumentPage={vi.fn()}
        jumpToPage={vi.fn()}
        jumpToSearchMatch={vi.fn()}
        setSearchOptions={vi.fn()}
        openSettingsWorkspace={vi.fn()}
        renameBookmark={vi.fn()}
        runSearch={vi.fn()}
        setPageInput={vi.fn()}
        setSearchText={vi.fn()}
        setSelectedAnnotationId={vi.fn()}
        setSidebarOpen={vi.fn()}
        setRightPanelOpen={vi.fn()}
        stepHistoryBack={vi.fn()}
        stepHistoryForward={vi.fn()}
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
    expect(screen.getByLabelText('阅读检查器')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right sidebar' }));

    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute(
      'title',
      '收起侧栏',
    );
    expect(screen.getByRole('button', { name: 'Toggle right sidebar' })).toHaveAttribute(
      'title',
      '收起右侧栏',
    );
  });
});
