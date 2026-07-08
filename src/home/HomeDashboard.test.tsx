import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { TagDashboard } from '../tags/tagModels';
import { renderApp } from '../test/renderApp';
import { HomeDashboard } from './HomeDashboard';

const recentSessionDocuments: PersistedDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Documents/Design Notes.pdf',
    path: '/Users/mario/Documents/Design Notes.pdf',
    displayName: 'Design Notes.pdf',
    fileSize: 1024,
    modifiedAt: '2026-07-01T10:30:00+08:00',
    pageCount: 86,
    lastPage: 12,
    progress: 0.14,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Research/Reader Spec.pdf',
    path: '/Users/mario/Research/Reader Spec.pdf',
    displayName: 'Reader Spec.pdf',
    fileSize: 2048,
    modifiedAt: '2026-07-01T12:00:00+08:00',
    pageCount: 42,
    lastPage: 8,
    progress: 0.19,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/UX Review.pdf',
    path: '/Users/mario/Archive/UX Review.pdf',
    displayName: 'UX Review.pdf',
    fileSize: 4096,
    modifiedAt: '2026-07-02T09:15:00+08:00',
    pageCount: 128,
    lastPage: 64,
    progress: 0.5,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Hidden Fourth.pdf',
    path: '/Users/mario/Archive/Hidden Fourth.pdf',
    displayName: 'Hidden Fourth.pdf',
    fileSize: 8192,
    modifiedAt: '2026-07-02T10:15:00+08:00',
    pageCount: 200,
    lastPage: 100,
    progress: 0.5,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

