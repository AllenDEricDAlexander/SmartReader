import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeTopBar } from './HomeTopBar';

function renderTopBar() {
  const props = {
    onOpenPdf: vi.fn(),
    onOpenGlobalSearch: vi.fn(),
    onOpenImport: vi.fn(),
    onOpenCompare: vi.fn(),
    onOpenAnnotations: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  render(<HomeTopBar {...props} />);
  return props;
}

describe('HomeTopBar', () => {
  it('renders desktop app chrome and shortcut entries', () => {
    renderTopBar();

    expect(screen.getByLabelText('macOS 窗口控制')).toBeInTheDocument();
    expect(screen.getByText('SmartReader')).toBeInTheDocument();
    expect(screen.getByText('本地优先的 PDF 阅读器')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开文件' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '全局搜索' })).toHaveAttribute(
      'placeholder',
      '搜索文件、书签、批注...',
    );
    expect(screen.getByText('⌘K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入文献' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对比阅读' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批注管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '书签' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  });

  it('forwards click actions', () => {
    const props = renderTopBar();

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    fireEvent.click(screen.getByRole('searchbox', { name: '全局搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    fireEvent.click(screen.getByRole('button', { name: '对比阅读' }));
    fireEvent.click(screen.getByRole('button', { name: '批注管理' }));
    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(props.onOpenPdf).toHaveBeenCalledTimes(1);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.onOpenImport).toHaveBeenCalledTimes(1);
    expect(props.onOpenCompare).toHaveBeenCalledTimes(1);
    expect(props.onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(props.onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('opens global search from input focus', () => {
    const props = renderTopBar();

    fireEvent.focus(screen.getByRole('searchbox', { name: '全局搜索' }));

    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it('reopens from focus after restoring focus from the global search panel', () => {
    const props = renderTopBar();
    const searchTrigger = screen.getByRole('searchbox', { name: '全局搜索' });

    fireEvent.focus(searchTrigger);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);

    props.onOpenGlobalSearch.mockClear();
    searchTrigger.dataset.globalSearchRestoreFocus = 'true';
    fireEvent.focus(searchTrigger);
    expect(props.onOpenGlobalSearch).not.toHaveBeenCalled();

    fireEvent.blur(searchTrigger);
    fireEvent.focus(searchTrigger);

    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it('opens global search from input click including when focused', () => {
    const props = renderTopBar();
    const searchTrigger = screen.getByRole('searchbox', { name: '全局搜索' });

    fireEvent.click(searchTrigger);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);

    props.onOpenGlobalSearch.mockClear();
    fireEvent.focus(searchTrigger);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);

    props.onOpenGlobalSearch.mockClear();
    fireEvent.click(searchTrigger);

    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it('opens global search once when a mouse click focuses the input', () => {
    const props = renderTopBar();
    const searchTrigger = screen.getByRole('searchbox', { name: '全局搜索' });

    fireEvent.mouseDown(searchTrigger);
    fireEvent.focus(searchTrigger);
    fireEvent.click(searchTrigger);

    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it('opens global search from keyboard activation', () => {
    const props = renderTopBar();
    const searchTrigger = screen.getByRole('searchbox', { name: '全局搜索' });

    expect(searchTrigger).toBeInTheDocument();

    fireEvent.keyDown(searchTrigger!, { key: 'Enter' });
    fireEvent.keyDown(searchTrigger!, { key: ' ' });

    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(2);
  });
});
