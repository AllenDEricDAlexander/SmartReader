import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { CommandRegistry, defaultShortcuts } from '../../commands/commandRegistry';
import { handleShortcutEvent } from '../../commands/shortcutController';
import type { DocumentSession, DocumentState } from '../../documents/documentModels';
import {
  selectNextSession,
  selectPreviousSession,
} from '../../documents/documentSessionStore';
import type { ViewerActions } from '../../viewer/viewerController';

type UseReaderCommandsInput = {
  activeSession: DocumentSession | null;
  activeViewerController: ViewerActions;
  addBookmarkForActivePage(): void | Promise<void>;
  addPageNote(): void | Promise<void>;
  closeActiveTab(): void;
  openPdf(): void | Promise<void>;
  setDocuments: Dispatch<SetStateAction<DocumentState>>;
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  stepHistoryBack(): void;
  stepHistoryForward(): void;
};

export function useReaderCommands({
  activeSession,
  activeViewerController,
  addBookmarkForActivePage,
  addPageNote,
  closeActiveTab,
  openPdf,
  setDocuments,
  setPreferencesOpen,
  setSidebarOpen,
  stepHistoryBack,
  stepHistoryForward,
}: UseReaderCommandsInput) {
  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'file.open',
      label: 'Open File',
      shortcut: defaultShortcuts.openFile,
      run: () => void openPdf(),
    });
    registry.register({
      id: 'tab.close',
      label: 'Close Tab',
      shortcut: defaultShortcuts.closeTab,
      run: closeActiveTab,
    });
    registry.register({
      id: 'find.open',
      label: 'Find',
      shortcut: defaultShortcuts.find,
      run: () => activeViewerController.openSearch(),
    });
    registry.register({
      id: 'find.next',
      label: 'Find Next',
      shortcut: defaultShortcuts.findNext,
      run: () => activeViewerController.searchNext(),
    });
    registry.register({
      id: 'find.previous',
      label: 'Find Previous',
      shortcut: defaultShortcuts.findPrevious,
      run: () => activeViewerController.searchPrevious(),
    });
    registry.register({
      id: 'sidebar.toggle',
      label: 'Toggle Sidebar',
      shortcut: defaultShortcuts.toggleSidebar,
      run: () => setSidebarOpen((open) => !open),
    });
    registry.register({
      id: 'zoom.in',
      label: 'Zoom In',
      shortcut: defaultShortcuts.zoomIn,
      run: () => activeViewerController.zoomIn(),
    });
    registry.register({
      id: 'zoom.out',
      label: 'Zoom Out',
      shortcut: defaultShortcuts.zoomOut,
      run: () => activeViewerController.zoomOut(),
    });
    registry.register({
      id: 'zoom.fitWidth',
      label: 'Fit Width',
      shortcut: defaultShortcuts.fitWidth,
      run: () => activeViewerController.fitWidth(),
    });
    registry.register({
      id: 'zoom.fitPage',
      label: 'Fit Page',
      shortcut: defaultShortcuts.fitPage,
      run: () => activeViewerController.fitPage(),
    });
    registry.register({
      id: 'history.back',
      label: 'History Back',
      shortcut: defaultShortcuts.historyBack,
      run: stepHistoryBack,
    });
    registry.register({
      id: 'history.forward',
      label: 'History Forward',
      shortcut: defaultShortcuts.historyForward,
      run: stepHistoryForward,
    });
    registry.register({
      id: 'tab.next',
      label: 'Next Tab',
      shortcut: defaultShortcuts.nextTab,
      run: () => setDocuments(selectNextSession),
    });
    registry.register({
      id: 'tab.previous',
      label: 'Previous Tab',
      shortcut: defaultShortcuts.previousTab,
      run: () => setDocuments(selectPreviousSession),
    });
    registry.register({
      id: 'bookmark.add',
      label: 'Add Bookmark',
      shortcut: defaultShortcuts.addBookmark,
      run: () => void addBookmarkForActivePage(),
    });
    registry.register({
      id: 'annotation.note',
      label: 'Add Note',
      shortcut: defaultShortcuts.addNote,
      run: () => void addPageNote(),
    });
    registry.register({
      id: 'preferences.open',
      label: 'Preferences',
      shortcut: defaultShortcuts.openPreferences,
      run: () => setPreferencesOpen(true),
    });
    return registry;
  }, [
    activeViewerController,
    addBookmarkForActivePage,
    addPageNote,
    closeActiveTab,
    openPdf,
    setDocuments,
    setPreferencesOpen,
    setSidebarOpen,
    stepHistoryBack,
    stepHistoryForward,
  ]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleShortcutEvent(event, commandRegistry);
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [commandRegistry]);

  return { commandRegistry, hasActiveSession: Boolean(activeSession) };
}
