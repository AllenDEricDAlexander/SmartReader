import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocumentState } from '../documents/documentSessionStore';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { CommandRegistry } from '../commands/commandRegistry';
import { ViewerController } from '../viewer/viewerController';
import { ReaderWorkspaceSwitch } from './ReaderWorkspaceSwitch';
import { defaultSearchOptions, emptySearchState } from '../viewer/viewerTypes';

type ReaderWorkspaceSwitchTestProps = Omit<
  Parameters<typeof ReaderWorkspaceSwitch>[0],
  'closeActiveTab' | 'openPdfAndIgnoreResult'
>;

const ReaderWorkspaceSwitchUnderTest =
  ReaderWorkspaceSwitch as unknown as ComponentType<ReaderWorkspaceSwitchTestProps>;

const emptyTagDashboard = {
  overview: { totalTags: 0, activeTags: 0, totalUsage: 0, orphanTags: 0 },
  tags: [],
  details: [],
  recommendations: [],
};

const emptyBookmarkDashboard = {
  totalBookmarks: 0,
  groups: [],
};

function createTagPersistence() {
  return {
    loadTagDashboard: vi.fn().mockResolvedValue(emptyTagDashboard),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  } as unknown as Parameters<typeof ReaderWorkspaceSwitch>[0]['persistence'];
}

function renderSwitch(overrides: Partial<ReaderWorkspaceSwitchTestProps> = {}) {
  const preferences: ReaderPreferences = defaultReaderPreferences;
  const props: ReaderWorkspaceSwitchTestProps = {
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
    bookmarkDashboard: emptyBookmarkDashboard,
    bookmarkDashboardError: null,
    bookmarkDashboardLoading: false,
    lastSearchCommand: '',
    pageInput: '',
    persistence: createTagPersistence(),
    readerPreferences: preferences,
    recentDocuments: [],
    searchState: emptySearchState,
    searchOptions: defaultSearchOptions,
    documentInfo: null,
    searchInputRef: { current: null },
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
    jumpToSearchMatch: vi.fn(),
    setSearchOptions: vi.fn(),
    closeToolWorkspace: vi.fn(),
    deleteBookmark: vi.fn(),
    deleteManagedBookmarks: vi.fn().mockResolvedValue({
      succeededIds: [],
      failedIds: [],
    }),
    deleteAnnotationForDocument: vi.fn(),
    handleBrowserFileChange: vi.fn(),
    handleImportBrowserFileChange: vi.fn(),
    handleDrop: vi.fn(),
    handleSaveAnnotationNote: vi.fn(),
    handleSavePreferences: vi.fn(),
    handleToggleActiveFavorite: vi.fn(),
    handleToggleAnnotationTag: vi.fn(),
    handleToggleDocumentTag: vi.fn(),
    handleToggleFavorite: vi.fn(),
    handleRemoveRecentDocuments: vi.fn(),
    handleClearRecentDocuments: vi.fn(),
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
    openRecordPage: vi.fn(),
    openSettingsWorkspace: vi.fn(),
    openShortcutWorkspace: vi.fn(),
    renameBookmark: vi.fn(),
    refreshBookmarkDashboard: vi.fn(),
    reopenRecentDocument: vi.fn(),
    runSearch: vi.fn(),
    setPageInput: vi.fn(),
    setSearchText: vi.fn(),
    setSelectedAnnotationId: vi.fn(),
    setSidebarOpen: vi.fn(),
    stepHistoryBack: vi.fn(),
    stepHistoryForward: vi.fn(),
    updateManagedBookmark: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return render(<ReaderWorkspaceSwitchUnderTest {...props} />);
}

describe('ReaderWorkspaceSwitch', () => {
  it('renders the home dashboard branch', () => {
    renderSwitch();

    expect(screen.getByRole('button', { name: '打开文件' })).toBeInTheDocument();
    expect(screen.getByText('0 B / 5 GB')).toBeInTheDocument();
  });

  it('renders tag management as a home sidebar page', async () => {
    renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'tags',
      persistence: createTagPersistence(),
    });

    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByLabelText('标签管理工作区')).toBeInTheDocument();
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

  it('passes available tags to the recent files workspace', () => {
    renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'recentFiles',
      recentDocuments: [
        {
          documentKey: 'desktop:/Users/mario/Papers/Recent.pdf',
          displayName: 'Recent.pdf',
          path: '/Users/mario/Papers/Recent.pdf',
          fileSize: 100,
          modifiedAt: '2026-07-06T10:00:00+08:00',
          pageCount: 10,
          lastPage: 4,
          progress: 0.4,
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

    expect(screen.getByRole('button', { name: 'Transformer' })).toBeInTheDocument();
  });

  it('uses the same bookmark dashboard in home and standalone routes', () => {
    const bookmarkDashboard = {
      totalBookmarks: 1,
      groups: [
        {
          document: {
            documentKey: 'desktop:/tmp/shared.pdf',
            displayName: 'shared.pdf',
            path: '/tmp/shared.pdf',
            missing: false,
            fileSize: 1024,
            pageCount: 10,
          },
          bookmarkCount: 1,
          bookmarks: [
            {
              id: 1,
              documentKey: 'desktop:/tmp/shared.pdf',
              page: 4,
              title: 'Shared bookmark',
              note: null,
              createdAt: '2026-07-20T00:00:00Z',
              updatedAt: '2026-07-20T00:00:00Z',
            },
          ],
        },
      ],
    };
    const { unmount } = renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'bookmarks',
      bookmarkDashboard,
    });
    expect(screen.getByText('Shared bookmark')).toBeInTheDocument();
    unmount();

    renderSwitch({
      activeWorkspace: 'bookmarks',
      bookmarkDashboard,
    });
    expect(screen.getByLabelText('书签管理工作区')).toBeInTheDocument();
    expect(screen.getByText('Shared bookmark')).toBeInTheDocument();
  });

  it('opens bookmark management and refreshes it without opening global search', () => {
    const openHomeSidebarPage = vi.fn();
    const openGlobalSearch = vi.fn();
    const refreshBookmarkDashboard = vi.fn();
    renderSwitch({
      openHomeSidebarPage,
      openGlobalSearch,
      refreshBookmarkDashboard,
    });

    fireEvent.click(screen.getByRole('button', { name: '书签管理' }));

    expect(openHomeSidebarPage).toHaveBeenCalledWith('bookmarks');
    expect(refreshBookmarkDashboard).toHaveBeenCalledTimes(1);
    expect(openGlobalSearch).not.toHaveBeenCalled();
  });

  it('routes settings close through closeToolWorkspace', () => {
    const closeToolWorkspace = vi.fn();

    renderSwitch({
      activeWorkspace: 'settings',
      closeToolWorkspace,
    });

    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));

    expect(closeToolWorkspace).toHaveBeenCalledTimes(1);
  });

});
