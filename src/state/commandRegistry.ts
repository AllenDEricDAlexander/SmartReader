import type { DocumentSession } from "../types/reader";

export type CommandId =
  | "file.open"
  | "file.closeTab"
  | "file.newTab"
  | "view.toggleSidebar"
  | "find.open"
  | "find.next"
  | "find.previous"
  | "zoom.in"
  | "zoom.out"
  | "zoom.reset"
  | "bookmark.toggle"
  | "app.preferences"
  | "location.focus"
  | "history.back"
  | "history.forward";

export interface ReaderCommand {
  id: CommandId;
  label: string;
  shortcut?: string;
  enabled: boolean;
  run: () => void;
}

export interface CommandActions {
  openFile: () => void;
  closeTab: () => void;
  createEmptyTab: () => void;
  toggleSidebar: () => void;
  openFind: () => void;
  findNext: () => void;
  findPrevious: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleBookmark: () => void;
  openPreferences: () => void;
  focusLocationInput: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
}

export interface CommandRegistry {
  commands: ReaderCommand[];
  getCommand: (id: CommandId) => ReaderCommand | undefined;
  runCommand: (id: CommandId) => boolean;
  runShortcut: (shortcut: string) => boolean;
}

export function createCommandRegistry(input: {
  getActiveSession: () => DocumentSession | undefined;
  actions: CommandActions;
}): CommandRegistry {
  const activeSession = input.getActiveSession();
  const hasDocument = activeSession?.status === "ready";
  const hasTab = Boolean(activeSession);

  const commands: ReaderCommand[] = [
    command("file.open", "Open File", "Meta+O", true, input.actions.openFile),
    command("file.closeTab", "Close Tab", "Meta+W", hasTab, input.actions.closeTab),
    command("file.newTab", "New Tab", "Meta+T", true, input.actions.createEmptyTab),
    command("view.toggleSidebar", "Toggle Sidebar", "Meta+B", true, input.actions.toggleSidebar),
    command("find.open", "Find", "Meta+F", hasDocument, input.actions.openFind),
    command("find.next", "Find Next", "Meta+G", hasDocument, input.actions.findNext),
    command("find.previous", "Find Previous", "Meta+Shift+G", hasDocument, input.actions.findPrevious),
    command("zoom.in", "Zoom In", "Meta+=", hasDocument, input.actions.zoomIn),
    command("zoom.out", "Zoom Out", "Meta+-", hasDocument, input.actions.zoomOut),
    command("zoom.reset", "Actual Size", "Meta+0", hasDocument, input.actions.resetZoom),
    command("bookmark.toggle", "Toggle Bookmark", "Meta+D", hasDocument, input.actions.toggleBookmark),
    command("app.preferences", "Preferences", "Meta+,", true, input.actions.openPreferences),
    command("location.focus", "Focus Location", "Meta+L", hasDocument, input.actions.focusLocationInput),
    command("history.back", "Back", "Meta+ArrowLeft", hasDocument, input.actions.navigateBack),
    command("history.forward", "Forward", "Meta+ArrowRight", hasDocument, input.actions.navigateForward)
  ];

  return {
    commands,
    getCommand: (id) => commands.find((item) => item.id === id),
    runCommand: (id) => runCommand(commands.find((item) => item.id === id)),
    runShortcut: (shortcut) => runCommand(commands.find((item) => commandMatchesShortcut(item, shortcut)))
  };
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = [];

  if (event.metaKey) {
    parts.push("Meta");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);

  return parts.join("+");
}

function command(
  id: CommandId,
  label: string,
  shortcut: string,
  enabled: boolean,
  run: () => void
): ReaderCommand {
  return { id, label, shortcut, enabled, run };
}

function runCommand(commandToRun: ReaderCommand | undefined): boolean {
  if (!commandToRun?.enabled) {
    return false;
  }

  commandToRun.run();
  return true;
}

function commandMatchesShortcut(commandToRun: ReaderCommand, shortcut: string): boolean {
  if (commandToRun.shortcut === shortcut) {
    return true;
  }

  if (commandToRun.id === "zoom.in") {
    return shortcut === "Meta++" || shortcut === "Meta+=";
  }

  return false;
}
