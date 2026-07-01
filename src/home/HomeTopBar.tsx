import {
  BookMarked,
  BookOpenCheck,
  Columns2,
  FileInput,
  FolderOpen,
  LibraryBig,
  Search,
  Settings,
} from 'lucide-react';
import { useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

type HomeTopBarProps = {
  onOpenPdf(): void;
  onOpenGlobalSearch(): void;
  onOpenImport(): void;
  onOpenCompare(): void;
  onOpenAnnotations(): void;
  onOpenBookmarks(): void;
  onOpenSettings(): void;
};

const focusRestoreMarker = 'globalSearchRestoreFocus';

export function HomeTopBar({
  onOpenPdf,
  onOpenGlobalSearch,
  onOpenImport,
  onOpenCompare,
  onOpenAnnotations,
  onOpenBookmarks,
  onOpenSettings,
}: HomeTopBarProps) {
  const mouseDownOnSearchRef = useRef(false);
  const ignoreNextSearchClickRef = useRef(false);
  const suppressNextSearchFocusRef = useRef(false);

  const handleSearchFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (event.currentTarget.dataset[focusRestoreMarker] === 'true') {
      delete event.currentTarget.dataset[focusRestoreMarker];
      return;
    }

    if (suppressNextSearchFocusRef.current) {
      suppressNextSearchFocusRef.current = false;
      return;
    }

    if (mouseDownOnSearchRef.current) {
      ignoreNextSearchClickRef.current = true;
      window.setTimeout(() => {
        mouseDownOnSearchRef.current = false;
        ignoreNextSearchClickRef.current = false;
      }, 0);
    }

    onOpenGlobalSearch();
    suppressNextSearchFocusRef.current = true;
  };

  const handleSearchClick = (event: MouseEvent<HTMLInputElement>) => {
    mouseDownOnSearchRef.current = false;

    if (ignoreNextSearchClickRef.current) {
      ignoreNextSearchClickRef.current = false;
      return;
    }

    if (document.activeElement === event.currentTarget) {
      suppressNextSearchFocusRef.current = true;
    }
    onOpenGlobalSearch();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      suppressNextSearchFocusRef.current = true;
      onOpenGlobalSearch();
    }
  };

  return (
    <header className="home-top-bar" aria-label="SmartReader 顶部栏">
      <div className="home-top-brand">
        <div className="window-controls" aria-label="macOS 窗口控制">
          <span className="window-dot close" />
          <span className="window-dot minimize" />
          <span className="window-dot maximize" />
        </div>
        <BookOpenCheck size={28} strokeWidth={1.8} />
        <div className="home-top-title">
          <strong>SmartReader</strong>
          <span>本地优先的 PDF 阅读器</span>
        </div>
        <button type="button" className="top-open-button" onClick={onOpenPdf}>
          <FolderOpen size={18} />
          <span>打开文件</span>
        </button>
      </div>

      <label className="global-search-trigger">
        <Search size={18} />
        <input
          aria-label="全局搜索"
          placeholder="搜索文件、书签、批注..."
          readOnly
          type="search"
          onClick={handleSearchClick}
          onFocus={handleSearchFocus}
          onKeyDown={handleSearchKeyDown}
          onMouseDown={() => {
            mouseDownOnSearchRef.current = true;
          }}
        />
        <kbd>⌘K</kbd>
      </label>

      <nav className="top-shortcuts" aria-label="全局快捷入口">
        <button type="button" onClick={onOpenImport}>
          <FileInput size={18} />
          <span>导入文献</span>
        </button>
        <button type="button" onClick={onOpenCompare}>
          <Columns2 size={18} />
          <span>对比阅读</span>
        </button>
        <button type="button" onClick={onOpenAnnotations}>
          <LibraryBig size={18} />
          <span>批注管理</span>
        </button>
        <button type="button" onClick={onOpenBookmarks}>
          <BookMarked size={18} />
          <span>书签</span>
        </button>
        <button type="button" onClick={onOpenSettings}>
          <Settings size={18} />
          <span>设置</span>
        </button>
      </nav>
    </header>
  );
}
