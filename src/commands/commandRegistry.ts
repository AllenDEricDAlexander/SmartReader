export type CommandId =
  | 'file.open'
  | 'tab.close'
  | 'find.open'
  | 'find.next'
  | 'find.previous'
  | 'global.search.open'
  | 'sidebar.toggle'
  | 'zoom.in'
  | 'zoom.out'
  | 'zoom.fitWidth'
  | 'zoom.fitPage'
  | 'page.focus'
  | 'history.back'
  | 'history.forward'
  | 'tab.next'
  | 'tab.previous'
  | 'bookmark.add'
  | 'annotation.note'
  | 'preferences.open'
  | 'annotation.export'
  | 'annotation.import';

export type Command = {
  id: CommandId;
  label: string;
  shortcut: string | null;
  shortcutAliases?: string[];
  run: () => void;
};

export type ShortcutConflict = {
  shortcut: string;
  commandIds: CommandId[];
};

export const defaultShortcuts = {
  openFile: 'Meta+O',
  closeTab: 'Meta+W',
  find: 'Meta+F',
  findNext: 'Meta+G',
  findPrevious: 'Shift+Meta+G',
  globalSearch: 'Meta+K',
  toggleSidebar: 'Meta+B',
  zoomIn: 'Meta+=',
  zoomOut: 'Meta+-',
  fitWidth: 'Meta+0',
  fitPage: 'Meta+9',
  focusPage: 'Meta+L',
  historyBack: 'Meta+[',
  historyForward: 'Meta+]',
  nextTab: 'Control+Tab',
  previousTab: 'Shift+Control+Tab',
  addBookmark: 'Meta+D',
  addNote: 'Shift+Meta+N',
  openPreferences: 'Meta+,',
  exportAnnotations: null,
  importAnnotations: null,
} as const;

export class CommandRegistry {
  private readonly commands = new Map<CommandId, Command>();

  register(command: Command): void {
    this.commands.set(command.id, command);
  }

  run(commandId: string): boolean {
    const command = this.commands.get(commandId as CommandId);

    if (!command) {
      return false;
    }

    command.run();
    return true;
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  getShortcutConflicts(): ShortcutConflict[] {
    const byShortcut = new Map<string, CommandId[]>();

    for (const command of this.commands.values()) {
      const commandShortcuts = new Set(
        [command.shortcut, ...(command.shortcutAliases ?? [])].filter(
          (shortcut): shortcut is string => Boolean(shortcut),
        ),
      );
      for (const shortcut of commandShortcuts) {
        byShortcut.set(shortcut, [...(byShortcut.get(shortcut) ?? []), command.id]);
      }
    }

    return [...byShortcut.entries()]
      .filter(([, commandIds]) => commandIds.length > 1)
      .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
  }
}
