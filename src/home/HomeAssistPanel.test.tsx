import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeAssistPanel } from './HomeAssistPanel';

function renderAssistPanel(overrides: Partial<ComponentProps<typeof HomeAssistPanel>> = {}) {
  const props = {
    onOpenGlobalSearch: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenAnnotations: vi.fn(),
    onOpenShortcutSettings: vi.fn(),
    onSetupFileAssociation: vi.fn(),
    onCloseQuickTips: vi.fn(),
    onCloseDesktopIntegration: vi.fn(),
    ...overrides,
  };

  renderApp(<HomeAssistPanel {...props} />);
  return props;
}

describe('HomeAssistPanel', () => {
  it('renders quick tips and desktop integration without version or cache cards', () => {
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
    expect(within(assist).queryByText('本地缓存')).not.toBeInTheDocument();
    expect(within(assist).queryByRole('button', { name: '管理缓存' })).not.toBeInTheDocument();
    expect(within(assist).queryByLabelText('版本信息')).not.toBeInTheDocument();
    expect(within(assist).queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument();
  });

  it('releases the assist column when both optional cards are closed', () => {
    renderAssistPanel({ quickTipsEnabled: false, desktopIntegrationEnabled: false });
    expect(screen.queryByRole('complementary', { name: '辅助信息' })).not.toBeInTheDocument();
  });

  it('forwards every assist action callback', () => {
    const props = renderAssistPanel();

    fireEvent.click(screen.getByRole('button', { name: '更多技巧' }));
    fireEvent.click(screen.getByRole('button', { name: /搜索文件与内容/ }));
    fireEvent.click(screen.getByRole('button', { name: /书签管理/ }));
    fireEvent.click(screen.getByRole('button', { name: /批注与高亮/ }));
    fireEvent.click(screen.getByRole('button', { name: /快捷键总览/ }));
    fireEvent.click(screen.getByRole('button', { name: '设置关联' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭快速上手' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭桌面集成' }));

    expect(props.onOpenShortcutSettings).toHaveBeenCalledTimes(2);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(props.onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(props.onSetupFileAssociation).toHaveBeenCalledTimes(1);
    expect(props.onCloseQuickTips).toHaveBeenCalledOnce();
    expect(props.onCloseDesktopIntegration).toHaveBeenCalledOnce();
  });
});
