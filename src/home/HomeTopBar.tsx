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
import type { KeyboardEvent } from 'react';

type HomeTopBarProps = {
  onOpenPdf(): void;
  onOpenGlobalSearch(): void;
  onOpenImport(): void;
  onOpenCompare(): void;
  onOpenAnnotations(): void;
  onOpenBookmarks(): void;
  onOpenSettings(): void;
};

export function HomeTopBar({
  onOpenPdf,
  onOpenGlobalSearch,
  onOpenImport,
  onOpenCompare,
  onOpenAnnotations,
  onOpenBookmarks,
  onOpenSettings,
}: HomeTopBarProps) {
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
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

      <button
        type="button"
        className="global-search-trigger"
        onClick={onOpenGlobalSearch}
        onKeyDown={handleSearchKeyDown}
      >
        <Search size={18} />
        <span className="global-search-copy">搜索文件、书签、批注...</span>
        <kbd>⌘K</kbd>
      </button>

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
