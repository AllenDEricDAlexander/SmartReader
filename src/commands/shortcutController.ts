import type { CommandRegistry } from './commandRegistry';

export function getShortcutFromKeyboardEvent(event: KeyboardEvent): string {
  const keys: string[] = [];

  if (event.ctrlKey) {
    keys.push('Control');
  }

  if (event.shiftKey) {
    keys.push('Shift');
  }

  if (event.metaKey) {
    keys.push('Meta');
  }

  if (event.altKey) {
    keys.push('Alt');
  }

  keys.push(normalizeKey(event.key));
  return keys.join('+');
}

export function handleShortcutEvent(event: KeyboardEvent, registry: CommandRegistry): boolean {
  const shortcut = getShortcutFromKeyboardEvent(event);
  const command = findCommandByShortcut(registry, shortcut);

  if (!command) {
    return false;
  }

  event.preventDefault();
  registry.run(command.id);
  return true;
}

export function preventRegisteredShortcutDefault(
  event: KeyboardEvent,
  registry: CommandRegistry,
): boolean {
  const shortcut = getShortcutFromKeyboardEvent(event);
  const command = findCommandByShortcut(registry, shortcut);

  if (!command) {
    return false;
  }

  event.preventDefault();
  return true;
}

function findCommandByShortcut(registry: CommandRegistry, shortcut: string) {
  return registry
    .list()
    .find((candidate) => [candidate.shortcut, ...(candidate.shortcutAliases ?? [])].includes(shortcut));
}

function normalizeKey(key: string): string {
  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key;
}
