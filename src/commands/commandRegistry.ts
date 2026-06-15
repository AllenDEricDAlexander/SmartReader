export type CommandId =
  | 'file.open'
  | 'tab.close'
  | 'find.open'
  | 'find.next'
  | 'find.previous'
  | 'sidebar.toggle'
  | 'zoom.in'
  | 'zoom.out'
  | 'page.focus'
  | 'history.back'
  | 'history.forward'
  | 'tab.next'
  | 'tab.previous';

export type Command = {
  id: CommandId;
  label: string;
  shortcut: string | null;
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
  toggleSidebar: 'Meta+B',
  zoomIn: 'Meta+=',
  zoomOut: 'Meta+-',
  focusPage: 'Meta+L',
  historyBack: 'Meta+[',
  historyForward: 'Meta+]',
  nextTab: 'Control+Tab',
  previousTab: 'Shift+Control+Tab',
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
      if (!command.shortcut) {
        continue;
      }

      byShortcut.set(command.shortcut, [...(byShortcut.get(command.shortcut) ?? []), command.id]);
    }

    return [...byShortcut.entries()]
      .filter(([, commandIds]) => commandIds.length > 1)
      .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
  }
}
