import { useCallback, useRef, useState, type ChangeEventHandler, type DragEventHandler } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { PersistedBookmarkRecord, PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import { HomeActionNotice } from './HomeActionNotice';
import { HomeBlankPage, isHomeBlankPageId } from './HomeBlankPage';
import { HomeAssistPanel } from './HomeAssistPanel';
import { HomeBookmarksWorkspace } from './HomeBookmarksWorkspace';
import { HomeFavoriteFilesWorkspace } from './HomeFavoriteFilesWorkspace';
import { HomeFavorites } from './HomeFavorites';
import { HomeQuickStart } from './HomeQuickStart';
import { HomeRecentFiles } from './HomeRecentFiles';
import { HomeRecentFilesWorkspace } from './HomeRecentFilesWorkspace';
import { HomeRecentSessions } from './HomeRecentSessions';
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
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  bookmarks?: PersistedBookmarkRecord[];
  bookmarkError?: string | null;
  availableTags?: Tag[];
  activeSidebarPage?: HomeSidebarPage;
  counts?: HomeSidebarProps['counts'];
  cacheStats?: HomeSidebarProps['cacheStats'];
  appVersion?: HomeAppVersion;
  taskStatus?: HomeTaskStatus;
  onOpenPdf(): void | Promise<unknown>;
  onDropPdf: DragEventHandler<HTMLElement>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
  onOpenFavoriteDocument?(document: FavoriteDocument): boolean | void | Promise<boolean | void>;
  canOpenBookmark?(bookmark: PersistedBookmarkRecord): boolean;
  onOpenBookmark?(bookmark: PersistedBookmarkRecord): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
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
  recentDocuments,
  favoriteDocuments,
  bookmarks = [],
  bookmarkError = null,
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
  onOpenPdf,
  onDropPdf,
  onBrowserFileChange,
  onReopenRecentDocument,
  onOpenFavoriteDocument,
  canOpenBookmark = () => true,
  onOpenBookmark = noop,
  onToggleFavorite,
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
      message: '当前版本不会直接清空记录。确认后将展示功能待补充说明。',
      confirmLabel: '确认',
      onConfirm: () => {
        setNotice({
          title: '清除记录功能待补充',
          message: '清除记录将在会话恢复管理功能中补充。',
        });
      },
    });
  }, []);

  const showNotice = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

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

  const handleCheckUpdates = useCallback(() => {
    if (onCheckUpdates) {
      void onCheckUpdates();
      return;
    }

    showNotice('检查更新能力待接入', '当前版本暂未接入自动检查更新。');
  }, [onCheckUpdates, showNotice]);

  const handleOpenViewControls = useCallback(() => {
    showNotice('首页视图控制待接入', '当前版本暂未接入首页视图控制。');
  }, [showNotice]);

  const blockHomeDrop: DragEventHandler<HTMLElement> = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const homeContent = (
    <div className="home-content" onDragOver={blockHomeDrop} onDrop={blockHomeDrop}>
      <div className="home-primary">
        <HomeWelcomeBanner />
        <HomeQuickStart
          onOpenPdf={handleOpenPdf}
          onDropPdf={onDropPdf}
          onRejectDrop={(message) => showNotice('无法打开文件', message)}
          onOpenFolder={onOpenFolders}
        />
        <HomeRecentSessions
          documents={recentDocuments}
          onReopenDocument={onReopenRecentDocument}
          onClearRecords={showClearRecordNotice}
        />
        <HomeRecentFiles
          documents={recentDocuments}
          favoriteDocumentKeys={favoriteDocumentKeys}
          onOpenAll={onOpenRecentFiles}
          onReopenDocument={onReopenRecentDocument}
          onToggleFavorite={onToggleFavorite}
          onLocateFile={() =>
            showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
          }
          onRemoveRecent={() =>
            showNotice('移除最近记录功能待补充', '从最近记录移除将在最近文件管理功能中补充。')
          }
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
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenBookmarks={onOpenBookmarks}
        onOpenAnnotations={onOpenAnnotations}
        onOpenShortcutSettings={openShortcutSettings}
        onOpenCacheManagement={onOpenCacheManagement}
        onSetupFileAssociation={handleSetupFileAssociation}
        onCheckUpdates={handleCheckUpdates}
      />
    </div>
  );

  const recentFilesContent = (
    <div className="home-content home-blank-content">
      <HomeRecentFilesWorkspace
        documents={recentDocuments}
        favoriteDocumentKeys={favoriteDocumentKeys}
        onOpenPdf={handleOpenPdf}
        onReopenDocument={onReopenRecentDocument}
        onToggleFavorite={onToggleFavorite}
        onLocateFile={() =>
          showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
        }
        onRemoveRecent={() =>
          showNotice('移除最近记录功能待补充', '从最近记录移除将在最近文件管理功能中补充。')
        }
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
    <div className="home-content home-blank-content">
      <HomeBookmarksWorkspace
        bookmarks={bookmarks}
        error={bookmarkError}
        canOpenBookmark={canOpenBookmark}
        onOpenBookmark={onOpenBookmark}
      />
    </div>
  );

  const mainContent =
    activeSidebarPage === 'recentFiles' ? (
      recentFilesContent
    ) : activeSidebarPage === 'favoriteFiles' ? (
      favoriteFilesContent
    ) : activeSidebarPage === 'bookmarks' ? (
      bookmarksContent
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
          onOpenCacheManagement={onOpenCacheManagement}
        />
        <div className="home-main">{mainContent}</div>
      </section>
      <HomeStatusBar taskStatus={taskStatus} onOpenViewControls={handleOpenViewControls} />
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
