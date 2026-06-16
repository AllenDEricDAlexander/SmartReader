import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, defaultShortcuts } from './commandRegistry';

describe('CommandRegistry', () => {
  it('registers and runs a command', () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();

    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: handler });
    registry.run('file.open');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns false for missing commands', () => {
    const registry = new CommandRegistry();

    expect(registry.run('missing.command')).toBe(false);
  });

  it('detects shortcut conflicts', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: vi.fn() });
    registry.register({ id: 'tab.close', label: 'Close Tab', shortcut: 'Meta+O', run: vi.fn() });

    expect(registry.getShortcutConflicts()).toEqual([
      { shortcut: 'Meta+O', commandIds: ['file.open', 'tab.close'] },
    ]);
  });

  it('defines the MVP shortcuts', () => {
    expect(defaultShortcuts).toMatchObject({
      openFile: 'Meta+O',
      closeTab: 'Meta+W',
      find: 'Meta+F',
      findNext: 'Meta+G',
      findPrevious: 'Shift+Meta+G',
      zoomIn: 'Meta+=',
      zoomOut: 'Meta+-',
      fitWidth: 'Meta+0',
      fitPage: 'Meta+9',
      toggleSidebar: 'Meta+B',
      focusPage: 'Meta+L',
      historyBack: 'Meta+[',
      historyForward: 'Meta+]',
      nextTab: 'Control+Tab',
      previousTab: 'Shift+Control+Tab',
      addBookmark: 'Meta+D',
      addNote: 'Shift+Meta+N',
      openPreferences: 'Meta+,',
    });
  });
});
