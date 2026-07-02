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

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    expect(clickInput).toHaveBeenCalledTimes(2);
    expect(onOpenPdf).not.toHaveBeenCalled();
  });

  it('falls back to the shared PDF input when native open rejects asynchronously', async () => {
    const onOpenPdf = vi.fn().mockRejectedValue(new Error('native dialog failed'));
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => true });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

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

  it('opens the shared PDF input directly from the quick-start chooser', () => {
    const onOpenPdf = vi.fn();
    const { clickInput } = renderDashboard({ onOpenPdf });

    fireEvent.click(screen.getByRole('button', { name: '选择 PDF 文件' }));

    expect(clickInput).toHaveBeenCalledTimes(1);
    expect(onOpenPdf).not.toHaveBeenCalled();
  });
});
