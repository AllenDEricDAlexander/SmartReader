import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../commands/commandRegistry';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { renderApp } from '../test/renderApp';
import { SettingsWorkspace, type SettingsSection } from './SettingsWorkspace';

function renderSettingsWorkspace(initialSection?: SettingsSection) {
  const props = {
    commandRegistry: new CommandRegistry(),
    preferences: defaultReaderPreferences,
    openSessionCount: 2,
    recentDocumentCount: 3,
    cacheStats: { usedBytes: 1.24 * 1024 ** 3, totalBytes: 5 * 1024 ** 3, fileCount: 42 },
    onClose: vi.fn(),
    onSave: vi.fn(),
    ...(initialSection ? { initialSection } : {}),
  };

  return { ...renderApp(<SettingsWorkspace {...props} />), props };
}

describe('SettingsWorkspace', () => {
  it('restores the dismissed home cards through appearance settings', async () => {
    const onSave = vi.fn();
    renderApp(<SettingsWorkspace
      commandRegistry={new CommandRegistry()}
      preferences={{ ...defaultReaderPreferences, homeQuickTipsEnabled: false, homeDesktopIntegrationEnabled: false }}
      openSessionCount={0}
      recentDocumentCount={0}
      initialSection="appearance"
      onClose={vi.fn()}
      onSave={onSave}
    />);
    const quickTips = screen.getByRole('checkbox', { name: /首页显示快速上手/ });
    const desktopIntegration = screen.getByRole('checkbox', { name: /首页显示桌面集成/ });
    expect(quickTips).not.toBeChecked();
    expect(desktopIntegration).not.toBeChecked();
    fireEvent.click(quickTips);
    fireEvent.click(desktopIntegration);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(defaultReaderPreferences));
  });

  it('shows the current version and an update check under about', () => {
    const { rerender, props } = renderSettingsWorkspace('about');
    rerender(<SettingsWorkspace {...props} appVersion={{ version: '1.7', build: '86' }} />);
    expect(screen.getByRole('heading', { name: '版本信息' })).toBeInTheDocument();
    expect(screen.getByText('版本 1.7 (Build 86)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(screen.getByRole('status')).toHaveTextContent('当前版本暂未接入自动检查更新。');
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('saves the home welcome preference only after saving settings', async () => {
    const { props } = renderSettingsWorkspace('appearance');
    const toggle = screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ });

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(props.onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({
      ...defaultReaderPreferences,
      homeWelcomeEnabled: false,
    }));
  });

  it('discards a cancelled home welcome preference change', () => {
    const { props } = renderSettingsWorkspace('appearance');
    fireEvent.click(screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it.each([
    ['暗色', 'dark'],
    ['亮色', 'light'],
    ['护眼色', 'eye-care'],
  ])('saves the selected %s theme with the other preferences', async (label, theme) => {
    const { props } = renderSettingsWorkspace('appearance');
    const options = within(screen.getByRole('group', { name: '界面主题' }));

    fireEvent.click(options.getByRole('button', { name: label }));
    expect(options.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
    expect(options.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(props.onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalledWith({ ...defaultReaderPreferences, theme });
    });
  });

  it('shows shortcuts settings by default without an initial section', () => {
    renderSettingsWorkspace();

    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '缓存' })).not.toBeInTheDocument();
  });

  it('shows cache settings when the initial section is cache', () => {
    renderSettingsWorkspace('cache');

    expect(screen.getByRole('heading', { name: '缓存' })).toBeInTheDocument();
    expect(screen.getByText('1.24 GB / 5 GB')).toBeInTheDocument();
    expect(screen.getByText('已缓存 42 个文件')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '快捷键' })).not.toBeInTheDocument();
  });

  it('places version information next to cache in the left settings navigation', () => {
    renderSettingsWorkspace('cache');
    const navigation = within(screen.getByRole('navigation', { name: '设置导航' }));
    const cache = navigation.getByRole('button', { name: '缓存' });
    const version = navigation.getByRole('button', { name: '版本信息' });
    expect(cache.nextElementSibling).toBe(version);
    fireEvent.click(version);
    expect(screen.getByRole('heading', { name: '版本信息' })).toBeInTheDocument();
    expect(screen.getByText('版本 0.1.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();
    expect(screen.queryByLabelText('本地缓存')).not.toBeInTheDocument();
  });

  it('updates the visible settings section when the initial section changes', () => {
    const { rerender } = renderSettingsWorkspace('shortcuts');

    rerender(
      <SettingsWorkspace
        commandRegistry={new CommandRegistry()}
        preferences={defaultReaderPreferences}
        openSessionCount={2}
        recentDocumentCount={3}
        initialSection="cache"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '缓存' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '快捷键' })).not.toBeInTheDocument();
  });

  it('keeps manual section navigation when the initial section value is unchanged', () => {
    const { rerender } = renderSettingsWorkspace('cache');

    fireEvent.click(screen.getByRole('button', { name: '快捷键' }));

    rerender(
      <SettingsWorkspace
        commandRegistry={new CommandRegistry()}
        preferences={defaultReaderPreferences}
        openSessionCount={2}
        recentDocumentCount={3}
        initialSection="cache"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '缓存' })).not.toBeInTheDocument();
  });

  it('honors an explicit section request after resuming without discarding a dirty draft', () => {
    const { props, rerender } = renderSettingsWorkspace('appearance');
    fireEvent.click(screen.getByRole('checkbox', { name: /首页显示快速上手/ }));
    fireEvent.click(screen.getByRole('button', { name: '缓存' }));
    rerender(<SettingsWorkspace {...props} navigationRequest={1} />);
    expect(screen.getByRole('heading', { name: '外观' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /首页显示快速上手/ })).not.toBeChecked();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('preserves a dirty draft while incorporating unrelated preference changes made elsewhere', async () => {
    const { props, rerender } = renderSettingsWorkspace('appearance');
    fireEvent.click(screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ }));
    const external = { ...defaultReaderPreferences, theme: 'dark' as const, homeQuickTipsEnabled: false };
    rerender(<SettingsWorkspace {...props} preferences={external} />);
    expect(screen.getByRole('button', { name: '暗色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /首页显示快速上手/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...external, homeWelcomeEnabled: false }));
  });

  it('keeps an edited field when that same preference changes elsewhere', async () => {
    const { props, rerender } = renderSettingsWorkspace('appearance');
    fireEvent.click(screen.getByRole('button', { name: '护眼色' }));
    const external = { ...defaultReaderPreferences, theme: 'dark' as const, homeQuickTipsEnabled: false };
    rerender(<SettingsWorkspace {...props} preferences={external} />);
    expect(screen.getByRole('button', { name: '护眼色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: /首页显示快速上手/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...external, theme: 'eye-care' }));
  });

  it('merges unrelated shortcut changes without replacing an edited shortcut', async () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: vi.fn() });
    registry.register({ id: 'tab.close', label: 'Close Tab', shortcut: 'Meta+W', run: vi.fn() });
    const props = { commandRegistry: registry, preferences: defaultReaderPreferences, openSessionCount: 0,
      recentDocumentCount: 0, onClose: vi.fn(), onSave: vi.fn() };
    const { rerender } = renderApp(<SettingsWorkspace {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '编辑快捷键' }));
    fireEvent.change(screen.getByLabelText('Open File shortcut'), { target: { value: 'Meta+P' } });
    const external = { ...defaultReaderPreferences, shortcuts: { ...defaultReaderPreferences.shortcuts, 'tab.close': 'Control+W' } };
    rerender(<SettingsWorkspace {...props} preferences={external} />);
    expect(screen.getByLabelText('Open File shortcut')).toHaveValue('Meta+P');
    expect(screen.getByLabelText('Close Tab shortcut')).toHaveValue('Control+W');
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...external, shortcuts: { ...external.shortcuts, 'file.open': 'Meta+P' } }));
  });

  it('retains edits made while a previous save is still pending', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const onSave = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const props = { commandRegistry: new CommandRegistry(), preferences: defaultReaderPreferences, openSessionCount: 0,
      recentDocumentCount: 0, initialSection: 'appearance' as const, onClose: vi.fn(), onSave };
    const { rerender } = renderApp(<SettingsWorkspace {...props} />);
    const welcome = screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ });
    const tips = screen.getByRole('checkbox', { name: /首页显示快速上手/ });
    fireEvent.click(welcome);
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onSave).toHaveBeenCalledWith({ ...defaultReaderPreferences, homeWelcomeEnabled: false });
    fireEvent.click(welcome);
    fireEvent.click(tips);
    rerender(<SettingsWorkspace {...props} preferences={{ ...defaultReaderPreferences, homeWelcomeEnabled: false }} />);
    await act(async () => { finish(); await pending; });
    expect(welcome).toBeChecked();
    expect(tips).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ ...defaultReaderPreferences, homeQuickTipsEnabled: false }));
  });

  it('retains a failed draft and allows retry without starting duplicate saves', async () => {
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => { fail = reject; });
    const onSave = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    renderApp(<SettingsWorkspace commandRegistry={new CommandRegistry()} preferences={defaultReaderPreferences}
      openSessionCount={0} recentDocumentCount={0} initialSection="appearance" onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => { fail(new Error('磁盘忙')); await pending.catch(() => undefined); });
    expect(screen.getByRole('alert')).toHaveTextContent('磁盘忙');
    expect(screen.getByRole('checkbox', { name: /进入首页时显示欢迎语/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith({ ...defaultReaderPreferences, homeWelcomeEnabled: false });
  });
});
