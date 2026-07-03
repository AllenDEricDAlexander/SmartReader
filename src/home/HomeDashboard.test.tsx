import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeDashboard } from './HomeDashboard';

function renderDashboard(overrides: Partial<ComponentProps<typeof HomeDashboard>> = {}) {
  const props: ComponentProps<typeof HomeDashboard> = {
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
    ...overrides,
  };

  renderApp(<HomeDashboard {...props} />);
  const input = screen.getByLabelText('选择 PDF 文件') as HTMLInputElement;
  const clickInput = vi.spyOn(input, 'click').mockImplementation(() => undefined);

  return { props, input, clickInput };
}

describe('HomeDashboard', () => {
  it('renders the prototype welcome banner at the top of the home content', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    expect(screen.getByRole('region', { name: '欢迎使用 SmartReader' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: '欢迎使用 SmartReader' }),
    ).toBeInTheDocument();
    expect(screen.getByText('本地优先 · 隐私安全 · 高效阅读')).toBeInTheDocument();
    expect(
      screen.getByText('所有文件和数据仅存储在您的设备上，完全掌控您的知识。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('本地安全阅读插画')).toBeInTheDocument();
  });

  it('does not show the old dashboard title header on the home page', () => {
    renderDashboard({ activeSidebarPage: 'home' });

    expect(screen.queryByRole('heading', { name: '阅读仪表盘' })).not.toBeInTheDocument();
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

  it('shows an accessible blank page and keeps the sidebar visible for recent files', () => {
    renderDashboard({ activeSidebarPage: 'recentFiles' });

    expect(screen.queryByText('快速开始')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最近文件 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('region', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
  });

  it('marks blank sidebar page content for single-column layout', () => {
    renderDashboard({ activeSidebarPage: 'recentFiles' });

    expect(screen.getByRole('region', { name: '最近文件' }).parentElement).toHaveClass(
      'home-blank-content',
    );
  });

  it('falls back to normal home content instead of a blank page for workspace-only sidebar pages', () => {
    renderDashboard({ activeSidebarPage: 'tags' });

    expect(screen.getByText('快速开始')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('region', { name: '标签管理' })).not.toBeInTheDocument();
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
});
