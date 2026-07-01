import { defaultShortcuts, type CommandId } from '../commands/commandRegistry';
import type { PartialReaderPreferences, ReaderPreferences } from './preferencesModels';

export const defaultReaderPreferences: ReaderPreferences = {
  sessionRestoreEnabled: true,
  restoreScope: 'all',
  defaultZoomMode: 'fit-width',
  shortcuts: {
    'file.open': defaultShortcuts.openFile,
    'tab.close': defaultShortcuts.closeTab,
    'find.open': defaultShortcuts.find,
    'find.next': defaultShortcuts.findNext,
    'find.previous': defaultShortcuts.findPrevious,
    'global.search.open': defaultShortcuts.globalSearch,
    'sidebar.toggle': defaultShortcuts.toggleSidebar,
    'zoom.in': defaultShortcuts.zoomIn,
    'zoom.out': defaultShortcuts.zoomOut,
    'zoom.fitWidth': defaultShortcuts.fitWidth,
    'zoom.fitPage': defaultShortcuts.fitPage,
    'page.focus': defaultShortcuts.focusPage,
    'history.back': defaultShortcuts.historyBack,
    'history.forward': defaultShortcuts.historyForward,
    'tab.next': defaultShortcuts.nextTab,
    'tab.previous': defaultShortcuts.previousTab,
    'bookmark.add': defaultShortcuts.addBookmark,
    'annotation.note': defaultShortcuts.addNote,
    'preferences.open': defaultShortcuts.openPreferences,
    'annotation.export': defaultShortcuts.exportAnnotations,
    'annotation.import': defaultShortcuts.importAnnotations,
  } satisfies Record<CommandId, string | null>,
};

export function mergeReaderPreferences(
  stored: PartialReaderPreferences | null | undefined,
): ReaderPreferences {
  return {
    ...defaultReaderPreferences,
    ...(stored ?? {}),
    shortcuts: {
      ...defaultReaderPreferences.shortcuts,
      ...(stored?.shortcuts ?? {}),
    },
  };
}
