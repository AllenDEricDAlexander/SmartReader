import {
  useCallback,
  useRef,
  useState,
  type ChangeEventHandler,
  type DragEventHandler,
  type SetStateAction,
  type ReactNode,
} from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { BookmarkDashboard, PersistedDocument } from '../persistence/persistenceApi';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import type { Tag } from '../tags/tagModels';
import { TagManager } from '../tags/TagManager';
import { HomeActionNotice } from './HomeActionNotice';
import { HomeBlankPage, isHomeBlankPageId } from './HomeBlankPage';
import { HomeAssistPanel } from './HomeAssistPanel';
import { HomeBookmarksWorkspace } from './HomeBookmarksWorkspace';
import type {
  BookmarkDeleteResult,
  BookmarkManagementRecord,
  BookmarkUpdateInput,
} from './bookmarkManagementUtils';
import { HomeFavoriteFilesWorkspace } from './HomeFavoriteFilesWorkspace';
import { HomeFavorites } from './HomeFavorites';
import { HomeQuickStart } from './HomeQuickStart';
import { HomeRecentFiles } from './HomeRecentFiles';
import { HomeRecentFilesWorkspace } from './HomeRecentFilesWorkspace';
import { HomeSidebar, type HomeSidebarPage, type HomeSidebarProps } from './HomeSidebar';
import { HomeStatusBar } from './HomeStatusBar';
import { HomeTopBar } from './HomeTopBar';
import { HomeWelcomeBanner } from './HomeWelcomeBanner';
import type { HomeAppVersion, HomeTaskStatus } from './homeTypes';

const noop = () => undefined;

type HomeNoticeState = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm?(): void;
};

type HomeDashboardProps = {
  themeSwitcher?: ReactNode;
  workspaceContent?: ReactNode;
  preferences?: ReaderPreferences;
  preferencesReady?: boolean;
  preferencesDisabled?: boolean;
  onSavePreferences?(preferences: ReaderPreferences): void | Promise<void>;
  onImportFolder?(): void | Promise<void>;
  onOpenAi?(): void;
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  bookmarkDashboard?: BookmarkDashboard | null;
  bookmarkDashboardLoading?: boolean;
  bookmarkDashboardError?: string | null;
  availableTags?: Tag[];
  activeSidebarPage?: HomeSidebarPage;
  counts?: HomeSidebarProps['counts'];
  cacheStats?: HomeSidebarProps['cacheStats'];
  appVersion?: HomeAppVersion;
  taskStatus?: HomeTaskStatus;
  tagPersistence: Parameters<typeof TagManager>[0]['persistence'];
  onTagsChange(update: SetStateAction<Tag[]>): void;
  onOpenTagDocument(
    documentKey: string,
    documentPath: string | null,
    page: number,
    documentMissing: boolean,
  ): void | Promise<void>;
  onOpenPdf(): void | Promise<unknown>;
  onDropPdf: DragEventHandler<HTMLElement>;
  onDropPaths?(paths: string[]): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
  onOpenFavoriteDocument?(document: FavoriteDocument): boolean | void | Promise<boolean | void>;
  canOpenBookmark?(bookmark: BookmarkManagementRecord): boolean;
  onOpenBookmark?(bookmark: BookmarkManagementRecord): void | Promise<void>;
  onUpdateBookmark?(
    bookmark: BookmarkManagementRecord,
    updates: BookmarkUpdateInput,
  ): Promise<void>;
  onDeleteBookmarks?(
    bookmarks: BookmarkManagementRecord[],
  ): Promise<BookmarkDeleteResult>;
  onRefreshBookmarks?(): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onToggleDocumentTag(document: PersistedDocument, tag: Tag, selected: boolean): void | Promise<void>;
  onRemoveRecentDocuments(documents: PersistedDocument[]): void | Promise<void>;
  onClearRecentDocuments(): void | Promise<void>;
  canOpenNativePdf?(): boolean;
  onOpenGlobalSearch?(): void;
  onOpenImport?(): void;
  onOpenCompare?(): void;
  onOpenAnnotations?(): void;
  onOpenBookmarks?(): void;
  onOpenHome?(): void;
  onOpenRecentFiles?(): void;
  onOpenFavoriteFiles?(): void;
  onOpenSessionRestore?(): void;
  onOpenMyDocuments?(): void;
  onOpenFolders?(): void;
  onOpenNotes?(): void;
  onOpenFullTextSearch?(): void;
  onOpenCacheManagement?(): void;
  onOpenShortcutSettings?(): void;
  onSetupFileAssociation?(): void | Promise<void>;
  onCheckUpdates?(): void | Promise<void>;
  onOpenSettings(): void;
  onOpenTags(): void;
};

