import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistedDocument } from '../persistence/persistenceApi';
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
  },
];

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

  it('renders the restore last session module heading and subtitle', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    expect(screen.getByRole('heading', { name: '恢复上次会话' })).toBeInTheDocument();
    expect(screen.getByText('继续您上次阅读的内容')).toBeInTheDocument();
  });

  it('shows the first restore session file details', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    expect(screen.getByText('Design Notes.pdf')).toBeInTheDocument();
    expect(screen.getByText('/Users/mario/Documents/')).toBeInTheDocument();
    expect(screen.getByText('上次阅读到 第 12 / 86 页')).toBeInTheDocument();
    expect(
      screen.getByText(expectedLocalDateTime(recentSessionDocuments[0].modifiedAt)),
    ).toBeInTheDocument();
  });

  it('limits restore session rows to the first three documents', () => {
    renderDashboard({ recentDocuments: recentSessionDocuments });

    expect(screen.getByText('Design Notes.pdf')).toBeInTheDocument();
    expect(screen.getByText('Reader Spec.pdf')).toBeInTheDocument();
    expect(screen.getByText('UX Review.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Fourth.pdf')).not.toBeInTheDocument();
  });

  it('reopens a recent document when clicking its restore session row area', () => {
    const onReopenRecentDocument = vi.fn();
    renderDashboard({ recentDocuments: recentSessionDocuments, onReopenRecentDocument });

    fireEvent.click(screen.getByRole('button', { name: '恢复会话 Design Notes.pdf' }));

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