const recentTableDocuments: PersistedDocument[] = [
  ...recentSessionDocuments,
  {
    documentKey: 'desktop:/Users/mario/Reports/Product Metrics.pdf',
    path: '/Users/mario/Reports/Product Metrics.pdf',
    displayName: 'Product Metrics.pdf',
    fileSize: 4096,
    modifiedAt: '2026-07-02T11:15:00+08:00',
    pageCount: 64,
    lastPage: 32,
    progress: 0.5,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Reports/Sixth Hidden.pdf',
    path: '/Users/mario/Reports/Sixth Hidden.pdf',
    displayName: 'Sixth Hidden.pdf',
    fileSize: 4096,
    modifiedAt: '2026-07-02T12:15:00+08:00',
    pageCount: 64,
    lastPage: 8,
    progress: 0.125,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

const favoriteCardDocuments: FavoriteDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Documents/Design Notes.pdf',
    path: '/Users/mario/Documents/Design Notes.pdf',
    displayName: 'Design Notes.pdf',
    lastPage: 12,
    progress: 0.14,
    pageCount: null,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Research/Reader Spec.pdf',
    path: '/Users/mario/Research/Reader Spec.pdf',
    displayName: 'Reader Spec.pdf',
    lastPage: 8,
    progress: 0.19,
    pageCount: null,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/UX Review.pdf',
    path: '/Users/mario/Archive/UX Review.pdf',
    displayName: 'UX Review.pdf',
    lastPage: 64,
    progress: 0.5,
    pageCount: null,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Hidden Fourth.pdf',
    path: '/Users/mario/Archive/Hidden Fourth.pdf',
    displayName: 'Hidden Fourth.pdf',
    lastPage: 100,
    progress: 0.5,
    pageCount: null,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

const tagDashboard: TagDashboard = {
  overview: { totalTags: 1, activeTags: 1, totalUsage: 4, orphanTags: 0 },
  tags: [
    {
      id: 1,
      name: '深度学习',
      color: '#2563eb',
      usageCount: 4,
      documentCount: 2,
      annotationCount: 2,
      recentUsedAt: '2026-07-07T09:42:00Z',
      createdAt: '2026-07-01T08:00:00Z',
      updatedAt: '2026-07-07T09:42:00Z',
      description: '深度学习 相关文献与批注',
    },
  ],
  details: [
    {
      tag: {
        id: 1,
        name: '深度学习',
        color: '#2563eb',
        usageCount: 4,
        documentCount: 2,
        annotationCount: 2,
        recentUsedAt: '2026-07-07T09:42:00Z',
        createdAt: '2026-07-01T08:00:00Z',
        updatedAt: '2026-07-07T09:42:00Z',
        description: '深度学习 相关文献与批注',
      },
      documents: [],
      folderDistribution: [],
      activities: [],
    },
  ],
  recommendations: [],
};

function createTagPersistence() {
  return {
    loadTagDashboard: vi.fn().mockResolvedValue(tagDashboard),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  };
}

function expectedLocalDateTime(value: string | null) {
  if (!value) {
    return '时间未知';
  }

  const date = new Date(value);

  return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(
    date.getDate(),
  )} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function createDashboardProps(
  overrides: Partial<ComponentProps<typeof HomeDashboard>> = {},
): ComponentProps<typeof HomeDashboard> {
  return {
    recentDocuments: [],
    favoriteDocuments: [],
    onOpenPdf: vi.fn(),
    onDropPdf: vi.fn(),
    onBrowserFileChange: vi.fn(),
    onReopenRecentDocument: vi.fn(),
    onToggleFavorite: vi.fn(),
    canOpenNativePdf: () => true,
    activeSidebarPage: 'home',
    counts: {
      recentFiles: 2,
      favoriteFiles: 1,
      restorableSessions: 0,
    },
    cacheStats: {
      usedBytes: 512 * 1024 * 1024,
      totalBytes: 2 * 1024 * 1024 * 1024,
      fileCount: 4,
    },
    onOpenHome: vi.fn(),
    onOpenRecentFiles: vi.fn(),
    onOpenFavoriteFiles: vi.fn(),
    onOpenSessionRestore: vi.fn(),
    onOpenMyDocuments: vi.fn(),
    onOpenFolders: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenTags: vi.fn(),
    onOpenNotes: vi.fn(),
    onOpenFullTextSearch: vi.fn(),
    onOpenCacheManagement: vi.fn(),
    tagPersistence: createTagPersistence(),
    onTagsChange: vi.fn(),
    onOpenTagDocument: vi.fn(),
    ...overrides,
  };
}

function renderDashboard(overrides: Partial<ComponentProps<typeof HomeDashboard>> = {}) {
  const props = createDashboardProps(overrides);

  renderApp(<HomeDashboard {...props} />);
  const input = screen.getByLabelText('选择 PDF 文件') as HTMLInputElement;
  const clickInput = vi.spyOn(input, 'click').mockImplementation(() => undefined);

  return { props, input, clickInput };
}

function readAppStyles() {
  return readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
}

describe('HomeDashboard', () => {
  it('keeps the wide home layout three-area and degrades recent files on narrow screens', () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.home-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 320px;/s);
    expect(styles).toMatch(/\.home-assist\s*{[^}]*display:\s*grid;/s);
    expect(styles).toMatch(/@media \(max-width: 1180px\)\s*{[^@]*\.home-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
    expect(styles).toMatch(/@media \(max-width: 720px\)\s*{[^@]*\.recent-files-table\s*{[^}]*min-width:\s*0;/s);
    expect(styles).toMatch(/@media \(max-width: 720px\)\s*{[^@]*\.recent-files-table td::before\s*{[^}]*content:\s*attr\(data-label\);/s);
    expect(styles).toMatch(/@media \(max-width: 720px\)\s*{[^@]*\.recent-files-table \.recent-file-menu\s*{[^}]*grid-column:\s*1 \/ -1;[^}]*justify-self:\s*stretch;[^}]*width:\s*100%;/s);
    expect(styles).not.toMatch(/span:nth-of-type\(3\)/);
    expect(styles).toMatch(/\.home-status-left span\[aria-hidden="true"\]:not\(\.local-mode-dot\),\s*\.home-status-left svg\s*{[^}]*display:\s*none;/s);
    expect(styles).not.toMatch(/@media \(max-width: 1280px\)\s*{[^@]*\.home-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  });

  it('keeps workspace row menus floating instead of expanding cards or rows', () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.recent-workspace-menu-wrap\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.recent-workspace-menu-wrap \.recent-file-menu\s*{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*top:\s*calc\(100% \+ 6px\);[^}]*width:\s*150px;[^}]*max-width:\s*none;[^}]*z-index:\s*30;/s);
  });

  it('keeps tag management as a single framed home content page', () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.home-content\.home-tags-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
    expect(styles).toMatch(/\.home-content\.home-tags-content\s*{[^}]*padding:\s*0;/s);
    expect(styles).toMatch(/\.home-content\.home-tags-content\s*{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.tag-dashboard-workspace\s*{[^}]*height:\s*100%;/s);
    expect(styles).toMatch(/\.tag-dashboard-select\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.tag-color-filter-dot\s*{[^}]*border-radius:\s*999px;/s);
    expect(styles).toMatch(/@media \(max-width: 1180px\)\s*{[^@]*\.tag-dashboard-workspace\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  });

  it('renders the prototype welcome banner at the top of the home content', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    const welcome = screen.getByRole('region', { name: '欢迎使用 SmartReader' });

    expect(screen.getByRole('region', { name: '欢迎使用 SmartReader' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: '欢迎使用 SmartReader' }),
    ).toBeInTheDocument();
    expect(within(welcome).getByText('本地优先 · 隐私安全 · 高效阅读')).toBeInTheDocument();
    expect(
      screen.getByText('所有文件和数据仅存储在您的设备上，完全掌控您的知识。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('本地安全阅读插画')).toBeInTheDocument();
  });

  it('does not show the old dashboard title header on the home page', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    expect(screen.queryByRole('heading', { name: '阅读仪表盘' })).not.toBeInTheDocument();
  });

  it('renders home main modules in prototype order', () => {
    renderDashboard({
      activeSidebarPage: 'home',
      recentDocuments: recentTableDocuments,
      favoriteDocuments: favoriteCardDocuments,
    });

    const moduleHeadings = [
      screen.getByRole('heading', { level: 1, name: '欢迎使用 SmartReader' }),
      screen.getByRole('heading', { name: '快速开始' }),
      screen.getByRole('heading', { name: '恢复上次会话' }),
      screen.getByRole('heading', { name: '最近文件' }),
      screen.getByRole('heading', { name: '收藏文件' }),
    ];

    moduleHeadings.slice(1).forEach((heading, index) => {
      expect(moduleHeadings[index].compareDocumentPosition(heading)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  it('keeps the home dashboard content and sidebar navigation active for the home page', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    expect(screen.getByText('快速开始')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '最近文件 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏文件 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toBeInTheDocument();
  });

  it('renders the home assist rail and removes the temporary status cards', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    const assist = screen.getByRole('complementary', { name: '辅助信息' });

    expect(within(assist).getByRole('heading', { name: '快速上手' })).toBeInTheDocument();
    expect(within(assist).getByRole('heading', { name: '桌面集成' })).toBeInTheDocument();
    expect(within(assist).getByText('版本 0.1.0')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台状态' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '阅读流程' })).not.toBeInTheDocument();
  });

  it('renders the fixed home status bar on the home page', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    const statusBar = screen.getByRole('contentinfo', { name: '首页状态栏' });

    expect(within(statusBar).getByText('本地模式')).toBeInTheDocument();
    expect(within(statusBar).getByText('所有数据保存在本地')).toBeInTheDocument();
    expect(within(statusBar).getByText('125%')).toBeInTheDocument();
    expect(within(statusBar).getByText('无任务运行中')).toBeInTheDocument();
  });

  it('shows a deferred notice when opening status bar view controls', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制，当前缩放 125%' }));

    expect(screen.getByRole('dialog', { name: '首页视图控制待接入' })).toBeInTheDocument();
    expect(screen.getByText('当前版本暂未接入首页视图控制。')).toBeInTheDocument();
  });

  it('does not render the home assist rail for blank sidebar pages', () => {
    renderDashboard({ activeSidebarPage: 'recentFiles' });

    expect(screen.queryByRole('complementary', { name: '辅助信息' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '最近文件' })).toBeInTheDocument();
  });

  it('forwards assist rail navigation callbacks', () => {
    const onOpenGlobalSearch = vi.fn();
    const onOpenBookmarks = vi.fn();
    const onOpenAnnotations = vi.fn();
    const onOpenCacheManagement = vi.fn();
    const onOpenSettings = vi.fn();
    renderDashboard({
      onOpenGlobalSearch,
      onOpenBookmarks,
      onOpenAnnotations,
      onOpenCacheManagement,
      onOpenSettings,
    });

    const assist = screen.getByRole('complementary', { name: '辅助信息' });

    fireEvent.click(within(assist).getByRole('button', { name: /搜索文件与内容/ }));
    fireEvent.click(within(assist).getByRole('button', { name: /书签管理/ }));
    fireEvent.click(within(assist).getByRole('button', { name: /批注与高亮/ }));
    fireEvent.click(within(assist).getByRole('button', { name: /快捷键总览/ }));
    fireEvent.click(within(assist).getByRole('button', { name: '更多技巧' }));
    fireEvent.click(within(assist).getByRole('button', { name: '管理缓存' }));

    expect(onOpenGlobalSearch).toHaveBeenCalledTimes(1);
    expect(onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
    expect(onOpenCacheManagement).toHaveBeenCalledTimes(1);
  });

  it('shows fallback notices for unavailable desktop association and update checks', () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: '设置关联' }));
    expect(screen.getByRole('dialog', { name: '文件关联不可用' })).toBeInTheDocument();
    expect(
      screen.getByText('当前环境不支持自动设置文件关联，请在系统设置中关联 PDF。'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(screen.getByRole('dialog', { name: '检查更新能力待接入' })).toBeInTheDocument();
    expect(screen.getByText('当前版本暂未接入自动检查更新。')).toBeInTheDocument();
  });

  it('renders the recent files workspace for the recent files sidebar page', () => {
    renderDashboard({ activeSidebarPage: 'recentFiles', recentDocuments: recentTableDocuments });

    expect(screen.queryByText('快速开始')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最近文件 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('region', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByText('共 6 个最近文件，当前显示 6 个')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索最近文件' })).toBeInTheDocument();
  });

  it('marks recent files workspace content for single-column layout', () => {
    renderDashboard({ activeSidebarPage: 'recentFiles' });

    expect(screen.getByRole('region', { name: '最近文件' }).parentElement).toHaveClass(
      'home-blank-content',
    );
  });

  it('renders the favorite files workspace from the sidebar page', () => {
    renderDashboard({
      activeSidebarPage: 'favoriteFiles',
      favoriteDocuments: [
        {
          documentKey: 'desktop:/Users/mario/Papers/Favorite.pdf',
          displayName: 'Favorite.pdf',
          path: '/Users/mario/Papers/Favorite.pdf',
          lastPage: 4,
          progress: 0.4,
          pageCount: 10,
          missing: false,
          lastOpenedAt: '2026-07-06T10:00:00+08:00',
          tagIds: [],
        },
      ],
    });

    expect(screen.getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
    expect(screen.getByText('共 1 个收藏，当前显示 1 个')).toBeInTheDocument();
    expect(screen.getByTestId('favorite-workspace-document-name')).toHaveTextContent('Favorite.pdf');
  });

  it('renders bookmarks inside the home dashboard frame', () => {
    renderDashboard({
      activeSidebarPage: 'bookmarks',
      bookmarks: [
        {
          id: 7,
          documentKey: 'desktop:/Users/mario/Papers/Book.pdf',
          documentDisplayName: 'Book.pdf',
          documentPath: '/Users/mario/Papers/Book.pdf',
          documentMissing: false,
          page: 12,
          title: '关键段落',
          createdAt: '2026-07-07T10:00:00+08:00',
          updatedAt: '2026-07-07T10:00:00+08:00',
        },
      ],
    });

    expect(screen.getByRole('button', { name: '书签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('region', { name: '书签管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /关键段落/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('书签管理工作区')).not.toBeInTheDocument();
  });

  it('renders tag management inside the home dashboard frame', async () => {
    renderDashboard({ activeSidebarPage: 'tags' });

    expect(screen.queryByText('快速开始')).not.toBeInTheDocument();
    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByLabelText('标签管理工作区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '标签管理' })).toBeInTheDocument();
    expect(screen.getByText('标签概览')).toBeInTheDocument();
  });

  it('does not render full-text search as a home blank page', () => {
    renderDashboard({ activeSidebarPage: 'fullTextSearch' });

    expect(screen.getByText('快速开始')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全文搜索' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('region', { name: '全文搜索' })).not.toBeInTheDocument();
  });

  it('forwards recent files navigation from the sidebar', () => {
    const onOpenRecentFiles = vi.fn();
    renderDashboard({ onOpenRecentFiles });

    fireEvent.click(screen.getByRole('button', { name: '最近文件 2' }));

    expect(onOpenRecentFiles).toHaveBeenCalledTimes(1);
  });

  it('owns a single hidden PDF file input for home open actions', () => {
    const { input } = renderDashboard();

    expect(screen.getAllByLabelText('选择 PDF 文件')).toHaveLength(1);
    expect(input).toHaveClass('file-picker-input');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'application/pdf,.pdf');
    expect(input).toHaveAttribute('tabindex', '-1');
  });

  it('clicks the shared PDF input synchronously when native open is unavailable', () => {
    const onOpenPdf = vi.fn();
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => false });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    expect(clickInput).toHaveBeenCalledTimes(1);
    expect(onOpenPdf).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    expect(clickInput).toHaveBeenCalledTimes(2);
    expect(onOpenPdf).not.toHaveBeenCalled();
  });

  it('falls back to the shared PDF input when native open rejects asynchronously', async () => {
    const onOpenPdf = vi.fn().mockRejectedValue(new Error('native dialog failed'));
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => true });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    expect(onOpenPdf).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(clickInput).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to the shared PDF input when native open throws synchronously', () => {
    const onOpenPdf = vi.fn(() => {
      throw new Error('native dialog failed');
    });
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => true });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    expect(onOpenPdf).toHaveBeenCalledTimes(1);
    expect(clickInput).toHaveBeenCalledTimes(1);
  });

  it('forwards quick-start folder selection to the folders blank page callback', () => {
    const onOpenFolders = vi.fn();
    renderDashboard({ onOpenFolders });

    fireEvent.click(screen.getByRole('button', { name: /选择文件夹/ }));

    expect(onOpenFolders).toHaveBeenCalledTimes(1);
  });

  it('forwards quick-start PDF drops to the reader drop handler', () => {
    const onDropPdf = vi.fn((event) => event.preventDefault());
    renderDashboard({ onDropPdf });

    fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
      dataTransfer: {
        files: [new File(['pdf'], 'drop.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onDropPdf).toHaveBeenCalledTimes(1);
  });

  it('shows a notice for non-PDF drops without calling the reader drop handler', () => {
    const onDropPdf = vi.fn();
    renderDashboard({ onDropPdf });

    fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
      dataTransfer: {
        files: [new File(['text'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    expect(onDropPdf).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '无法打开文件' })).toBeInTheDocument();
    expect(screen.getByText('仅支持 PDF 文件')).toBeInTheDocument();
  });

  it('blocks non-drop-card home drops from reaching the PDF or parent drop handlers', () => {
    const onDropPdf = vi.fn((event) => event.preventDefault());
    const onParentDrop = vi.fn();
    const props = createDashboardProps({ onDropPdf });
    renderApp(
      <div onDrop={onParentDrop}>
        <HomeDashboard {...props} />
      </div>,
    );

    fireEvent.drop(screen.getByRole('region', { name: '欢迎使用 SmartReader' }), {
      dataTransfer: {
        files: [new File(['pdf'], 'drop.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onDropPdf).not.toHaveBeenCalled();
    expect(onParentDrop).not.toHaveBeenCalled();
  });

  it('renders the restore last session module heading and subtitle', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    expect(screen.getByRole('heading', { name: '恢复上次会话' })).toBeInTheDocument();
    expect(screen.getByText('继续您上次阅读的内容')).toBeInTheDocument();
  });

  it('shows the first restore session file details', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    const restoreRegion = screen.getByRole('region', { name: '恢复上次会话' });

    expect(within(restoreRegion).getByText('Design Notes.pdf')).toBeInTheDocument();
    expect(within(restoreRegion).getByText('/Users/mario/Documents/')).toBeInTheDocument();
    expect(within(restoreRegion).getByText('上次阅读到 第 12 / 86 页')).toBeInTheDocument();
    expect(
      within(restoreRegion).getByText(expectedLocalDateTime(recentSessionDocuments[0].modifiedAt)),
    ).toBeInTheDocument();
  });

  it('limits restore session rows to the first three documents', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    const restoreRegion = screen.getByRole('region', { name: '恢复上次会话' });

    expect(within(restoreRegion).getByText('Design Notes.pdf')).toBeInTheDocument();
    expect(within(restoreRegion).getByText('Reader Spec.pdf')).toBeInTheDocument();
    expect(within(restoreRegion).getByText('UX Review.pdf')).toBeInTheDocument();
    expect(within(restoreRegion).queryByText('Hidden Fourth.pdf')).not.toBeInTheDocument();
  });

  it('renders the recent files table with the first five documents', () => {
    renderDashboard({ recentDocuments: recentTableDocuments });

    const recentFilesRegion = screen.getByRole('region', { name: '最近文件' });
    const designNotesRow = within(recentFilesRegion).getByText('Design Notes.pdf').closest('tr');

    expect(within(recentFilesRegion).getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByRole('button', { name: '查看全部（6）' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByRole('columnheader', { name: '文件名' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByRole('columnheader', { name: '路径' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByRole('columnheader', { name: '上次打开' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByRole('columnheader', { name: '阅读进度' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByRole('columnheader', { name: '操作' })).toBeInTheDocument();
    expect(within(recentFilesRegion).getByText('Design Notes.pdf')).toBeInTheDocument();
    expect(within(recentFilesRegion).getByText('/Users/mario/Documents/')).toBeInTheDocument();
    expect(
      within(recentFilesRegion).getByText(expectedLocalDateTime(recentTableDocuments[0].modifiedAt)),
    ).toBeInTheDocument();
    expect(within(recentFilesRegion).getByText('Product Metrics.pdf')).toBeInTheDocument();
    expect(within(recentFilesRegion).queryByText('Sixth Hidden.pdf')).not.toBeInTheDocument();
    expect(within(recentFilesRegion).getAllByRole('progressbar')).toHaveLength(5);
    expect(
      within(recentFilesRegion).getByRole('progressbar', { name: '阅读进度 Design Notes.pdf' }),
    ).toHaveAttribute('aria-valuenow', '14');
    expect(designNotesRow).not.toBeNull();
    expect(
      within(designNotesRow as HTMLTableRowElement).getByText('Design Notes.pdf').closest('td'),
    ).toHaveAttribute('data-label', '文件名');
    expect(
      within(designNotesRow as HTMLTableRowElement)
        .getByText('/Users/mario/Documents/')
        .closest('td'),
    ).toHaveAttribute('data-label', '路径');
    expect(
      within(designNotesRow as HTMLTableRowElement)
        .getByText(expectedLocalDateTime(recentTableDocuments[0].modifiedAt))
        .closest('td'),
    ).toHaveAttribute('data-label', '上次打开');
    expect(
      within(designNotesRow as HTMLTableRowElement)
        .getByRole('progressbar', { name: '阅读进度 Design Notes.pdf' })
        .closest('td'),
    ).toHaveAttribute('data-label', '阅读进度');
    expect(
      within(designNotesRow as HTMLTableRowElement)
        .getByRole('button', { name: '更多操作 Design Notes.pdf' })
        .closest('td'),
    ).toHaveAttribute('data-label', '操作');
  });

  it('forwards recent files view-all from the table header', () => {
    const onOpenRecentFiles = vi.fn();
    renderDashboard({ recentDocuments: recentTableDocuments, onOpenRecentFiles });

    fireEvent.click(
      within(screen.getByRole('region', { name: '最近文件' })).getByRole('button', {
        name: '查看全部（6）',
      }),
    );

    expect(onOpenRecentFiles).toHaveBeenCalledTimes(1);
  });

  it('renders favorite files as three prototype cards', () => {
    renderDashboard({ favoriteDocuments: favoriteCardDocuments });

    const favoritesRegion = screen.getByRole('region', { name: '收藏文件' });

    expect(within(favoritesRegion).getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
    expect(
      within(favoritesRegion).getByRole('button', { name: '查看全部（4）' }),
    ).toBeInTheDocument();
    expect(within(favoritesRegion).getByText('Design Notes.pdf')).toBeInTheDocument();
    expect(within(favoritesRegion).getByText('/Users/mario/Documents/')).toBeInTheDocument();
    expect(within(favoritesRegion).getByText('第 12 页')).toBeInTheDocument();
    expect(within(favoritesRegion).getAllByLabelText(/^取消收藏 /)).toHaveLength(3);
    expect(within(favoritesRegion).queryByText('Hidden Fourth.pdf')).not.toBeInTheDocument();
    expect(within(favoritesRegion).queryByText(/^Page /)).not.toBeInTheDocument();
  });

  it('forwards favorite files view-all from the card module header', () => {
    const onOpenFavoriteFiles = vi.fn();
    renderDashboard({ favoriteDocuments: favoriteCardDocuments, onOpenFavoriteFiles });

    fireEvent.click(
      within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
        name: '查看全部（4）',
      }),
    );

    expect(onOpenFavoriteFiles).toHaveBeenCalledTimes(1);
  });

  it('unfavorites a favorite file from its card star button', () => {
    const onToggleFavorite = vi.fn();
    renderDashboard({ favoriteDocuments: favoriteCardDocuments, onToggleFavorite });

    fireEvent.click(
      within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
        name: '取消收藏 Design Notes.pdf',
      }),
    );

    expect(onToggleFavorite).toHaveBeenCalledWith(favoriteCardDocuments[0].documentKey, false);
  });

  it('opens a favorite file from its card body', () => {
    const onOpenFavoriteDocument = vi.fn();
    renderDashboard({ favoriteDocuments: favoriteCardDocuments, onOpenFavoriteDocument });

    fireEvent.click(
      within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
        name: '打开收藏文件 Design Notes.pdf',
      }),
    );

    expect(onOpenFavoriteDocument).toHaveBeenCalledTimes(1);
    expect(onOpenFavoriteDocument).toHaveBeenCalledWith(favoriteCardDocuments[0]);
  });

  it('shows a fallback notice when favorite open has no callback', () => {
    renderDashboard({ favoriteDocuments: favoriteCardDocuments });

    fireEvent.click(
      within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
        name: '打开收藏文件 Design Notes.pdf',
      }),
    );

    expect(screen.getByRole('dialog', { name: '无法打开收藏文件' })).toBeInTheDocument();
    expect(screen.getByText('该收藏文件暂无可打开的本地路径。')).toBeInTheDocument();
  });

  it('shows a fallback notice when favorite open callback cannot resolve a file', async () => {
    const onOpenFavoriteDocument = vi.fn().mockResolvedValue(false);
    renderDashboard({ favoriteDocuments: favoriteCardDocuments, onOpenFavoriteDocument });

    fireEvent.click(
      within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
        name: '打开收藏文件 Design Notes.pdf',
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开收藏文件' })).toBeInTheDocument();
    });
    expect(screen.getByText('该收藏文件暂无可打开的本地路径。')).toBeInTheDocument();
  });

  it('shows the new empty state for favorite files', () => {
    renderDashboard({ favoriteDocuments: [] });

    const favoritesRegion = screen.getByRole('region', { name: '收藏文件' });

    expect(within(favoritesRegion).getByText('暂无收藏文件')).toBeInTheDocument();
    expect(within(favoritesRegion).getByText('收藏文件后会显示在这里。')).toBeInTheDocument();
    expect(screen.queryByText('重点文档')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无收藏')).not.toBeInTheDocument();
  });

  it('handles recent files menu actions and local fallback notices', () => {
    const onReopenRecentDocument = vi.fn();
    const onToggleFavorite = vi.fn();
    renderDashboard({
      recentDocuments: recentTableDocuments,
      favoriteDocuments: [
        {
          documentKey: recentTableDocuments[1].documentKey,
          displayName: recentTableDocuments[1].displayName,
          path: recentTableDocuments[1].path,
          lastPage: recentTableDocuments[1].lastPage,
          progress: recentTableDocuments[1].progress,
          pageCount: null,
          missing: false,
          lastOpenedAt: null,
          tagIds: [],
        },
      ],
      onReopenRecentDocument,
      onToggleFavorite,
    });

    const recentFilesRegion = screen.getByRole('region', { name: '最近文件' });

    fireEvent.click(
      within(recentFilesRegion).getByRole('button', { name: '更多操作 Design Notes.pdf' }),
    );
    fireEvent.click(within(recentFilesRegion).getByRole('menuitem', { name: '打开' }));
    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentTableDocuments[0]);

    fireEvent.click(
      within(recentFilesRegion).getByRole('button', { name: '更多操作 Design Notes.pdf' }),
    );
    fireEvent.click(within(recentFilesRegion).getByRole('menuitem', { name: '收藏' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(recentTableDocuments[0].documentKey, true);

    fireEvent.click(
      within(recentFilesRegion).getByRole('button', { name: '更多操作 Reader Spec.pdf' }),
    );
    fireEvent.click(within(recentFilesRegion).getByRole('menuitem', { name: '取消收藏' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(recentTableDocuments[1].documentKey, false);

    fireEvent.click(
      within(recentFilesRegion).getByRole('button', { name: '更多操作 Design Notes.pdf' }),
    );
    fireEvent.click(within(recentFilesRegion).getByRole('menuitem', { name: '定位文件' }));
    expect(screen.getByRole('dialog', { name: '定位文件功能待补充' })).toBeInTheDocument();
    expect(screen.getByText('定位文件将在最近文件管理功能中补充。')).toBeInTheDocument();
  });

  it('shows the deferred remove-recent notice from the recent files menu', () => {
    renderDashboard({ recentDocuments: recentTableDocuments });

    const recentFilesRegion = screen.getByRole('region', { name: '最近文件' });

    fireEvent.click(
      within(recentFilesRegion).getByRole('button', { name: '更多操作 Design Notes.pdf' }),
    );
    fireEvent.click(within(recentFilesRegion).getByRole('menuitem', { name: '从最近记录移除' }));

    expect(screen.getByRole('dialog', { name: '移除最近记录功能待补充' })).toBeInTheDocument();
    expect(screen.getByText('从最近记录移除将在最近文件管理功能中补充。')).toBeInTheDocument();
  });

  it('closes the recent files menu with Escape and returns focus to its trigger', () => {
    renderDashboard({ recentDocuments: recentTableDocuments });

    const recentFilesRegion = screen.getByRole('region', { name: '最近文件' });
    const menuButton = within(recentFilesRegion).getByRole('button', {
      name: '更多操作 Design Notes.pdf',
    });

    fireEvent.click(menuButton);
    const menu = within(recentFilesRegion).getByRole('menu');

    expect(within(menu).getByRole('menuitem', { name: '打开' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(within(recentFilesRegion).queryByRole('menu')).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it('cycles recent files menu item focus with arrow keys', () => {
    renderDashboard({ recentDocuments: recentTableDocuments });

    const recentFilesRegion = screen.getByRole('region', { name: '最近文件' });

    fireEvent.click(
      within(recentFilesRegion).getByRole('button', { name: '更多操作 Design Notes.pdf' }),
    );

    const menu = within(recentFilesRegion).getByRole('menu');
    const openItem = within(menu).getByRole('menuitem', { name: '打开' });
    const favoriteItem = within(menu).getByRole('menuitem', { name: '收藏' });
    const removeItem = within(menu).getByRole('menuitem', { name: '从最近记录移除' });

    expect(openItem).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(favoriteItem).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(openItem).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(removeItem).toHaveFocus();
  });

  it('reopens a recent document when clicking its restore session row area', () => {
    const onReopenRecentDocument = vi.fn();
    renderDashboard({ recentDocuments: recentSessionDocuments, onReopenRecentDocument });

    const restoreRegion = screen.getByRole('region', { name: '恢复上次会话' });
    const row = within(restoreRegion).getByText('Design Notes.pdf').closest('.session-row');
    expect(row).not.toBeNull();

    fireEvent.click(row as HTMLElement);

    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentSessionDocuments[0]);
  });

  it('reopens once when keyboard activation clicks a restore session row area', () => {
    const onReopenRecentDocument = vi.fn();
    renderDashboard({ recentDocuments: recentSessionDocuments, onReopenRecentDocument });

    const rowAreaButton = screen.getByRole('button', { name: '恢复会话 Design Notes.pdf' });

    fireEvent.keyDown(rowAreaButton, { key: 'Enter' });
    fireEvent.click(rowAreaButton);
    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentSessionDocuments[0]);

    onReopenRecentDocument.mockClear();

    fireEvent.keyDown(rowAreaButton, { key: ' ' });
    fireEvent.click(rowAreaButton);
    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentSessionDocuments[0]);
  });

  it('reopens once when clicking a restore session continue button', () => {
    const onReopenRecentDocument = vi.fn();
    renderDashboard({ recentDocuments: recentSessionDocuments, onReopenRecentDocument });

    fireEvent.click(screen.getByRole('button', { name: '继续阅读 Design Notes.pdf' }));

    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentSessionDocuments[0]);
  });

  it('reopens once when keyboard activation clicks a restore session continue button', () => {
    const onReopenRecentDocument = vi.fn();
    renderDashboard({ recentDocuments: recentSessionDocuments, onReopenRecentDocument });

    const continueButton = screen.getByRole('button', { name: '继续阅读 Design Notes.pdf' });

    fireEvent.keyDown(continueButton, { key: 'Enter' });
    fireEvent.click(continueButton);
    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentSessionDocuments[0]);

    onReopenRecentDocument.mockClear();

    fireEvent.keyDown(continueButton, { key: ' ' });
    fireEvent.click(continueButton);
    expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
    expect(onReopenRecentDocument).toHaveBeenCalledWith(recentSessionDocuments[0]);
  });

  it('opens clear-record confirmation and then shows the deferred clear-record notice', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    fireEvent.click(screen.getByRole('button', { name: '清除记录' }));

    expect(screen.getByRole('dialog', { name: '清除记录' })).toBeInTheDocument();
    expect(
      screen.getByText('当前版本不会直接清空记录。确认后将展示功能待补充说明。'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(screen.getByRole('dialog', { name: '清除记录功能待补充' })).toBeInTheDocument();
    expect(screen.getByText('清除记录将在会话恢复管理功能中补充。')).toBeInTheDocument();
  });

  it('refocuses and traps focus when clear-record confirmation changes to deferred notice', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    fireEvent.click(screen.getByRole('button', { name: '清除记录' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    const dialog = screen.getByRole('dialog', { name: '清除记录功能待补充' });
    const closeButton = screen.getByRole('button', { name: '关闭' });

    expect(dialog).toBeInTheDocument();
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(closeButton).toHaveFocus();
  });
});
