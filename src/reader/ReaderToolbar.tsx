import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FolderOpen,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Star,
  StickyNote,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ChangeEventHandler } from 'react';
import type { DocumentSession } from '../documents/documentModels';

type ReaderToolbarProps = {
  activeSession: DocumentSession | null;
  searchText: string;
  pageInput: string;
  sidebarOpen: boolean;
  onOpenPdf(): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onSearchTextChange(value: string): void;
  onPageInputChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
  onSearchNext(): void;
  onSearchPrevious(): void;
  onJumpToPage(): void;
  onPagePrevious(): void;
  onPageNext(): void;
  onFitWidth(): void;
  onFitPage(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onToggleSidebar(): void;
  onCloseActiveTab(): void;
  onHistoryBack(): void;
  onHistoryForward(): void;
  onAddBookmark(): void | Promise<void>;
  onAddNote(): void | Promise<void>;
  isFavorite: boolean;
  onToggleFavorite(): void | Promise<void>;
  onOpenPreferences(): void;
};

export function ReaderToolbar({
  activeSession,
  searchText,
  pageInput,
  sidebarOpen,
  onOpenPdf,
  onBrowserFileChange,
  onSearchTextChange,
  onPageInputChange,
  onOpenSearch,
  onSearch,
  onSearchNext,
  onSearchPrevious,
  onJumpToPage,
  onPagePrevious,
  onPageNext,
  onFitWidth,
  onFitPage,
  onZoomIn,
  onZoomOut,
  onToggleSidebar,
  onCloseActiveTab,
  onHistoryBack,
  onHistoryForward,
  onAddBookmark,
  onAddNote,
  isFavorite,
  onToggleFavorite,
  onOpenPreferences,
}: ReaderToolbarProps) {
  const totalPages = activeSession?.totalPages ?? null;
  const zoomPercent = Math.round((activeSession?.zoom ?? 1) * 100);

  return (
    <section className="reader-toolbar" aria-label="阅读工具栏">
      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <button type="button" className="toolbar-text-button" onClick={onOpenPdf}>
          <FolderOpen size={16} />
          <span>打开</span>
        </button>
        <label className="toolbar-icon-button toolbar-file-button" title="从浏览器选择 PDF 文件">
          <FileDown size={16} />
          <input
            aria-label="选择 PDF 文件"
            type="file"
            accept="application/pdf,.pdf"
            onChange={onBrowserFileChange}
          />
        </label>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group toolbar-search-group">
        <Search size={15} className="toolbar-search-icon" aria-hidden="true" />
        <input
          aria-label="Search text"
          className="toolbar-input toolbar-search-input"
          value={searchText}
          placeholder="在文档中查找…"
          onChange={(event) => onSearchTextChange(event.target.value)}
          onFocus={onOpenSearch}
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
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onSearchPrevious}
          aria-label="Previous match"
          title="上一处匹配"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="toolbar-icon-button"
          onClick={onSearchNext}
          aria-label="Next match"
          title="下一处匹配"
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

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group">
        <button type="button" className="toolbar-icon-button" onClick={onZoomOut} aria-label="Zoom out" title="缩小">
          <ZoomOut size={16} />
        </button>
        <span className="toolbar-zoom-label" aria-live="polite">
          {zoomPercent}%
        </span>
        <button type="button" className="toolbar-icon-button" onClick={onZoomIn} aria-label="Zoom in" title="放大">
          <ZoomIn size={16} />
        </button>
        <button type="button" className="toolbar-text-button" onClick={onFitWidth} aria-label="Fit width" title="适合宽度">
          适宽
        </button>
        <button type="button" className="toolbar-text-button" onClick={onFitPage} aria-label="Fit page" title="适合整页">
          <Maximize2 size={14} />
          整页
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
        <button
          type="button"
          className="toolbar-text-button"
          onClick={onOpenPreferences}
          aria-label="More options"
          title="设置"
        >
          设置
        </button>
        <button
          type="button"
          className="toolbar-icon-button toolbar-danger"
          onClick={onCloseActiveTab}
          disabled={!activeSession}
          aria-label="Close active tab"
          title="关闭标签"
        >
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
