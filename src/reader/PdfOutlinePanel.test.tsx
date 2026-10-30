import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfOutlinePanel } from './PdfOutlinePanel';

describe('PDF outline panel', () => {
  it('expands chapter groups and navigates to the resolved page', () => {
    const onJumpToPage = vi.fn();
    render(<PdfOutlinePanel currentPage={3} onJumpToPage={onJumpToPage} items={[
      { id: '0', title: '第一章', page: 1, children: [{ id: '0.0', title: '章节内容', page: 3, children: [] }] },
      { id: '1', title: '分组', page: null, children: [{ id: '1.0', title: '附录', page: 8, children: [] }] },
    ]} />);
    const navigation = within(screen.getByRole('navigation', { name: '章节导航' }));
    const chapter = navigation.getByRole('button', { name: '章节内容，第 3 页' });
    expect(chapter).toHaveAttribute('aria-current', 'page');
    fireEvent.click(chapter);
    expect(onJumpToPage).toHaveBeenCalledExactlyOnceWith(3);
    fireEvent.click(navigation.getByRole('button', { name: '收起 第一章' }));
    expect(navigation.queryByText('章节内容')).not.toBeInTheDocument();
    fireEvent.click(navigation.getByRole('button', { name: '展开 第一章' }));
    expect(navigation.getByText('章节内容')).toBeInTheDocument();
    expect(navigation.getByRole('button', { name: '分组' })).toBeDisabled();
    fireEvent.click(navigation.getByRole('button', { name: '附录，第 8 页' }));
    expect(onJumpToPage).toHaveBeenLastCalledWith(8);
  });

  it('distinguishes loading, absent outlines and read errors', () => {
    const view = render(<PdfOutlinePanel currentPage={1} onJumpToPage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取目录');
    view.rerender(<PdfOutlinePanel currentPage={1} items={[]} onJumpToPage={vi.fn()} />);
    expect(screen.getByText('此 PDF 没有内置目录。')).toBeInTheDocument();
    view.rerender(<PdfOutlinePanel currentPage={1} items={[]} error="目录读取失败" onJumpToPage={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('目录读取失败');
  });
});