export function HomeDashboard({
  themeSwitcher,
  workspaceContent,
  preferences = defaultReaderPreferences,
  preferencesReady = true,
  preferencesDisabled = false,
  onSavePreferences = noop,
  onImportFolder,
  onOpenAi,
  recentDocuments,
  favoriteDocuments,
  bookmarkDashboard = null,
  bookmarkDashboardLoading = false,
  bookmarkDashboardError = null,
  availableTags = [],
  activeSidebarPage = 'home',
  counts = {
    recentFiles: recentDocuments.length,
    favoriteFiles: favoriteDocuments.length,
    restorableSessions: recentDocuments.length,
  },
  cacheStats = {
    usedBytes: 0,
    totalBytes: 0,
    fileCount: 0,
  },
  appVersion = { version: '0.1.0', build: null },
  taskStatus = 'idle',
  tagPersistence,
  onTagsChange,
  onOpenTagDocument,
  onOpenPdf,
  onDropPdf,
  onDropPaths,
  onBrowserFileChange,
  onReopenRecentDocument,
  onOpenFavoriteDocument,
  canOpenBookmark = () => true,
  onOpenBookmark = noop,
  onUpdateBookmark = async () => undefined,
  onDeleteBookmarks = async () => ({ succeededIds: [], failedIds: [] }),
  onRefreshBookmarks = noop,
  onToggleFavorite,
  onToggleDocumentTag,
  onRemoveRecentDocuments,
  onClearRecentDocuments,
  canOpenNativePdf = () => true,
  onOpenGlobalSearch = noop,
  onOpenImport = noop,
  onOpenCompare = noop,
  onOpenAnnotations = noop,
  onOpenBookmarks = noop,
  onOpenHome = noop,
  onOpenRecentFiles = noop,
  onOpenFavoriteFiles = noop,
  onOpenSessionRestore = noop,
  onOpenMyDocuments = noop,
  onOpenFolders = noop,
  onOpenNotes = noop,
  onOpenFullTextSearch = noop,
  onOpenCacheManagement = noop,
  onOpenShortcutSettings,
  onSetupFileAssociation,
  onCheckUpdates,
  onOpenSettings,
  onOpenTags,
}: HomeDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<HomeNoticeState | null>(null);
  const homePreferencesDisabled = !preferencesReady || preferencesDisabled;
  const favoriteDocumentKeys = new Set(favoriteDocuments.map((document) => document.documentKey));
  const openShortcutSettings = onOpenShortcutSettings ?? onOpenSettings;

  const openBrowserFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPdf = useCallback(() => {
    if (!canOpenNativePdf()) {
      openBrowserFilePicker();
      return;
    }

    try {
      void Promise.resolve(onOpenPdf()).catch(openBrowserFilePicker);
    } catch {
      openBrowserFilePicker();
    }
  }, [canOpenNativePdf, onOpenPdf, openBrowserFilePicker]);

  const showClearRecordNotice = useCallback(() => {
    setNotice({
      title: '清除记录',
      message: '确认清空所有最近阅读记录？此操作不会删除 PDF 文件、收藏或批注。',
      confirmLabel: '清空记录',
      onConfirm: () => {
        setNotice(null);
        void Promise.resolve().then(onClearRecentDocuments).catch(() => {
          setNotice({ title: '清除记录失败', message: '无法清空最近阅读记录，请重试。' });
        });
      },
    });
  }, [onClearRecentDocuments]);

  const showNotice = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

  const updateHomePreferences = async (updates: Partial<ReaderPreferences>) => {
    if (homePreferencesDisabled) return;

    try {
      await onSavePreferences({ ...preferences, ...updates });
    } catch {
      showNotice('设置保存失败', '首页显示设置未能保存，请重试。');
    }
  };

  const handleOpenFavoriteDocument = useCallback(
    async (document: FavoriteDocument) => {
      if (!onOpenFavoriteDocument) {
        showNotice('无法打开收藏文件', '该收藏文件暂无可打开的本地路径。');
        return;
      }

      try {
        const opened = await onOpenFavoriteDocument(document);

        if (opened === false) {
          showNotice('无法打开收藏文件', '该收藏文件暂无可打开的本地路径。');
        }
      } catch {
        showNotice('无法打开收藏文件', '该收藏文件暂无可打开的本地路径。');
      }
    },
    [onOpenFavoriteDocument, showNotice],
  );

  const handleSetupFileAssociation = useCallback(() => {
    if (onSetupFileAssociation) {
      void onSetupFileAssociation();
      return;
    }

    showNotice(
      '文件关联不可用',
      '当前环境不支持自动设置文件关联，请在系统设置中关联 PDF。',
    );
  }, [onSetupFileAssociation, showNotice]);

  const blockHomeDrop: DragEventHandler<HTMLElement> = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const homeContent = (
    <div className="home-content home-overview-content" onDragOver={blockHomeDrop} onDrop={blockHomeDrop}>
      <div className="home-primary">
        {preferencesReady && preferences.homeWelcomeEnabled ? (
          <HomeWelcomeBanner
            disabled={homePreferencesDisabled}
            onClose={() => void updateHomePreferences({ homeWelcomeEnabled: false })}
          />
        ) : null}
        <HomeQuickStart
          onOpenPdf={handleOpenPdf}
          onDropPdf={onDropPdf}
          onDropPaths={onDropPaths}
          onRejectDrop={(message) => showNotice('无法打开文件', message)}
          onOpenFolder={onImportFolder ? () => void onImportFolder() : onOpenFolders}
        />
        <HomeRecentFiles
          documents={recentDocuments}
          viewMode={preferences.homeRecentViewMode}
          viewModeDisabled={homePreferencesDisabled}
          onViewModeChange={(homeRecentViewMode) => void updateHomePreferences({ homeRecentViewMode })}
          favoriteDocumentKeys={favoriteDocumentKeys}
          onOpenAll={onOpenRecentFiles}
          onClearRecords={showClearRecordNotice}
          onReopenDocument={onReopenRecentDocument}
          onToggleFavorite={onToggleFavorite}
          onLocateFile={() =>
            showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
          }
          onRemoveRecent={async (document) => {
            try {
              await onRemoveRecentDocuments([document]);
            } catch {
              showNotice('移除记录失败', '无法移除这条最近阅读记录，请重试。');
            }
          }}
        />
        <HomeFavorites
          documents={favoriteDocuments}
          onOpenAll={onOpenFavoriteFiles}
          onOpenDocument={handleOpenFavoriteDocument}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
      <HomeAssistPanel
        appVersion={appVersion}
        quickTipsEnabled={preferencesReady && preferences.homeQuickTipsEnabled}
        desktopIntegrationEnabled={preferencesReady && preferences.homeDesktopIntegrationEnabled}
        disabled={homePreferencesDisabled}
        onCloseQuickTips={() => void updateHomePreferences({ homeQuickTipsEnabled: false })}
        onCloseDesktopIntegration={() => void updateHomePreferences({ homeDesktopIntegrationEnabled: false })}
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenBookmarks={onOpenBookmarks}
        onOpenAnnotations={onOpenAnnotations}
        onOpenShortcutSettings={openShortcutSettings}
        onOpenCacheManagement={onOpenCacheManagement}
        onSetupFileAssociation={handleSetupFileAssociation}
      />
    </div>
  );

  const recentFilesContent = (
    <div className="home-content home-blank-content">
      <HomeRecentFilesWorkspace
        documents={recentDocuments}
        favoriteDocumentKeys={favoriteDocumentKeys}
        tags={availableTags}
        onOpenPdf={handleOpenPdf}
        onReopenDocument={onReopenRecentDocument}
        onToggleFavorite={onToggleFavorite}
        onToggleDocumentTag={onToggleDocumentTag}
        onLocateFile={() =>
          showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
        }
        onRemoveRecentDocuments={onRemoveRecentDocuments}
        onClearRecentDocuments={onClearRecentDocuments}
        onOpenTags={onOpenTags}
      />
    </div>
  );

  const favoriteFilesContent = (
    <div className="home-content home-blank-content">
      <HomeFavoriteFilesWorkspace
        documents={favoriteDocuments}
        tags={availableTags}
        onOpenPdf={handleOpenPdf}
        onOpenDocument={handleOpenFavoriteDocument}
        onToggleFavorite={onToggleFavorite}
        onLocateFile={() =>
          showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
        }
        onOpenTags={onOpenTags}
      />
    </div>
  );

  const bookmarksContent = (
    <div className="home-content bookmark-management-home-content">
      <HomeBookmarksWorkspace
        dashboard={bookmarkDashboard}
        loading={bookmarkDashboardLoading}
        error={bookmarkDashboardError}
        canOpenBookmark={canOpenBookmark}
        onOpenPdf={handleOpenPdf}
        onOpenBookmark={onOpenBookmark}
        onUpdateBookmark={onUpdateBookmark}
        onDeleteBookmarks={onDeleteBookmarks}
        onRefresh={onRefreshBookmarks}
      />
    </div>
  );

  const tagsContent = (
    <div className="home-content home-tags-content">
      <TagManager
        persistence={tagPersistence}
        onTagsChange={onTagsChange}
        onOpenDocument={onOpenTagDocument}
      />
    </div>
  );

  const mainContent =
    workspaceContent ? <div className="home-content home-research-content">{workspaceContent}</div> : activeSidebarPage === 'recentFiles' ? (
      recentFilesContent
    ) : activeSidebarPage === 'favoriteFiles' ? (
      favoriteFilesContent
    ) : activeSidebarPage === 'bookmarks' ? (
      bookmarksContent
    ) : activeSidebarPage === 'tags' ? (
      tagsContent
    ) : isHomeBlankPageId(activeSidebarPage) ? (
      <div className="home-content home-blank-content">
        <HomeBlankPage page={activeSidebarPage} />
      </div>
    ) : (
      homeContent
    );

  return (
    <div className="home-dashboard-shell">
      <HomeTopBar
        themeSwitcher={themeSwitcher}
        onOpenPdf={handleOpenPdf}
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenImport={onOpenImport}
        onOpenCompare={onOpenCompare}
        onOpenAnnotations={onOpenAnnotations}
        onOpenBookmarks={onOpenBookmarks}
        onOpenSettings={onOpenSettings}
      />
      <input
        ref={fileInputRef}
        className="file-picker-input"
        aria-label="选择 PDF 文件"
        type="file"
        accept="application/pdf,.pdf"
        tabIndex={-1}
        onChange={onBrowserFileChange}
      />
      <section className="home-dashboard" aria-label="SmartReader 首页内容">
        <HomeSidebar
          activePage={activeSidebarPage}
          counts={counts}
          cacheStats={cacheStats}
          onOpenHome={onOpenHome}
          onOpenRecentFiles={onOpenRecentFiles}
          onOpenFavoriteFiles={onOpenFavoriteFiles}
          onOpenSessionRestore={onOpenSessionRestore}
          onOpenMyDocuments={onOpenMyDocuments}
          onOpenFolders={onOpenFolders}
          onOpenTags={onOpenTags}
          onOpenNotes={onOpenNotes}
          onOpenFullTextSearch={onOpenFullTextSearch}
          onOpenAnnotations={onOpenAnnotations}
          onOpenBookmarks={onOpenBookmarks}
          onOpenCompare={onOpenCompare}
          onOpenAi={onOpenAi}
          onOpenCacheManagement={onOpenCacheManagement}
        />
        <div className="home-main" style={{ zoom: preferences.homeZoom }}>{mainContent}</div>
      </section>
      <HomeStatusBar
        scale={preferences.homeZoom}
        disabled={homePreferencesDisabled}
        taskStatus={taskStatus}
        onScaleChange={(homeZoom) => void updateHomePreferences({ homeZoom })}
        onCheckUpdates={onCheckUpdates}
      />
      {notice ? (
        <HomeActionNotice
          key={notice.title}
          title={notice.title}
          message={notice.message}
          confirmLabel={notice.confirmLabel}
          onConfirm={notice.onConfirm}
          onClose={() => setNotice(null)}
        />
      ) : null}
    </div>
  );
}
