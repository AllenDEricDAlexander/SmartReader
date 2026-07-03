import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeAssistPanel } from './HomeAssistPanel';

function renderAssistPanel() {
  const props = {
    appVersion: {
      version: '0.1.0',
      build: null,
    },
    onOpenGlobalSearch: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenAnnotations: vi.fn(),
    onOpenShortcutSettings: vi.fn(),
    onOpenCacheManagement: vi.fn(),
    onSetupFileAssociation: vi.fn(),
    onCheckUpdates: vi.fn(),
  };

  renderApp(<HomeAssistPanel {...props} />);
  return props;
}

describe('HomeAssistPanel', () => {
  it('renders quick tips, desktop integration, and version cards', () => {
    renderAssistPanel();

    const assist = screen.getByRole('complementary', { name: '辅助信息' });
    expect(within(assist).getByRole('heading', { name: '快速上手' })).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '更多技巧' })).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: /搜索文件与内容/ })).toHaveTextContent('⌘K');
    expect(
      within(assist).getByText('使用顶部搜索框快速查找文件、书签、批注与全文内容。'),
    ).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: /书签管理/ })).toHaveTextContent('⌘D');
    expect(
      within(assist).getByText('使用书签标记重要页面，支持层级与标签分类。'),
    ).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: /批注与高亮/ })).toHaveTextContent('⌘E');
    expect(
      within(assist).getByText('在阅读中添加批注、高亮与划线，支持导出。'),
    ).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: /快捷键总览/ })).toHaveTextContent('⌘/');
    expect(within(assist).getByText('查看所有快捷键，提升阅读与管理效率。')).toBeInTheDocument();

    expect(within(assist).getByRole('heading', { name: '桌面集成' })).toBeInTheDocument();
    expect(within(assist).getByText('支持 "Open With"')).toBeInTheDocument();
    expect(within(assist).getByText('在 Finder 中右键使用 SmartReader 打开 PDF。')).toBeInTheDocument();
    expect(within(assist).getByText('文件关联')).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '设置关联' })).toBeInTheDocument();
    expect(within(assist).getByText('本地缓存')).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '管理缓存' })).toBeInTheDocument();

    expect(within(assist).getByText('SmartReader')).toBeInTheDocument();
    expect(within(assist).getByText('版本 0.1.0')).toBeInTheDocument();
    expect(within(assist).getByText('本地优先 · 隐私安全 · 高效阅读')).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '检查更新' })).toBeInTheDocument();
  });

  it('formats build metadata when available', () => {
    const props = {
      appVersion: {
        version: '1.7',
        build: '86',
      },
      onOpenGlobalSearch: vi.fn(),
      onOpenBookmarks: vi.fn(),
      onOpenAnnotations: vi.fn(),
      onOpenShortcutSettings: vi.fn(),
      onOpenCacheManagement: vi.fn(),
      onSetupFileAssociation: vi.fn(),
      onCheckUpdates: vi.fn(),
    };

    renderApp(<HomeAssistPanel {...props} />);

    expect(screen.getByText('版本 1.7 (Build 86)')).toBeInTheDocument();
  });

  it('forwards every assist action callback', () => {
    const props = renderAssistPanel();

    fireEvent.click(screen.getByRole('button', { name: '更多技巧' }));
    fireEvent.click(screen.getByRole('button', { name: /搜索文件与内容/ }));
    fireEvent.click(screen.getByRole('button', { name: /书签管理/ }));
    fireEvent.click(screen.getByRole('button', { name: /批注与高亮/ }));
    fireEvent.click(screen.getByRole('button', { name: /快捷键总览/ }));
    fireEvent.click(screen.getByRole('button', { name: '设置关联' }));
    fireEvent.click(screen.getByRole('button', { name: '管理缓存' }));
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    expect(props.onOpenShortcutSettings).toHaveBeenCalledTimes(2);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(props.onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(props.onSetupFileAssociation).toHaveBeenCalledTimes(1);
    expect(props.onOpenCacheManagement).toHaveBeenCalledTimes(1);
    expect(props.onCheckUpdates).toHaveBeenCalledTimes(1);
  });
});
