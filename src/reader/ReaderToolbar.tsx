import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListOrdered,
  MoveLeft,
  MoveRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Star,
  StickyNote,
  X,
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
  outlineOpen?: boolean;
  outlineButtonRef?: RefObject<HTMLButtonElement>;
  onToggleOutline?(): void;
  documentInfoOpen?: boolean;
  documentInfoButtonRef?: RefObject<HTMLButtonElement>;
  onToggleDocumentInfo?(): void;
  onSearchTextChange(value: string): void;
  onPageInputChange(value: string): void;
  onSearchCompositionChange(composing: boolean): void;
  onSearchNext(): void;
  onSearchPrevious(): void;
  onJumpToPage(): void;
  onPagePrevious(): void;
  onPageNext(): void;
  onToggleSidebar(): void;
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
  outlineOpen = false,
  outlineButtonRef,
  onToggleOutline,
  documentInfoOpen = false,
  documentInfoButtonRef,
  onToggleDocumentInfo,
  onSearchTextChange,
  onPageInputChange,
  onSearchCompositionChange,
  onSearchNext,
  onSearchPrevious,
  onJumpToPage,
  onPagePrevious,
  onPageNext,
  onToggleSidebar,
  onAddBookmark,
  onAddNote,
  isFavorite,
  onToggleFavorite,
  onOpenPreferences,
}: ReaderToolbarProps) {
  const totalPages = activeSession?.totalPages ?? null;
  const keyword = searchText.trim();
  const searchReady = Boolean(keyword) && searchState.keyword === keyword;
  const hasMatches = searchReady && searchState.matches.length > 0;
  const matchSummary = !keyword ? null
    : !searchReady ? '查找中…'
    : searchState.error ? '查找失败'
    : hasMatches ? `${searchState.currentIndex} / ${searchState.matches.length}` : '无匹配';
  const targetPage = Number(pageInput);

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
        <button type="button" className="toolbar-text-button toolbar-panel-toggle" ref={documentInfoButtonRef} onClick={onToggleDocumentInfo}
          title={documentInfoOpen ? '收起文献信息' : '展开文献信息'} aria-expanded={documentInfoOpen}
          aria-controls={documentInfoOpen ? 'reader-document-info' : undefined}
          disabled={!activeSession || !onToggleDocumentInfo}>
          <FileText size={16} aria-hidden="true" />文献信息
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group toolbar-search-group" role="group" aria-label="文档查找">
        <button type="button" className="toolbar-icon-button" onClick={onSearchPrevious}
          aria-label="Previous match" title="上一处匹配（Shift+Enter）" disabled={!hasMatches}>
          <MoveLeft size={16} aria-hidden="true" />
        </button>
        <div className="toolbar-search-field">
          <Search size={15} className="toolbar-search-icon" aria-hidden="true" />
          <input
            aria-label="Search text"
            ref={searchInputRef}
            className="toolbar-input toolbar-search-input"
            value={searchText}
            placeholder="在文档中查找…"
            disabled={activeSession?.status !== 'ready'}
            onChange={(event) => onSearchTextChange(event.target.value)}
            onCompositionStart={() => onSearchCompositionChange(true)}
            onCompositionEnd={(event) => {
              onSearchTextChange(event.currentTarget.value);
              onSearchCompositionChange(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                if (hasMatches) (event.shiftKey ? onSearchPrevious : onSearchNext)();
              }
            }}
          />
          {searchText ? (
            <button type="button" className="toolbar-search-clear" aria-label="清除查找"
              onClick={() => {
                onSearchTextChange('');
                onSearchCompositionChange(false);
                searchInputRef?.current?.focus();
              }}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onSearchNext}
          aria-label="Next match"
          title="下一处匹配（Enter）"
          disabled={!hasMatches}
        >
          <MoveRight size={16} aria-hidden="true" />
        </button>
        {matchSummary ? (
          <span className="toolbar-match-count" aria-live="polite" title={searchReady ? searchState.error : undefined}>
            {matchSummary}
          </span>
        ) : null}
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group" role="group" aria-label="页码跳转">
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onPagePrevious}
          aria-label="Previous page"
          title="上一页"
          disabled={!activeSession || activeSession.page <= 1}
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
          <button type="button" className="toolbar-text-button" onClick={onJumpToPage} aria-label="Go to page"
            disabled={!activeSession || !Number.isSafeInteger(targetPage) || targetPage <= 0}>
            跳转
          </button>
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onPageNext}
          aria-label="Next page"
          title="下一页"
          disabled={!activeSession || (totalPages !== null && activeSession.page >= totalPages)}
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
