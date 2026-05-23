import { useEffect, useMemo } from "react";
import type { ShortcutBinding } from "../types/reader";

export type ReaderShortcutCommandId =
  | "reader.previousPage"
  | "reader.nextPage"
  | "reader.zoomIn"
  | "reader.zoomOut"
  | "reader.openFind"
  | "reader.toggleBookmark"
  | "reader.toggleSidebar";

export type ReaderShortcutHandlers = Partial<Record<ReaderShortcutCommandId, () => void>>;

export interface ReaderShortcutConflict {
  shortcut: string;
  commandIds: string[];
}

export interface UseReaderShortcutsInput {
  enabled?: boolean;
  bindings?: ShortcutBinding[];
  handlers: ReaderShortcutHandlers;
}

const defaultBindings: ShortcutBinding[] = [
  { commandId: "reader.previousPage", shortcut: "ArrowLeft" },
  { commandId: "reader.nextPage", shortcut: "ArrowRight" },
  { commandId: "reader.zoomIn", shortcut: "Meta+=" },
  { commandId: "reader.zoomOut", shortcut: "Meta+-" },
  { commandId: "reader.openFind", shortcut: "Meta+F" },
  { commandId: "reader.toggleBookmark", shortcut: "Meta+D" },
  { commandId: "reader.toggleSidebar", shortcut: "Meta+B" }
];

export function defaultReaderShortcutBindings(userBindings: ShortcutBinding[] = []): ShortcutBinding[] {
  const overrides = new Map(
    userBindings.map((binding) => [binding.commandId, normalizeShortcutText(binding.shortcut)])
  );

  return [
    ...defaultBindings.map((binding) => ({
      commandId: binding.commandId,
      shortcut: overrides.get(binding.commandId) ?? binding.shortcut
    })),
    ...userBindings
      .filter((binding) => !defaultBindings.some((item) => item.commandId === binding.commandId))
      .map((binding) => ({
        commandId: binding.commandId,
        shortcut: normalizeShortcutText(binding.shortcut)
      }))
  ];
}

export function findShortcutConflicts(bindings: ShortcutBinding[]): ReaderShortcutConflict[] {
  const byShortcut = new Map<string, string[]>();

  bindings.forEach((binding) => {
    const shortcut = normalizeShortcutText(binding.shortcut);
    const commandIds = byShortcut.get(shortcut) ?? [];
    commandIds.push(binding.commandId);
    byShortcut.set(shortcut, commandIds);
  });

  return Array.from(byShortcut.entries())
    .filter(([, commandIds]) => commandIds.length > 1)
    .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
}

export function useReaderShortcuts(input: UseReaderShortcutsInput): void {
  const bindings = useMemo(() => defaultReaderShortcutBindings(input.bindings), [input.bindings]);

  useEffect(() => {
    if (input.enabled === false) {
      return undefined;
    }

    const byShortcut = new Map(bindings.map((binding) => [binding.shortcut, binding.commandId]));

    function handleKeyDown(event: KeyboardEvent) {
      if (!shouldHandleReaderShortcut(event)) {
        return;
      }

      const commandId = byShortcut.get(normalizeShortcut(event)) as ReaderShortcutCommandId | undefined;
      const handler = commandId ? input.handlers[commandId] : undefined;

      if (!handler) {
        return;
      }

      event.preventDefault();
      handler();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bindings, input.enabled, input.handlers]);
}

export function shouldHandleReaderShortcut(event: KeyboardEvent, target = event.target): boolean {
  if (event.defaultPrevented) {
    return false;
  }

  return !isEditableShortcutTarget(target);
}

export function normalizeShortcut(event: KeyboardEvent): string {
  const parts: string[] = [];

  if (event.metaKey) {
    parts.push("Meta");
  }

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  parts.push(normalizeKey(event.key));

  return parts.join("+");
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest("[contenteditable='true']")) {
    return true;
  }

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function normalizeShortcutText(shortcut: string): string {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  const key = parts.pop();

  if (!key) {
    return "";
  }

  return [...parts.map(normalizeModifier), normalizeKey(key)].join("+");
}

function normalizeModifier(modifier: string): string {
  const lower = modifier.toLowerCase();

  if (lower === "cmd" || lower === "command" || lower === "meta") {
    return "Meta";
  }

  if (lower === "ctrl" || lower === "control") {
    return "Ctrl";
  }

  if (lower === "option" || lower === "alt") {
    return "Alt";
  }

  if (lower === "shift") {
    return "Shift";
  }

  return modifier;
}

function normalizeKey(key: string): string {
  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key;
}
