/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeTopBar } from './HomeTopBar';

function readAppStyles() {
  return readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
}

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
  it('keeps the top bar in one elastic row', () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.home-dashboard-shell\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
    expect(styles).toMatch(/\.home-top-bar\s*{[^}]*min-height:\s*56px;/s);
    expect(styles).toMatch(/\.home-top-bar\s*{[^}]*display:\s*flex;/s);
    expect(styles).not.toMatch(/\.home-top-bar\s*{[^}]*grid-template-columns:/s);
    expect(styles).toMatch(/\.home-top-bar\s*{[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).toMatch(/\.global-search-trigger\s*{[^}]*flex:\s*1 1 0;/s);
    expect(styles).toMatch(/\.top-shortcuts\s*{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(/\.top-shortcuts\s*{[^}]*max-width:\s*252px;/s);
    expect(styles).toMatch(/\.top-shortcuts\s*{[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).toMatch(/\.top-shortcuts button\s*{[^}]*width:\s*44px;/s);
    expect(styles).toMatch(/\.top-shortcuts button\s*{[^}]*height:\s*44px;/s);
    expect(styles).toMatch(/\.top-shortcuts button\s*{[^}]*flex:\s*0 0 44px;/s);
    expect(styles).toMatch(/\.top-shortcuts button span\s*{[^}]*display:\s*none;/s);
    expect(styles).not.toMatch(/\.top-shortcuts\s*{[^}]*grid-column:\s*1 \/ -1;/s);
    expect(styles).toMatch(/@media \(max-width: 720px\)\s*{[^@]*\.home-top-bar\s*{[^}]*min-height:\s*48px;/s);
  });

  it('renders desktop app chrome and shortcut entries', () => {
    renderTopBar();

    expect(screen.queryByLabelText('macOS 窗口控制')).not.toBeInTheDocument();
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
