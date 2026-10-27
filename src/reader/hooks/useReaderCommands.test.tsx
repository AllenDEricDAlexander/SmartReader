import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultReaderPreferences } from '../../preferences/preferencesStore';
import { ViewerController } from '../../viewer/viewerController';
import { useReaderCommands } from './useReaderCommands';

describe('reader tab shortcuts', () => {
  it('runs the default reverse-tab shortcut and respects an overridden shortcut', () => {
    const previous = vi.fn();
    const props = {
      activeSession: null, activeViewerController: new ViewerController(),
      addBookmarkForActivePage: vi.fn(), addPageNote: vi.fn(), closeActiveTab: vi.fn(),
      focusSearchInput: vi.fn(), openGlobalSearch: vi.fn(), openPdf: vi.fn(),
      selectNextSession: vi.fn(), selectPreviousSession: previous, setPreferencesOpen: vi.fn(),
      setSidebarOpen: vi.fn(), shortcuts: defaultReaderPreferences.shortcuts,
      stepHistoryBack: vi.fn(), stepHistoryForward: vi.fn(),
    };
    const { rerender } = renderHook((input) => useReaderCommands(input), { initialProps: props });
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(previous).toHaveBeenCalledOnce();
    rerender({ ...props, shortcuts: { ...props.shortcuts, 'tab.previous': 'Meta+P' } });
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(previous).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(previous).toHaveBeenCalledTimes(2);
  });
});
