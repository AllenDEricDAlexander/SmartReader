import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfOutlineDrawer } from './PdfOutlineDrawer';
import type { ViewerOutlineItem } from '../viewer/viewerTypes';

const drawerProps = { open: true, documentTitle: 'Book.pdf', currentPage: 1, onJumpToPage: vi.fn(), onClose: vi.fn() };
const nestedOutline: ViewerOutlineItem[] = [
  { id: '0', title: '第一章', page: 1, children: [
    { id: '0.0', title: '第一节', page: 2, children: [
      { id: '0.0.0', title: '小节', page: 3, children: [{ id: '0.0.0.0', title: '正文', page: 4, children: [] }] },
    ] },
  ] },
  { id: '1', title: '第二章', page: 5, children: [
    { id: '1.0', title: '第二节', page: 6, children: [{ id: '1.0.0', title: '附录内容', page: 7, children: [] }] },
  ] },
];

describe('PDF outline drawer', () => {
  it('expands chapter groups and navigates to the resolved page', () => {
    const onJumpToPage = vi.fn();
    render(<PdfOutlineDrawer {...drawerProps} currentPage={3} onJumpToPage={onJumpToPage} items={[
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
    const view = render(<PdfOutlineDrawer {...drawerProps} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取目录');
    view.rerender(<PdfOutlineDrawer {...drawerProps} items={[]} />);
    expect(screen.getByText('此 PDF 没有内置目录。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部展开' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '全部折叠' })).toBeDisabled();
    view.rerender(<PdfOutlineDrawer {...drawerProps} items={[]} error="目录读取失败" />);
    expect(screen.getByRole('alert')).toHaveTextContent('目录读取失败');
  });

  it('expands and collapses the complete tree including hidden descendants', () => {
    render(<PdfOutlineDrawer {...drawerProps} items={nestedOutline} />);
    expect(screen.queryByText('正文')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(screen.getByRole('button', { name: '正文，第 4 页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '附录内容，第 7 页' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }));
    expect(screen.queryByText('第一节')).not.toBeInTheDocument();
    expect(screen.queryByText('第二节')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开 第一章' }));
    expect(screen.getByRole('button', { name: '展开 第一节' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('小节')).not.toBeInTheDocument();
  });

  it('applies recursive actions at every branch depth without changing sibling chapters', () => {
    const onJumpToPage = vi.fn();
    render(<PdfOutlineDrawer {...drawerProps} items={nestedOutline} onJumpToPage={onJumpToPage} />);
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    fireEvent.click(screen.getByRole('button', { name: '全部折叠 第一节 的子目录' }));
    expect(screen.queryByText('小节')).not.toBeInTheDocument();
    expect(screen.getByText('附录内容')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部展开 第一节 的子目录' }));
    expect(screen.getByText('正文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部折叠 小节 的子目录' }));
    expect(screen.queryByText('正文')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部展开 小节 的子目录' }));
    expect(screen.getByText('正文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部折叠 第一章 的子目录' }));
    fireEvent.click(screen.getByRole('button', { name: '展开 第一章' }));
    expect(screen.getByRole('button', { name: '展开 第一节' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('附录内容')).toBeInTheDocument();
    expect(onJumpToPage).not.toHaveBeenCalled();
  });

  it('preserves expansion when reopened and resets it when another outline arrives', () => {
    const view = render(<PdfOutlineDrawer {...drawerProps} items={nestedOutline} />);
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    view.rerender(<PdfOutlineDrawer {...drawerProps} open={false} items={nestedOutline} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(<PdfOutlineDrawer {...drawerProps} items={nestedOutline} />);
    expect(screen.getByText('正文')).toBeInTheDocument();
    view.rerender(<PdfOutlineDrawer {...drawerProps} items={[...nestedOutline]} />);
    expect(screen.queryByText('正文')).not.toBeInTheDocument();
  });
});
