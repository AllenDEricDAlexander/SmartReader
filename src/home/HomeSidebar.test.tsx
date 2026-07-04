import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeSidebar } from './HomeSidebar';

function renderSidebar(overrides: Partial<ComponentProps<typeof HomeSidebar>> = {}) {
  const props = {
    activePage: 'home',
    counts: {
      recentFiles: 7,
      favoriteFiles: 3,
      restorableSessions: 2,
    },
    cacheStats: {
      usedBytes: 1.24 * 1024 * 1024 * 1024,
      totalBytes: 5 * 1024 * 1024 * 1024,
      fileCount: 42,
    },
    onOpenHome: vi.fn(),
    onOpenRecentFiles: vi.fn(),
    onOpenFavoriteFiles: vi.fn(),
    onOpenSessionRestore: vi.fn(),
    onOpenMyDocuments: vi.fn(),
    onOpenFolders: vi.fn(),
    onOpenTags: vi.fn(),
    onOpenNotes: vi.fn(),
    onOpenFullTextSearch: vi.fn(),
    onOpenAnnotations: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenCompare: vi.fn(),
    onOpenCacheManagement: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof HomeSidebar>;

  renderApp(<HomeSidebar {...props} />);
  return props;
}

describe('HomeSidebar', () => {
  it('renders grouped navigation, counts, and active home row without the brand lockup', () => {
    renderSidebar();

    expect(screen.queryByText('SmartReader')).not.toBeInTheDocument();
    expect(screen.queryByText('本地 PDF 工作台')).not.toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getByText('导航')).toBeInTheDocument();
    expect(within(nav).getByText('知识库')).toBeInTheDocument();
    expect(within(nav).getByText('工具')).toBeInTheDocument();

    [
      '首页',
      '最近文件',
      '收藏文件',
      '会话恢复',
      '我的文献',
      '文件夹',
      '标签管理',
      '笔记管理',
      '全文搜索',
      '批注管理',
      '书签管理',
      '对比阅读',
    ].forEach((label) => {
      expect(within(nav).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    });

    const homeButton = within(nav).getByRole('button', { name: '首页' });
    expect(homeButton).toHaveClass('active');
    expect(homeButton).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: '最近文件 7' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '收藏文件 3' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '会话恢复 2' })).toBeInTheDocument();
  });

  it('forwards every navigation and cache action callback', () => {
    const props = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    fireEvent.click(screen.getByRole('button', { name: '最近文件 7' }));
    fireEvent.click(screen.getByRole('button', { name: '收藏文件 3' }));
    fireEvent.click(screen.getByRole('button', { name: '会话恢复 2' }));
    fireEvent.click(screen.getByRole('button', { name: '我的文献' }));
    fireEvent.click(screen.getByRole('button', { name: '文件夹' }));
    fireEvent.click(screen.getByRole('button', { name: '标签管理' }));
    fireEvent.click(screen.getByRole('button', { name: '笔记管理' }));
    fireEvent.click(screen.getByRole('button', { name: '全文搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '批注管理' }));
    fireEvent.click(screen.getByRole('button', { name: '书签管理' }));
    fireEvent.click(screen.getByRole('button', { name: '对比阅读' }));
    fireEvent.click(screen.getByRole('button', { name: '管理缓存' }));

    expect(props.onOpenHome).toHaveBeenCalledTimes(1);
    expect(props.onOpenRecentFiles).toHaveBeenCalledTimes(1);
    expect(props.onOpenFavoriteFiles).toHaveBeenCalledTimes(1);
    expect(props.onOpenSessionRestore).toHaveBeenCalledTimes(1);
    expect(props.onOpenMyDocuments).toHaveBeenCalledTimes(1);
    expect(props.onOpenFolders).toHaveBeenCalledTimes(1);
    expect(props.onOpenTags).toHaveBeenCalledTimes(1);
    expect(props.onOpenNotes).toHaveBeenCalledTimes(1);
    expect(props.onOpenFullTextSearch).toHaveBeenCalledTimes(1);
    expect(props.onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(props.onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(props.onOpenCompare).toHaveBeenCalledTimes(1);
    expect(props.onOpenCacheManagement).toHaveBeenCalledTimes(1);
  });

  it('formats default cache capacity', () => {
    renderSidebar();

    expect(screen.getByText('本地缓存')).toBeInTheDocument();
    expect(screen.getByText('1.24 GB / 5 GB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '本地缓存使用量' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
  });

  it('formats cache capacity and clamps the progress value', () => {
    renderSidebar({
      cacheStats: {
        usedBytes: 8 * 1024 * 1024 * 1024,
        totalBytes: 5 * 1024 * 1024 * 1024,
        fileCount: 12,
      },
    });

    expect(screen.getByText('8 GB / 5 GB')).toBeInTheDocument();
    expect(screen.getByText('已缓存 12 个文件')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '本地缓存使用量' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });
});
