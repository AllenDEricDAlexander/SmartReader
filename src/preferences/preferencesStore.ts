import { defaultShortcuts, type CommandId } from '../commands/commandRegistry';
import type { PartialReaderPreferences, ReaderPreferences } from './preferencesModels';

export const defaultReaderPreferences: ReaderPreferences = {
  theme: 'light',
  homeWelcomeEnabled: true,
  homeQuickTipsEnabled: true,
  homeDesktopIntegrationEnabled: true,
  homeZoom: 1.25,
  homeRecentViewMode: 'list',
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
    theme: stored?.theme === 'light' || stored?.theme === 'dark' || stored?.theme === 'eye-care'
      ? stored.theme
      : defaultReaderPreferences.theme,
    homeWelcomeEnabled: typeof stored?.homeWelcomeEnabled === 'boolean'
      ? stored.homeWelcomeEnabled
      : defaultReaderPreferences.homeWelcomeEnabled,
    homeQuickTipsEnabled: typeof stored?.homeQuickTipsEnabled === 'boolean'
      ? stored.homeQuickTipsEnabled
      : defaultReaderPreferences.homeQuickTipsEnabled,
    homeDesktopIntegrationEnabled: typeof stored?.homeDesktopIntegrationEnabled === 'boolean'
      ? stored.homeDesktopIntegrationEnabled
      : defaultReaderPreferences.homeDesktopIntegrationEnabled,
    homeZoom: typeof stored?.homeZoom === 'number' && Number.isFinite(stored.homeZoom)
      && stored.homeZoom >= 0.5 && stored.homeZoom <= 2
      ? stored.homeZoom
      : defaultReaderPreferences.homeZoom,
    homeRecentViewMode: stored?.homeRecentViewMode === 'list' || stored?.homeRecentViewMode === 'cards'
      ? stored.homeRecentViewMode
      : defaultReaderPreferences.homeRecentViewMode,
    shortcuts: {
      ...defaultReaderPreferences.shortcuts,
      ...(stored?.shortcuts ?? {}),
    },
  };
}
