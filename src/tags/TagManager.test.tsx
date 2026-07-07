import { render, screen, waitFor } from '@testing-library/react';
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
    createTag: vi.fn(),
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
});
