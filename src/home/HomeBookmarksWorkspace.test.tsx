import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import type { BookmarkDeleteResult } from './bookmarkManagementUtils';
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

  it('selects a row without jumping and exposes real detail data', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByText('自注意力机制'));

    expect(props.onOpenBookmark).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      'Transformer.pdf',
    );
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '/papers/transformer.pdf',
    );
    expect(screen.getByText('未识别章节')).toBeInTheDocument();
    expect(screen.getByText('32 / 89')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '跳转到书签 自注意力机制' }));
    expect(props.onOpenBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, page: 32 }),
    );
  });

  it('clears the selected detail without opening the document', () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '关闭书签详情' }));

    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '请选择一条书签查看详情',
    );
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(props.onOpenBookmark).not.toHaveBeenCalled();
  });

  it('retains a visible selection across group collapse and re-expand', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '收起 Transformer.pdf' }));

    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '自注意力机制',
    );
    fireEvent.click(screen.getByRole('button', { name: '展开 Transformer.pdf' }));
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('clears detail when the selected bookmark is hidden by filtering', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索书签' }), {
      target: { value: '噪声调度' },
    });

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
        '请选择一条书签查看详情',
      );
    });
  });

  it('navigates to the next bookmark and focuses its row', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));

    fireEvent.click(screen.getByRole('button', { name: '下一条书签 多头注意力' }));

    expect(screen.getByTestId('bookmark-management-row-2')).toHaveFocus();
    expect(screen.getByTestId('bookmark-management-row-2')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '多头注意力',
    );

    fireEvent.click(screen.getByRole('button', { name: '上一条书签 自注意力机制' }));
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveFocus();
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('edits title and note together and preserves input after a failed save', async () => {
    const onUpdateBookmark = vi
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);
    renderWorkspace({ onUpdateBookmark });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注 自注意力机制' }));

    expect(screen.getByRole('textbox', { name: '书签备注' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: '  核心结论  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: '  重新核对  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('书签保存失败，请重试。');
    expect(screen.getByRole('textbox', { name: '书签名称' })).toHaveValue('  核心结论  ');
    expect(screen.getByRole('textbox', { name: '书签备注' })).toHaveValue('  重新核对  ');

    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    await waitFor(() => {
      expect(onUpdateBookmark).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1 }),
        { title: '核心结论', note: '重新核对' },
      );
    });
    expect(screen.queryByRole('dialog', { name: '编辑书签' })).not.toBeInTheDocument();
  });

  it('focuses title from the row menu, validates it, and normalizes blank note to null', async () => {
    const onUpdateBookmark = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onUpdateBookmark });
    fireEvent.click(screen.getByRole('button', { name: '打开书签操作 自注意力机制' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑书签 自注意力机制' }));

    expect(screen.getByRole('textbox', { name: '书签名称' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    expect(screen.getByRole('alert')).toHaveTextContent('书签名称不能为空。');

    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: '核心结论' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    await waitFor(() => {
      expect(onUpdateBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        { title: '核心结论', note: null },
      );
    });
  });

  it('confirms before discarding dirty editor values', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注 自注意力机制' }));
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: 'changed' },
    });

    fireEvent.keyDown(screen.getByRole('dialog', { name: '编辑书签' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '放弃书签更改' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
    expect(screen.queryByRole('dialog', { name: '编辑书签' })).not.toBeInTheDocument();
  });

  it('traps editor focus and restores it to the opening action', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    const trigger = screen.getByRole('button', { name: '编辑备注 自注意力机制' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '编辑书签' });
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0];
    const last = buttons.at(-1)!;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(trigger).toHaveFocus();
  });

  it('copies a reference and reports unavailable clipboard access', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '复制引用 自注意力机制' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('《Transformer.pdf》，“自注意力机制”，第 32 页');
    });
    expect(screen.getByRole('status')).toHaveTextContent('引用已复制');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    fireEvent.click(screen.getByRole('button', { name: '复制引用 自注意力机制' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制引用失败，请重试。');
  });

  it('supports row-menu arrows, Home, End, and Escape', () => {
    renderWorkspace();
    const trigger = screen.getByRole('button', { name: '打开书签操作 自注意力机制' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: '书签操作 自注意力机制' });
    const items = within(menu).getAllByRole('menuitem');

    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables open and jump for missing files but keeps edit and copy enabled', () => {
    const missingDashboard: BookmarkDashboard = {
      totalBookmarks: 1,
      groups: [
        {
          ...dashboard.groups[1],
          document: {
            ...dashboard.groups[1].document,
            missing: true,
          },
        },
      ],
    };
    renderWorkspace({
      dashboard: missingDashboard,
      canOpenBookmark: () => false,
    });
    fireEvent.click(screen.getByText('正向过程'));

    expect(screen.getByRole('button', { name: '打开文档 Diffusion.pdf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '跳转到书签 正向过程' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑备注 正向过程' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '复制引用 正向过程' })).toBeEnabled();
    expect(screen.getAllByText('源文件不可用').length).toBeGreaterThan(0);
  });

  it('cancels single delete with safe default focus', () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    const trigger = screen.getByRole('button', { name: '删除书签 自注意力机制' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '删除书签' });
    expect(dialog).toHaveTextContent('自注意力机制');
    expect(dialog).toHaveTextContent('此操作不可撤销');
    expect(screen.getByRole('button', { name: '取消删除' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '确认删除' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '取消删除' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '取消删除' }));
    expect(props.onDeleteBookmarks).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '删除书签' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('selects the next same-document bookmark after successful single delete', async () => {
    const onDeleteBookmarks = vi.fn().mockResolvedValue({
      succeededIds: [1],
      failedIds: [],
    });
    renderWorkspace({ onDeleteBookmarks });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '删除书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(onDeleteBookmarks).toHaveBeenCalledWith([
        expect.objectContaining({ id: 1, title: '自注意力机制' }),
      ]);
    });
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '多头注意力',
    );
  });

  it('keeps the selected bookmark when single delete fails', async () => {
    renderWorkspace({
      onDeleteBookmarks: vi.fn().mockResolvedValue({
        succeededIds: [],
        failedIds: [1],
      }),
    });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '删除书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('删除书签失败，请重试。');
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('disables every confirmation action while deletion is pending', () => {
    renderWorkspace({
      onDeleteBookmarks: vi.fn(
        () => new Promise<BookmarkDeleteResult>(() => undefined),
      ),
    });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '删除书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    expect(screen.getByRole('dialog', { name: '删除书签' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消删除' })).toBeDisabled();
  });

  it('selects only the current page in batch mode and cancels without clearing detail', () => {
    const pagedDashboard: BookmarkDashboard = {
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
    renderWorkspace({ dashboard: pagedDashboard });
    fireEvent.click(screen.getByText('Bookmark 1'));
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页书签' }));

    expect(screen.getByText('已选择 20 条书签')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: /选择书签/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByRole('checkbox', { name: '选择当前页书签' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择书签 Bookmark 21' })).not.toBeChecked();
    expect(screen.getByText('已选择 20 条书签')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消批量操作' }));
    expect(screen.queryByRole('checkbox', { name: '选择当前页书签' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      'Bookmark 1',
    );
  });

  it('retains only failed IDs after partial batch deletion', async () => {
    const onDeleteBookmarks = vi.fn().mockResolvedValue({
      succeededIds: [1],
      failedIds: [2],
    });
    renderWorkspace({ onDeleteBookmarks });
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 多头注意力' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条书签' }));

    expect(screen.getByRole('dialog', { name: '批量删除书签' })).toHaveTextContent('2 条');
    fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }));

    await waitFor(() => {
      expect(onDeleteBookmarks).toHaveBeenCalledWith([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 }),
      ]);
    });
    expect(screen.getByRole('status')).toHaveTextContent('成功 1 条，失败 1 条');
    expect(screen.getByRole('checkbox', { name: '选择书签 自注意力机制' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择书签 多头注意力' })).toBeChecked();
    expect(screen.getByText('已选择 1 条书签')).toBeInTheDocument();
  });

  it('exits batch mode after all selected bookmarks are deleted', async () => {
    renderWorkspace({
      onDeleteBookmarks: vi.fn().mockResolvedValue({
        succeededIds: [1, 2],
        failedIds: [],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 多头注意力' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条书签' }));
    fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }));

    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: '选择当前页书签' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent('成功 2 条，失败 0 条');
  });
});
