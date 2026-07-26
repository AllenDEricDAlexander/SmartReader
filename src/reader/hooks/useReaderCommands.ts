import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { CommandRegistry, defaultShortcuts, type CommandId } from '../../commands/commandRegistry';
import {
  handleShortcutEvent,
  preventRegisteredShortcutDefault,
} from '../../commands/shortcutController';
import type { DocumentSession } from '../../documents/documentModels';
import type { ViewerActions } from '../../viewer/viewerController';

type UseReaderCommandsInput = {
  activeSession: DocumentSession | null;
  activeViewerController: ViewerActions;
  addBookmarkForActivePage(): void | Promise<void>;
  addPageNote(): void | Promise<void>;
  closeActiveTab(): void;
  focusSearchInput(): void;
  openGlobalSearch(): void;
  openPdf(): void | Promise<void>;
  selectNextSession(): void;
  selectPreviousSession(): void;
  setPreferencesOpen(open: boolean): void;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  shortcutsEnabled?: boolean;
  shortcuts: Record<CommandId, string | null>;
  stepHistoryBack(): void;
  stepHistoryForward(): void;
};

export function useReaderCommands({
  activeSession,
  activeViewerController,
  addBookmarkForActivePage,
  addPageNote,
  closeActiveTab,
  focusSearchInput,
  openGlobalSearch,
  openPdf,
  selectNextSession,
  selectPreviousSession,
  setPreferencesOpen,
  setSidebarOpen,
  shortcutsEnabled = true,
  shortcuts,
  stepHistoryBack,
  stepHistoryForward,
}: UseReaderCommandsInput) {
  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'file.open',
      label: 'Open File',
      shortcut: shortcuts['file.open'],
      run: () => void openPdf(),
    });
    registry.register({
      id: 'tab.close',
      label: 'Close Tab',
      shortcut: shortcuts['tab.close'],
      run: closeActiveTab,
    });
    registry.register({
      id: 'find.open',
      label: 'Find',
      shortcut: shortcuts['find.open'],
      run: () => {
        activeViewerController.openSearch();
        focusSearchInput();
      },
    });
    registry.register({
      id: 'find.next',
      label: 'Find Next',
      shortcut: shortcuts['find.next'],
      run: () => activeViewerController.searchNext(),
    });
    registry.register({
      id: 'find.previous',
      label: 'Find Previous',
      shortcut: shortcuts['find.previous'],
      run: () => activeViewerController.searchPrevious(),
    });
    registry.register({
      id: 'global.search.open',
      label: 'Global Search',
      shortcut: shortcuts['global.search.open'],
      shortcutAliases:
        shortcuts['global.search.open'] === defaultShortcuts.globalSearch ? ['Control+K'] : [],
      run: openGlobalSearch,
    });
    registry.register({
      id: 'sidebar.toggle',
      label: 'Toggle Sidebar',
      shortcut: shortcuts['sidebar.toggle'],
      run: () => setSidebarOpen((open) => !open),
    });
    registry.register({
      id: 'zoom.in',
      label: 'Zoom In',
      shortcut: shortcuts['zoom.in'],
      run: () => activeViewerController.zoomIn(),
    });
    registry.register({
      id: 'zoom.out',
      label: 'Zoom Out',
      shortcut: shortcuts['zoom.out'],
      run: () => activeViewerController.zoomOut(),
    });
    registry.register({
      id: 'zoom.fitWidth',
      label: 'Fit Width',
      shortcut: shortcuts['zoom.fitWidth'],
      run: () => activeViewerController.fitWidth(),
    });
    registry.register({
      id: 'zoom.fitPage',
      label: 'Fit Page',
      shortcut: shortcuts['zoom.fitPage'],
      run: () => activeViewerController.fitPage(),
    });
    registry.register({
      id: 'history.back',
      label: 'History Back',
      shortcut: shortcuts['history.back'],
      run: stepHistoryBack,
    });
    registry.register({
      id: 'history.forward',
      label: 'History Forward',
      shortcut: shortcuts['history.forward'],
      run: stepHistoryForward,
    });
    registry.register({
      id: 'tab.next',
      label: 'Next Tab',
      shortcut: shortcuts['tab.next'],
      run: selectNextSession,
    });
    registry.register({
      id: 'tab.previous',
      label: 'Previous Tab',
      shortcut: shortcuts['tab.previous'],
      run: selectPreviousSession,
    });
    registry.register({
      id: 'bookmark.add',
      label: 'Add Bookmark',
      shortcut: shortcuts['bookmark.add'],
      run: () => void addBookmarkForActivePage(),
    });
    registry.register({
      id: 'annotation.note',
      label: 'Add Note',
      shortcut: shortcuts['annotation.note'],
      run: () => void addPageNote(),
    });
    registry.register({
      id: 'preferences.open',
      label: 'Preferences',
      shortcut: shortcuts['preferences.open'],
      run: () => setPreferencesOpen(true),
    });
    return registry;
  }, [
    activeViewerController,
    addBookmarkForActivePage,
    addPageNote,
    closeActiveTab,
    openGlobalSearch,
    openPdf,
    selectNextSession,
    selectPreviousSession,
    setPreferencesOpen,
    setSidebarOpen,
    shortcuts,
    stepHistoryBack,
    stepHistoryForward,
  ]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!shortcutsEnabled) {
        preventRegisteredShortcutDefault(event, commandRegistry);
        return;
      }

      handleShortcutEvent(event, commandRegistry);
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [commandRegistry, shortcutsEnabled]);

  return { commandRegistry, hasActiveSession: Boolean(activeSession) };
}
