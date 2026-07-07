import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';
import { renderApp } from '../test/renderApp';
import { HomeFavoriteFilesWorkspace } from './HomeFavoriteFilesWorkspace';

const tags: Tag[] = [
  {
    id: 1,
    name: 'Transformer',
    color: '#2563eb',
    documentCount: 2,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
  {
    id: 2,
    name: '图神经网络',
    color: '#16a34a',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
];

const documents: FavoriteDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Papers/Beta Research.pdf',
    path: '/Users/mario/Papers/Beta Research.pdf',
    displayName: 'Beta Research.pdf',
    pageCount: 100,
    lastPage: 15,
    progress: 0.15,
    missing: false,
    lastOpenedAt: '2026-07-03T09:30:00+08:00',
    tagIds: [1],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
    path: '/Users/mario/Archive/Alpha Notes.pdf',
    displayName: 'Alpha Notes.pdf',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
    lastOpenedAt: '2026-07-05T11:00:00+08:00',
    tagIds: [1, 2],
  },
  {
    documentKey: 'browser:local-upload',
    path: null,
    displayName: 'Local Upload.pdf',
    pageCount: null,
    lastPage: 0,
    progress: 0,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof HomeFavoriteFilesWorkspace>> = {}) {
  const props: ComponentProps<typeof HomeFavoriteFilesWorkspace> = {
    documents,
    tags,
    onOpenPdf: vi.fn(),
    onOpenDocument: vi.fn(),
    onToggleFavorite: vi.fn(),
    onLocateFile: vi.fn(),
    onOpenTags: vi.fn(),
    ...overrides,
  };

  renderApp(<HomeFavoriteFilesWorkspace {...props} />);

  return props;
}

function listedNames() {
  return screen
    .getAllByTestId('favorite-workspace-document')
    .map((element) => within(element).getByTestId('favorite-workspace-document-name').textContent);
}

describe('HomeFavoriteFilesWorkspace', () => {
  it('renders favorites in card view with overview and real tag stats', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
    expect(screen.getByText('共 3 个收藏，当前显示 3 个')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索收藏文件' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '排序方式' })).toHaveValue('recent');
    expect(screen.getByRole('combobox', { name: '阅读进度筛选' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: '标签筛选' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: '目录筛选' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(listedNames()).toEqual(['Alpha Notes.pdf', 'Beta Research.pdf', 'Local Upload.pdf']);
    expect(screen.getByText('收藏概览')).toBeInTheDocument();
    expect(screen.getByText('常用标签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按标签筛选 Transformer' })).toBeInTheDocument();
  });

  it('searches and clears filters without changing view mode', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏文件' }), {
      target: { value: 'archive' },
    });

    expect(screen.getByText('共 3 个收藏，当前显示 1 个')).toBeInTheDocument();
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(screen.getByRole('searchbox', { name: '搜索收藏文件' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('共 3 个收藏，当前显示 3 个')).toBeInTheDocument();
  });

  it('filters by progress, tag, and directory', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'completed' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '标签筛选' }), {
      target: { value: '2' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '标签筛选' }), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '目录筛选' }), {
      target: { value: '/Users/mario/Papers' },
    });
    expect(listedNames()).toEqual(['Beta Research.pdf']);
  });

  it('sorts by name and progress', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'progressAsc' },
    });
    expect(listedNames()).toEqual(['Local Upload.pdf', 'Beta Research.pdf', 'Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'name' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf', 'Beta Research.pdf', 'Local Upload.pdf']);
  });

  it('wires continue reading, favorite toggle, tag click, and locate menu actions', () => {
    const props = renderWorkspace();

    fireEvent.click(within(screen.getAllByTestId('favorite-workspace-document')[0]).getByRole('button', { name: '继续阅读 Alpha Notes.pdf' }));
    expect(props.onOpenDocument).toHaveBeenCalledWith(documents[1]);

    fireEvent.click(within(screen.getAllByTestId('favorite-workspace-document')[0]).getByRole('button', { name: '取消收藏 Alpha Notes.pdf' }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith('desktop:/Users/mario/Archive/Alpha Notes.pdf', false);

    fireEvent.click(screen.getByRole('button', { name: '按标签筛选 Transformer' }));
    expect(screen.getByRole('combobox', { name: '标签筛选' })).toHaveValue('1');

    fireEvent.click(within(screen.getAllByTestId('favorite-workspace-document')[0]).getByRole('button', { name: '更多操作 Alpha Notes.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '定位文件' }));
    expect(props.onLocateFile).toHaveBeenCalledWith(documents[1]);
  });

  it('shows empty, no-result, and recommendation empty states', () => {
    const props = renderWorkspace({ documents: [] });

    expect(screen.getByText('暂无收藏文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    expect(props.onOpenPdf).toHaveBeenCalledTimes(1);

    renderWorkspace({ documents: [documents[2]], tags: [] });
    expect(screen.getAllByText('暂无可用推荐理由').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏文件' }), {
      target: { value: 'does-not-exist' },
    });
    expect(screen.getByText('没有匹配的收藏文件')).toBeInTheDocument();
  });
});
