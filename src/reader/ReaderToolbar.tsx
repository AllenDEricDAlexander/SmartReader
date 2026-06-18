import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FolderOpen,
  History,
  MoreHorizontal,
  PanelLeftClose,
  Search,
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
  onOpenPdf(): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onSearchTextChange(value: string): void;
  onPageInputChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
  onJumpToPage(): void;
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
  onOpenPreferences(): void;
};

export function ReaderToolbar({
  activeSession,
  searchText,
  pageInput,
  onOpenPdf,
  onBrowserFileChange,
  onSearchTextChange,
  onPageInputChange,
  onOpenSearch,
  onSearch,
  onJumpToPage,
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
  onOpenPreferences,
}: ReaderToolbarProps) {
  return (
    <section className="reader-toolbar" aria-label="Reader tools">
      <div className="toolbar-group">
        <button type="button" onClick={onOpenPdf}>
          <FolderOpen size={16} />
          打开本地 PDF
        </button>
        <label className="file-picker-button">
          <FileDown size={16} />
          选择 PDF 文件
          <input
            aria-label="选择 PDF 文件"
            type="file"
            accept="application/pdf,.pdf"
            onChange={onBrowserFileChange}
          />
        </label>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onOpenSearch} aria-label="Find in PDF">
          <Search size={16} />
        </button>
        <input
          aria-label="Search text"
          className="toolbar-input"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          onFocus={onOpenSearch}
        />
        <button type="button" onClick={onSearch} aria-label="Search PDF">
          <Search size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onHistoryBack} aria-label="History back">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={onHistoryForward} aria-label="History forward">
          <ChevronRight size={16} />
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <input
          aria-label="Page number"
          className="page-input"
          inputMode="numeric"
          value={pageInput}
          onChange={(event) => onPageInputChange(event.target.value)}
        />
        <button type="button" onClick={onJumpToPage} aria-label="Go to page">
          Go
        </button>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onFitWidth} aria-label="Fit width">
          Fit width
        </button>
        <button type="button" onClick={onFitPage} aria-label="Fit page">
          Fit page
        </button>
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
      </div>
      <div className="toolbar-group push">
        <button type="button" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <PanelLeftClose size={16} />
        </button>
        <button type="button" onClick={() => void onAddBookmark()} aria-label="Add bookmark">
          <BookmarkPlus size={16} />
        </button>
        <button type="button" onClick={() => void onAddNote()} aria-label="Add note">
          <StickyNote size={16} />
        </button>
        <button type="button" disabled aria-disabled="true" aria-label="Recent tools">
          <History size={16} />
        </button>
        <button type="button" onClick={onOpenPreferences} aria-label="More options">
          <MoreHorizontal size={16} />
        </button>
        <button
          type="button"
          onClick={onCloseActiveTab}
          disabled={!activeSession}
          aria-label="Close active tab"
        >
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
