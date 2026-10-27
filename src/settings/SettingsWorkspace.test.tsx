import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByRole('heading', { name: '关于 SmartReader' })).toBeInTheDocument();
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
    expect(screen.queryByRole('heading', { name: '快捷键' })).not.toBeInTheDocument();
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
});
