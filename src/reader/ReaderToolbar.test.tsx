import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../documents/documentModels';
import {
  defaultSearchOptions,
  emptySearchState,
  type ViewerSearchState,
} from '../viewer/viewerTypes';
import { ReaderToolbar } from './ReaderToolbar';

type ReaderToolbarTestProps = Omit<
  Parameters<typeof ReaderToolbar>[0],
  'onOpenPdf' | 'onBrowserFileChange' | 'onCloseActiveTab'
>;

const ReaderToolbarUnderTest = ReaderToolbar as unknown as ComponentType<ReaderToolbarTestProps>;

function createSession(): DocumentSession {
  return {
    id: 'session-a',
    documentKey: 'desktop:/tmp/book.pdf',
    title: 'book.pdf',
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    page: 3,
    totalPages: 20,
    progress: 15,
    zoom: 1,
    history: { currentPage: 3, backStack: [], forwardStack: [] },
    status: 'ready',
    errorMessage: null,
    restored: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function renderToolbar(searchState: ViewerSearchState) {
  return render(
    <ReaderToolbarUnderTest
      activeSession={createSession()}
      searchText="method"
      searchState={searchState}
      pageInput="3"
      sidebarOpen={true}
      onSearchTextChange={vi.fn()}
      onPageInputChange={vi.fn()}
      onSearch={vi.fn()}
      onSearchNext={vi.fn()}
      onSearchPrevious={vi.fn()}
      onJumpToPage={vi.fn()}
      onPagePrevious={vi.fn()}
      onPageNext={vi.fn()}
      onFitWidth={vi.fn()}
      onFitPage={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onToggleSidebar={vi.fn()}
      onHistoryBack={vi.fn()}
      onHistoryForward={vi.fn()}
      onAddBookmark={vi.fn()}
      onAddNote={vi.fn()}
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      onOpenPreferences={vi.fn()}
    />,
  );
}

describe('ReaderToolbar search state', () => {
  it('keeps reading actions without document lifecycle controls', () => {
    renderToolbar(emptySearchState);

    expect(screen.queryByRole('button', { name: '打开' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择 PDF 文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close active tab' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('在文档中查找…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add bookmark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建批注' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏当前文档' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
  });

  it('reports the focused match and the total match count', () => {
    renderToolbar({
      keyword: 'method',
      matches: [
        { index: 1, page: 2, excerpt: 'a' },
        { index: 2, page: 6, excerpt: 'b' },
        { index: 3, page: 9, excerpt: 'c' },
      ],
      currentIndex: 2,
      options: defaultSearchOptions,
    });

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Next match')).toBeEnabled();
  });

  it('says so when a search returned nothing instead of showing a count', () => {
    renderToolbar({
      keyword: 'method',
      matches: [],
      currentIndex: 0,
      options: defaultSearchOptions,
    });

    expect(screen.getByText('无匹配')).toBeInTheDocument();
    expect(screen.getByLabelText('Next match')).toBeDisabled();
  });

  it('shows no count at all before a search has run', () => {
    renderToolbar(emptySearchState);

    expect(screen.queryByText('无匹配')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Previous match')).toBeDisabled();
  });
});
