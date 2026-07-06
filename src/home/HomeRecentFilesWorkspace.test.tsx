import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { renderApp } from '../test/renderApp';
import { HomeRecentFilesWorkspace } from './HomeRecentFilesWorkspace';

const documents: PersistedDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Papers/Beta Research.pdf',
    path: '/Users/mario/Papers/Beta Research.pdf',
    displayName: 'Beta Research.pdf',
    fileSize: 1024,
    modifiedAt: '2026-07-03T09:30:00+08:00',
    pageCount: 100,
    lastPage: 15,
    progress: 0.15,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
    path: '/Users/mario/Archive/Alpha Notes.pdf',
    displayName: 'Alpha Notes.pdf',
    fileSize: 2048,
    modifiedAt: '2026-07-05T11:00:00+08:00',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Drafts/Gamma Draft.pdf',
    path: '/Users/mario/Drafts/Gamma Draft.pdf',
    displayName: 'Gamma Draft.pdf',
    fileSize: 4096,
    modifiedAt: '2026-07-01T08:00:00+08:00',
    pageCount: 50,
    lastPage: 0,
    progress: 0,
    missing: false,
  },
  {
    documentKey: 'browser:untitled-local',
    path: null,
    displayName: 'Local Browser Upload.pdf',
    fileSize: null,
    modifiedAt: null,
    pageCount: null,
    lastPage: 0,
    progress: 0,
    missing: false,
  },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof HomeRecentFilesWorkspace>> = {}) {
  const props: ComponentProps<typeof HomeRecentFilesWorkspace> = {
    documents,
    favoriteDocumentKeys: new Set(['desktop:/Users/mario/Archive/Alpha Notes.pdf']),
    onOpenPdf: vi.fn(),
    onReopenDocument: vi.fn(),
    onToggleFavorite: vi.fn(),
    onLocateFile: vi.fn(),
    onRemoveRecent: vi.fn(),
    ...overrides,
  };

  renderApp(<HomeRecentFilesWorkspace {...props} />);

  return props;
}

function listedNames() {
  return screen
    .getAllByTestId('recent-workspace-document')
    .map((element) => within(element).getByTestId('recent-workspace-document-name').textContent);
}

describe('HomeRecentFilesWorkspace', () => {
  it('renders the recent files workspace with all documents in recent-open order', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByText('共 4 个最近文件，当前显示 4 个')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索最近文件' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '排序方式' })).toHaveValue('recent');
    expect(screen.getByRole('combobox', { name: '阅读进度筛选' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: '收藏状态筛选' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'false');
    expect(listedNames()).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
    ]);
  });

  it('searches by file name and path and can clear filters without changing view mode', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '卡片视图' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), {
      target: { value: 'drafts' },
    });

    expect(screen.getByText('共 4 个最近文件，当前显示 1 个')).toBeInTheDocument();
    expect(listedNames()).toEqual(['Gamma Draft.pdf']);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(screen.getByRole('searchbox', { name: '搜索最近文件' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('共 4 个最近文件，当前显示 4 个')).toBeInTheDocument();
  });

  it('shows a no-result state for unmatched filters', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), {
      target: { value: 'does-not-exist' },
    });

    expect(screen.getByText('没有匹配的最近文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeEnabled();
  });

  it('shows the no-record empty state and opens a PDF from the empty action', () => {
    const props = renderWorkspace({ documents: [] });

    expect(screen.getByText('暂无最近文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    expect(props.onOpenPdf).toHaveBeenCalledTimes(1);
  });
});
