import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import { HomeBookmarksWorkspace } from './HomeBookmarksWorkspace';

const dashboard: BookmarkDashboard = {
  totalBookmarks: 3,
  groups: [
    {
      document: {
        documentKey: 'desktop:/papers/transformer.pdf',
        displayName: 'Transformer.pdf',
        path: '/papers/transformer.pdf',
        missing: false,
        fileSize: 12_582_912,
        pageCount: 89,
      },
      bookmarkCount: 2,
      bookmarks: [
        {
          id: 1,
          documentKey: 'desktop:/papers/transformer.pdf',
          page: 32,
          title: '自注意力机制',
          note: '核心思想',
          createdAt: '2026-07-20T09:00:00+08:00',
          updatedAt: '2026-07-20T09:00:00+08:00',
        },
        {
          id: 2,
          documentKey: 'desktop:/papers/transformer.pdf',
          page: 45,
          title: '多头注意力',
          note: null,
          createdAt: '2026-07-19T09:00:00+08:00',
          updatedAt: '2026-07-19T09:00:00+08:00',
        },
      ],
    },
    {
      document: {
        documentKey: 'desktop:/papers/diffusion.pdf',
        displayName: 'Diffusion.pdf',
        path: '/papers/diffusion.pdf',
        missing: false,
        fileSize: 8_192,
        pageCount: 60,
      },
      bookmarkCount: 1,
      bookmarks: [
        {
          id: 3,
          documentKey: 'desktop:/papers/diffusion.pdf',
          page: 18,
          title: '正向过程',
          note: '噪声调度',
          createdAt: '2026-06-01T09:00:00+08:00',
          updatedAt: '2026-06-01T09:00:00+08:00',
        },
      ],
    },
  ],
};

function renderWorkspace(
  overrides: Partial<Parameters<typeof HomeBookmarksWorkspace>[0]> = {},
) {
  const props: Parameters<typeof HomeBookmarksWorkspace>[0] = {
    dashboard,
    loading: false,
    error: null,
    canOpenBookmark: () => true,
    onOpenPdf: vi.fn(),
    onOpenBookmark: vi.fn(),
    onUpdateBookmark: vi.fn().mockResolvedValue(undefined),
    onDeleteBookmarks: vi.fn().mockResolvedValue({
      succeededIds: [],
      failedIds: [],
    }),
    onRefresh: vi.fn(),
    ...overrides,
  };

  render(<HomeBookmarksWorkspace {...props} />);
  return props;
}

describe('HomeBookmarksWorkspace', () => {
  it('renders the canonical grouped workspace and collapses a document group', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: '书签管理' })).toBeInTheDocument();
    expect(screen.getByText('共 3 个书签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起 Transformer.pdf' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('自注意力机制')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起 Transformer.pdf' }));

    expect(screen.getByRole('button', { name: '展开 Transformer.pdf' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('自注意力机制')).not.toBeInTheDocument();
  });

  it('searches notes, filters documents, clears filters, and preserves density', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '紧凑密度' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索书签' }), {
      target: { value: '噪声调度' },
    });
    expect(screen.getByText('正向过程')).toBeInTheDocument();
    expect(screen.queryByText('自注意力机制')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空搜索关键词' }));
    expect(screen.getByRole('searchbox', { name: '搜索书签' })).toHaveValue('');
    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索书签' }), {
      target: { value: '噪声调度' },
    });

    fireEvent.change(screen.getByRole('combobox', { name: '文档筛选' }), {
      target: { value: 'desktop:/papers/transformer.pdf' },
    });
    expect(screen.getByText('没有找到符合条件的书签')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '紧凑密度' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('applies the date filter through the toolbar', () => {
    const today = new Date().toISOString();
    const datedDashboard: BookmarkDashboard = {
      ...dashboard,
      groups: dashboard.groups.map((group) => ({
        ...group,
        bookmarks: group.bookmarks.map((bookmark) => ({
          ...bookmark,
          createdAt: bookmark.id === 1 ? today : '2020-01-01T00:00:00Z',
        })),
      })),
    };
    renderWorkspace({ dashboard: datedDashboard });

    fireEvent.change(screen.getByRole('combobox', { name: '日期筛选' }), {
      target: { value: 'today' },
    });

    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    expect(screen.queryByText('多头注意力')).not.toBeInTheDocument();
    expect(screen.queryByText('正向过程')).not.toBeInTheDocument();
  });

  it('renders loading, initial error, global empty, and filtered empty states', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <HomeBookmarksWorkspace
        dashboard={null}
        loading
        error={null}
        canOpenBookmark={() => true}
        onOpenPdf={vi.fn()}
        onOpenBookmark={vi.fn()}
        onUpdateBookmark={vi.fn()}
        onDeleteBookmarks={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByLabelText('正在加载书签')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '请选择一条书签查看详情',
    );

    rerender(
      <HomeBookmarksWorkspace
        dashboard={null}
        loading={false}
        error="书签加载失败，请重试。"
        canOpenBookmark={() => true}
        onOpenPdf={vi.fn()}
        onOpenBookmark={vi.fn()}
        onUpdateBookmark={vi.fn()}
        onDeleteBookmarks={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('书签加载失败，请重试。');
    fireEvent.click(screen.getByRole('button', { name: '重试加载书签' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <HomeBookmarksWorkspace
        dashboard={{ totalBookmarks: 0, groups: [] }}
        loading={false}
        error={null}
        canOpenBookmark={() => true}
        onOpenPdf={vi.fn()}
        onOpenBookmark={vi.fn()}
        onUpdateBookmark={vi.fn()}
        onDeleteBookmarks={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('暂无书签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开文档添加书签' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toBeInTheDocument();
  });

  it('keeps the last dashboard visible when a background refresh fails', () => {
    const onRefresh = vi.fn();
    renderWorkspace({
      error: '书签加载失败，请重试。',
      onRefresh,
    });

    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('书签加载失败，请重试。');
    fireEvent.click(screen.getByRole('button', { name: '重新加载书签' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('switches sorting, page size, pagination, and standard/compact density', () => {
    const manyBookmarks: BookmarkDashboard = {
      totalBookmarks: 21,
      groups: [
        {
          ...dashboard.groups[0],
          bookmarkCount: 21,
          bookmarks: Array.from({ length: 21 }, (_, index) => ({
            id: index + 1,
            documentKey: 'desktop:/papers/transformer.pdf',
            page: index + 1,
            title: `Bookmark ${index + 1}`,
            note: null,
            createdAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T09:00:00+08:00`,
            updatedAt: '2026-07-20T09:00:00+08:00',
          })),
        },
      ],
    };
    renderWorkspace({ dashboard: manyBookmarks });

    fireEvent.change(screen.getByRole('combobox', { name: '书签排序' }), {
      target: { value: 'pageAsc' },
    });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('Bookmark 21')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '每页书签数' }), {
      target: { value: '50' },
    });
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '紧凑密度' }));
    expect(screen.getByTestId('bookmark-management-list')).toHaveAttribute(
      'data-density',
      'compact',
    );
  });
});
