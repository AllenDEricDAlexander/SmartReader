import { screen } from '@testing-library/react';
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

  return renderApp(<SettingsWorkspace {...props} />);
}

describe('SettingsWorkspace', () => {
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
});
