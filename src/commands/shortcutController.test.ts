import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from './commandRegistry';
import {
  getShortcutFromKeyboardEvent,
  handleShortcutEvent,
  preventRegisteredShortcutDefault,
} from './shortcutController';

describe('shortcutController', () => {
  it('normalizes keyboard events into shortcut strings', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      metaKey: true,
    });

    expect(getShortcutFromKeyboardEvent(event)).toBe('Meta+O');
  });

  it('runs matching commands and prevents browser defaults', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'file.open', label: 'Open', shortcut: 'Meta+O', run });
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    expect(handleShortcutEvent(event, registry)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('runs commands from shortcut aliases', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({
      id: 'global.search.open',
      label: 'Global Search',
      shortcut: 'Meta+K',
      shortcutAliases: ['Control+K'],
      run,
    });
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(handleShortcutEvent(event, registry)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('prevents defaults for registered shortcuts without running commands', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'tab.close', label: 'Close Tab', shortcut: 'Meta+W', run });
    const event = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(preventRegisteredShortcutDefault(event, registry)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});
