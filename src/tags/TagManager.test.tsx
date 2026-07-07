import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagManager } from './TagManager';
import type { TagDashboard } from './tagModels';

const dashboard: TagDashboard = {
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

function renderTagManager() {
  const persistence = {
    loadTagDashboard: vi.fn().mockResolvedValue(dashboard),
    createTag: vi.fn().mockResolvedValue({
      id: 2,
      name: '计算机视觉',
      color: '#2563eb',
      documentCount: 0,
      annotationCount: 0,
      createdAt: '2026-07-07T10:00:00Z',
      updatedAt: '2026-07-07T10:00:00Z',
    }),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  } as unknown as Parameters<typeof TagManager>[0]['persistence'];

  render(
    <TagManager
      persistence={persistence}
      onTagsChange={vi.fn()}
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
    />,
  );

  return persistence;
}

describe('TagManager', () => {
  it('renders the dashboard shell from backend data', async () => {
    renderTagManager();

    expect(await screen.findByRole('heading', { name: '标签管理' })).toBeInTheDocument();
    expect(screen.getByText('标签概览')).toBeInTheDocument();
    expect(screen.getByText('标签云')).toBeInTheDocument();
    expect(screen.getByText('标签详情')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('深度学习').length).toBeGreaterThan(0));
  });

  it('filters tags from the toolbar', async () => {
    renderTagManager();

    await screen.findAllByText('深度学习');
    fireEvent.change(screen.getByLabelText('搜索标签名称或描述'), {
      target: { value: '不存在' },
    });

    const table = screen.getByRole('region', { name: '全部标签' });
    expect(within(table).getByRole('heading', { name: '全部标签（0）' })).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /深度学习/ })).not.toBeInTheDocument();
  });

  it('creates a tag and refreshes the dashboard', async () => {
    const persistence = renderTagManager();

    await screen.findByRole('heading', { name: '标签管理' });
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '计算机视觉' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() =>
      expect(persistence.createTag).toHaveBeenCalledWith({ name: '计算机视觉', color: '#2563eb' }),
    );
    await waitFor(() => expect(persistence.loadTagDashboard).toHaveBeenCalledTimes(2));
  });
});
