import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Star,
  StickyNote,
} from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { DocumentSession } from '../documents/documentModels';
import type { ViewerSearchState } from '../viewer/viewerTypes';

type ReaderToolbarProps = {
  themeSwitcher?: ReactNode;
  activeSession: DocumentSession | null;
  searchText: string;
  searchState: ViewerSearchState;
  searchInputRef?: RefObject<HTMLInputElement>;
  pageInput: string;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  outlineOpen?: boolean;
  outlineButtonRef?: RefObject<HTMLButtonElement>;
  onToggleOutline?(): void;
  documentInfoOpen?: boolean;
  documentInfoButtonRef?: RefObject<HTMLButtonElement>;
  onToggleDocumentInfo?(): void;
  onSearchTextChange(value: string): void;
  onPageInputChange(value: string): void;
  onSearch(): void;
  onSearchNext(): void;
  onSearchPrevious(): void;
  onJumpToPage(): void;
  onPagePrevious(): void;
  onPageNext(): void;
  onToggleSidebar(): void;
  onToggleRightPanel(): void;
  onHistoryBack(): void;
  onHistoryForward(): void;
  onAddBookmark(): void | Promise<void>;
  onAddNote(): void | Promise<void>;
  isFavorite: boolean;
  onToggleFavorite(): void | Promise<void>;
  onOpenPreferences(): void;
};

export function ReaderToolbar({
  themeSwitcher,
  activeSession,
  searchText,
  searchState,
  searchInputRef,
  pageInput,
  sidebarOpen,
  rightPanelOpen,
  outlineOpen = false,
  outlineButtonRef,
  onToggleOutline,
  documentInfoOpen = false,
  documentInfoButtonRef,
  onToggleDocumentInfo,
  onSearchTextChange,
  onPageInputChange,
  onSearch,
  onSearchNext,
  onSearchPrevious,
  onJumpToPage,
  onPagePrevious,
  onPageNext,
  onToggleSidebar,
  onToggleRightPanel,
  onHistoryBack,
  onHistoryForward,
  onAddBookmark,
  onAddNote,
  isFavorite,
  onToggleFavorite,
  onOpenPreferences,
}: ReaderToolbarProps) {
  const totalPages = activeSession?.totalPages ?? null;
  const hasMatches = searchState.matches.length > 0;
  // Only report counts once a search has actually run, so an empty result is
  // distinguishable from "no search yet".
  const matchSummary = !searchState.keyword
    ? null
    : hasMatches
      ? `${searchState.currentIndex} / ${searchState.matches.length}`
      : '无匹配';

  return (
    <section className="reader-toolbar" aria-label="阅读工具栏">
      <div className="toolbar-group">
        <button type="button" className="toolbar-text-button toolbar-panel-toggle" ref={outlineButtonRef} onClick={onToggleOutline}
          title={outlineOpen ? '收起 PDF 目录' : '展开 PDF 目录'} aria-expanded={outlineOpen}
          aria-controls={outlineOpen ? 'reader-outline' : undefined}
          disabled={!activeSession || activeSession.status === 'error' || !onToggleOutline}>
          <ListOrdered size={16} aria-hidden="true" />目录
        </button>
        <button
          type="button"
          className="toolbar-text-button toolbar-panel-toggle"
          onClick={onToggleSidebar}
          title={sidebarOpen ? '收起当前阅读' : '展开当前阅读'}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarOpen ? 'reader-current-reading' : undefined}
        >
          {sidebarOpen ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}当前阅读
        </button>
        <button
          type="button"
          className="toolbar-text-button toolbar-panel-toggle"
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? '收起搜索与批注' : '展开搜索与批注'}
          aria-expanded={rightPanelOpen}
          aria-controls={rightPanelOpen ? 'reader-inspector' : undefined}
        >
          {rightPanelOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}搜索与批注
        </button>
        <button type="button" className="toolbar-text-button toolbar-panel-toggle" ref={documentInfoButtonRef} onClick={onToggleDocumentInfo}
          title={documentInfoOpen ? '收起文献信息' : '展开文献信息'} aria-expanded={documentInfoOpen}
          aria-controls={documentInfoOpen ? 'reader-document-info' : undefined}
          disabled={!activeSession || !onToggleDocumentInfo}>
          <FileText size={16} aria-hidden="true" />文献信息
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group toolbar-search-group">
        <Search size={15} className="toolbar-search-icon" aria-hidden="true" />
        <input
          aria-label="Search text"
          ref={searchInputRef}
          className="toolbar-input toolbar-search-input"
          value={searchText}
          placeholder="在文档中查找…"
          onChange={(event) => onSearchTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) {
                onSearchPrevious();
              } else {
                onSearch();
              }
            }
          }}
        />
        <button type="button" className="toolbar-text-button" onClick={onSearch} aria-label="Search PDF">
          查找
        </button>
        {matchSummary ? (
          <span className="toolbar-match-count" aria-live="polite">
            {matchSummary}
          </span>
        ) : null}
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onSearchPrevious}
          aria-label="Previous match"
          title="上一处匹配"
          disabled={!hasMatches}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onSearchNext}
          aria-label="Next match"
          title="下一处匹配"
          disabled={!hasMatches}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onHistoryBack}
          aria-label="History back"
          title="后退"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onHistoryForward}
          aria-label="History forward"
          title="前进"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onPagePrevious}
          aria-label="Previous page"
          title="上一页"
          disabled={!activeSession}
        >
          <ChevronLeft size={16} />
        </button>
        <div className="toolbar-page-control">
          <input
            aria-label="Page number"
            className="page-input"
            inputMode="numeric"
            value={pageInput}
            onChange={(event) => onPageInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onJumpToPage();
              }
            }}
          />
          <span className="toolbar-page-total" aria-hidden="true">
            / {totalPages ?? '—'}
          </span>
          <button type="button" className="toolbar-text-button" onClick={onJumpToPage} aria-label="Go to page">
            跳转
          </button>
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onPageNext}
          aria-label="Next page"
          title="下一页"
          disabled={!activeSession}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="toolbar-group push">
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={() => void onAddBookmark()}
          aria-label="Add bookmark"
          title="添加书签"
          disabled={!activeSession}
        >
          <BookmarkPlus size={16} />
        </button>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={() => void onAddNote()}
          aria-label="新建批注"
          title="添加页面笔记"
          disabled={!activeSession}
        >
          <StickyNote size={16} />
        </button>
        <button
          type="button"
          className={isFavorite ? 'toolbar-icon-button favorite-toggle active' : 'toolbar-icon-button favorite-toggle'}
          onClick={() => void onToggleFavorite()}
          disabled={!activeSession}
          aria-label={isFavorite ? '取消收藏当前文档' : '收藏当前文档'}
          aria-pressed={isFavorite}
          title={isFavorite ? '取消收藏' : '收藏'}
        >
          <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        {themeSwitcher}
        <button
          type="button"
          className="toolbar-text-button"
          onClick={onOpenPreferences}
          aria-label="More options"
          title="设置"
        >
          设置
        </button>
      </div>
    </section>
  );
}
