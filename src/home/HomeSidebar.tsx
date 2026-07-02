import {
  BookMarked,
  Bookmark,
  Database,
  FileClock,
  FileSearch,
  FileText,
  FolderOpen,
  GitCompare,
  Highlighter,
  Home,
  Library,
  NotebookPen,
  Search,
  Star,
  Tags,
  type LucideIcon,
} from 'lucide-react';

type HomeSidebarPage =
  | 'home'
  | 'recentFiles'
  | 'favoriteFiles'
  | 'sessionRestore'
  | 'library'
  | 'folders'
  | 'tags'
  | 'notes'
  | 'fullTextSearch'
  | 'annotations'
  | 'bookmarks'
  | 'compare';

type HomeSidebarCounts = {
  recentFiles: number;
  favoriteFiles: number;
  restorableSessions: number;
};

type HomeSidebarCacheStats = {
  usedBytes: number;
  totalBytes: number;
  fileCount: number;
};

type HomeSidebarProps = {
  activePage: HomeSidebarPage;
  counts: HomeSidebarCounts;
  cacheStats: HomeSidebarCacheStats;
  onOpenHome(): void;
  onOpenRecentFiles(): void;
  onOpenFavoriteFiles(): void;
  onOpenSessionRestore(): void;
  onOpenLibrary(): void;
  onOpenFolders(): void;
  onOpenTags(): void;
  onOpenNotes(): void;
  onOpenFullTextSearch(): void;
  onOpenAnnotations(): void;
  onOpenBookmarks(): void;
  onOpenCompare(): void;
  onOpenCacheManagement(): void;
};

type SidebarItem = {
  page: HomeSidebarPage;
  label: string;
  Icon: LucideIcon;
  count?: number;
  onClick: () => void;
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);

  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(value), 0), 100);
}

function SidebarNavItem({ activePage, item }: { activePage: HomeSidebarPage; item: SidebarItem }) {
  const active = item.page === activePage;

  return (
    <button
      type="button"
      className={active ? 'active' : undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={typeof item.count === 'number' ? `${item.label} ${item.count}` : item.label}
      onClick={item.onClick}
    >
      <item.Icon size={16} />
      <span className="home-nav-label">{item.label}</span>
      {typeof item.count === 'number' ? (
        <span className="home-nav-count" aria-hidden="true">
          {item.count}
        </span>
      ) : null}
    </button>
  );
}

function SidebarGroup({
  activePage,
  label,
  items,
}: {
  activePage: HomeSidebarPage;
  label: string;
  items: SidebarItem[];
}) {
  return (
    <div className="home-nav-group">
      <span className="home-nav-heading">{label}</span>
      <div className="home-nav-list">
        {items.map((item) => (
          <SidebarNavItem key={item.page} activePage={activePage} item={item} />
        ))}
      </div>
    </div>
  );
}

export function HomeSidebar({
  activePage,
  counts,
  cacheStats,
  onOpenHome,
  onOpenRecentFiles,
  onOpenFavoriteFiles,
  onOpenSessionRestore,
  onOpenLibrary,
  onOpenFolders,
  onOpenTags,
  onOpenNotes,
  onOpenFullTextSearch,
  onOpenAnnotations,
  onOpenBookmarks,
  onOpenCompare,
  onOpenCacheManagement,
}: HomeSidebarProps) {
  const usagePercent = clampProgress(
    cacheStats.totalBytes > 0 ? (cacheStats.usedBytes / cacheStats.totalBytes) * 100 : 0,
  );
  const capacityText = `${formatBytes(cacheStats.usedBytes)} / ${formatBytes(cacheStats.totalBytes)}`;

  const navigationItems: SidebarItem[] = [
    {
      page: 'home',
      label: '首页',
      Icon: Home,
      onClick: onOpenHome,
    },
    {
      page: 'recentFiles',
      label: '最近文件',
      Icon: FileClock,
      count: counts.recentFiles,
      onClick: onOpenRecentFiles,
    },
    {
      page: 'favoriteFiles',
      label: '收藏文件',
      Icon: Star,
      count: counts.favoriteFiles,
      onClick: onOpenFavoriteFiles,
    },
    {
      page: 'sessionRestore',
      label: '会话恢复',
      Icon: BookMarked,
      count: counts.restorableSessions,
      onClick: onOpenSessionRestore,
    },
  ];

  const libraryItems: SidebarItem[] = [
    {
      page: 'library',
      label: '我的文献',
      Icon: Library,
      onClick: onOpenLibrary,
    },
    {
      page: 'folders',
      label: '文件夹',
      Icon: FolderOpen,
      onClick: onOpenFolders,
    },
    {
      page: 'tags',
      label: '标签管理',
      Icon: Tags,
      onClick: onOpenTags,
    },
    {
      page: 'notes',
      label: '笔记管理',
      Icon: NotebookPen,
      onClick: onOpenNotes,
    },
  ];

  const toolItems: SidebarItem[] = [
    {
      page: 'fullTextSearch',
      label: '全文搜索',
      Icon: Search,
      onClick: onOpenFullTextSearch,
    },
    {
      page: 'annotations',
      label: '批注管理',
      Icon: Highlighter,
      onClick: onOpenAnnotations,
    },
    {
      page: 'bookmarks',
      label: '书签管理',
      Icon: Bookmark,
      onClick: onOpenBookmarks,
    },
    {
      page: 'compare',
      label: '对比阅读',
      Icon: GitCompare,
      onClick: onOpenCompare,
    },
  ];

  return (
    <aside className="home-sidebar">
      <div className="brand-lockup">
        <FileText size={22} />
        <div>
          <strong>SmartReader</strong>
          <span>本地 PDF 工作台</span>
        </div>
      </div>
      <nav aria-label="主导航" className="home-nav">
        <SidebarGroup activePage={activePage} label="导航" items={navigationItems} />
        <SidebarGroup activePage={activePage} label="知识库" items={libraryItems} />
        <SidebarGroup activePage={activePage} label="工具" items={toolItems} />
      </nav>
      <section className="home-cache-card" aria-label="本地缓存">
        <div className="home-cache-title">
          <Database size={16} />
          <span>本地缓存</span>
        </div>
        <strong>{capacityText}</strong>
        <div
          className="home-cache-progress"
          role="progressbar"
          aria-label="本地缓存使用量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usagePercent}
        >
          <span style={{ width: `${usagePercent}%` }} />
        </div>
        <p>已缓存 {cacheStats.fileCount} 个文件</p>
        <button type="button" onClick={onOpenCacheManagement}>
          <FileSearch size={15} />
          <span>管理缓存</span>
        </button>
      </section>
    </aside>
  );
}

export type { HomeSidebarPage, HomeSidebarProps };
