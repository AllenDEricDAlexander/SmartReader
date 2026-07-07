import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocumentState } from '../documents/documentSessionStore';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { CommandRegistry } from '../commands/commandRegistry';
import { ViewerController } from '../viewer/viewerController';
import { ReaderWorkspaceSwitch } from './ReaderWorkspaceSwitch';

function renderSwitch(overrides: Partial<Parameters<typeof ReaderWorkspaceSwitch>[0]> = {}) {
  const preferences: ReaderPreferences = defaultReaderPreferences;
  const props: Parameters<typeof ReaderWorkspaceSwitch>[0] = {
    activeAnnotations: [],
    activeBookmarks: [],
    activeSession: null,
    activeSessionIsFavorite: false,
    activeSidebarPage: 'home',
    activeViewerController: new ViewerController(),
    activeWorkspace: 'home',
    appVersion: { version: '0.1.0', build: null },
    availableTags: [],
    cacheStats: { usedBytes: 0, totalBytes: 5 * 1024 ** 3, fileCount: 0 },
    commandRegistry: new CommandRegistry(),
    documents: createEmptyDocumentState(),
    favoriteDocuments: [],
    globalSearchAnnotationError: null,
    globalSearchAnnotations: [],
    globalSearchBookmarkError: null,
    globalSearchBookmarks: [],
    lastSearchCommand: '',
    pageInput: '',
    persistence: {} as Parameters<typeof ReaderWorkspaceSwitch>[0]['persistence'],
    readerPreferences: preferences,
    recentDocuments: [],
    searchText: '',
    selectedAnnotation: null,
    sessionRestoreCount: 0,
    settingsInitialSection: 'shortcuts',
    settingsSaving: false,
    sidebarOpen: true,
    viewerContent: <div>Viewer content</div>,
    addBookmarkForActivePage: vi.fn(),
    addPageNote: vi.fn(),
    canOpenNativePdf: () => true,
    canOpenRecordPage: () => true,
    clearSearch: vi.fn(),
    closeActiveTab: vi.fn(),
    closeToolWorkspace: vi.fn(),
    deleteAnnotationForDocument: vi.fn(),
    handleBrowserFileChange: vi.fn(),
    handleImportBrowserFileChange: vi.fn(),
    handleDrop: vi.fn(),
    handleSaveAnnotationNote: vi.fn(),
    handleSavePreferences: vi.fn(),
    handleToggleActiveFavorite: vi.fn(),
    handleToggleAnnotationTag: vi.fn(),
    handleToggleFavorite: vi.fn(),
    handleViewerWheel: vi.fn(),
    importAnnotationsForDocument: vi.fn(),
    jumpToActiveDocumentPage: vi.fn(),
    jumpToPage: vi.fn(),
    onTagsChange: vi.fn(),
    openCompareDocument: vi.fn(),
    openFavoriteDocument: vi.fn(),
    openGlobalSearch: vi.fn(),
    openHomeSidebarPage: vi.fn(),
    openImportPdf: vi.fn(),
    openPdf: vi.fn(),
    openPdfAndIgnoreResult: vi.fn(),
    openRecordPage: vi.fn(),
    openSettingsWorkspace: vi.fn(),
    openShortcutWorkspace: vi.fn(),
    reopenRecentDocument: vi.fn(),
    runSearch: vi.fn(),
    selectReaderSession: vi.fn(),
    setPageInput: vi.fn(),
    setSearchText: vi.fn(),
    setSelectedAnnotationId: vi.fn(),
    setSidebarOpen: vi.fn(),
    setWorkspaceOverride: vi.fn(),
    stepHistoryBack: vi.fn(),
    stepHistoryForward: vi.fn(),
    ...overrides,
  };

  render(<ReaderWorkspaceSwitch {...props} />);
}

describe('ReaderWorkspaceSwitch', () => {
  it('renders the home dashboard branch', () => {
    renderSwitch();

    expect(screen.getByRole('button', { name: '打开文件' })).toBeInTheDocument();
    expect(screen.getByText('0 B / 5 GB')).toBeInTheDocument();
  });
  it('passes available tags to the favorite files workspace', () => {
    renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'favoriteFiles',
      favoriteDocuments: [
        {
          documentKey: 'desktop:/Users/mario/Papers/Favorite.pdf',
          displayName: 'Favorite.pdf',
          path: '/Users/mario/Papers/Favorite.pdf',
          lastPage: 4,
          progress: 0.4,
          pageCount: 10,
          missing: false,
          lastOpenedAt: '2026-07-06T10:00:00+08:00',
          tagIds: [1],
        },
      ],
      availableTags: [
        {
          id: 1,
          name: 'Transformer',
          color: '#2563eb',
          documentCount: 1,
          annotationCount: 0,
          createdAt: '2026-07-01T00:00:00+08:00',
          updatedAt: '2026-07-01T00:00:00+08:00',
        },
      ],
    });

    expect(screen.getByRole('button', { name: '按标签筛选 Transformer' })).toBeInTheDocument();
  });

});
