import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '../../annotations/annotationModels';
import { BookmarkActions } from './BookmarkActions';

const bookmark: Bookmark = {
  id: 7,
  documentKey: 'desktop:/tmp/book.pdf',
  page: 3,
  title: 'Page 3',
  note: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('BookmarkActions', () => {
  it('renames and deletes a persisted bookmark', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <BookmarkActions bookmark={bookmark} onDelete={onDelete} onRename={onRename} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重命名书签 Page 3' }));
    fireEvent.change(screen.getByRole('textbox', { name: '重命名书签 Page 3' }), {
      target: { value: '核心结论' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签名称 Page 3' }));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith(bookmark, '核心结论');
    });
    expect(screen.queryByRole('textbox', { name: '重命名书签 Page 3' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除书签 Page 3' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(bookmark);
    });
  });

  it('keeps the rename editor open when persistence fails', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('write failed'));

    render(
      <BookmarkActions bookmark={bookmark} onDelete={vi.fn()} onRename={onRename} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重命名书签 Page 3' }));
    fireEvent.change(screen.getByRole('textbox', { name: '重命名书签 Page 3' }), {
      target: { value: '核心结论' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签名称 Page 3' }));

    expect(await screen.findByText('书签重命名失败，请重试。')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '重命名书签 Page 3' })).toHaveValue('核心结论');
  });
});
