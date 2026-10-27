import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, defaultShortcuts } from '../commands/commandRegistry';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { ShortcutSettings } from './ShortcutSettings';

describe('ShortcutSettings', () => {
  it('reports conflicts with the default previous-tab alias in the current draft', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'tab.previous', label: 'Previous Tab', shortcut: defaultShortcuts.previousTab, run: vi.fn() });
    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: vi.fn() });
    const preferences = { ...defaultReaderPreferences, shortcuts: { ...defaultReaderPreferences.shortcuts, 'file.open': 'Control+Shift+Tab' } };
    const { rerender } = render(<ShortcutSettings commandRegistry={registry} preferences={preferences} onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Control+Shift+Tab: Previous Tab、Open File');
    rerender(<ShortcutSettings commandRegistry={registry} preferences={{ ...preferences,
      shortcuts: { ...preferences.shortcuts, 'tab.previous': 'Meta+P' } }} onChange={vi.fn()} />);
    expect(screen.getByText('当前没有快捷键冲突。')).toBeInTheDocument();
  });

  it('reports conflicts with the default global-search alias', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'global.search.open', label: 'Global Search', shortcut: defaultShortcuts.globalSearch, run: vi.fn() });
    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: vi.fn() });
    const preferences = { ...defaultReaderPreferences, shortcuts: { ...defaultReaderPreferences.shortcuts, 'file.open': 'Control+K' } };
    render(<ShortcutSettings commandRegistry={registry} preferences={preferences} onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Control+K: Global Search、Open File');
  });
});
