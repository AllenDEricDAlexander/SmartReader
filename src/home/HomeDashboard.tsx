import { useCallback, useRef, type ChangeEventHandler } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { HomeBlankPage, isHomeBlankPageId } from './HomeBlankPage';
import { HomeFavorites } from './HomeFavorites';
import { HomeQuickStart } from './HomeQuickStart';
import { HomeRecentSessions } from './HomeRecentSessions';
import { HomeSidebar, type HomeSidebarPage, type HomeSidebarProps } from './HomeSidebar';
import { HomeStatusPanel } from './HomeStatusPanel';
import { HomeTopBar } from './HomeTopBar';

const noop = () => undefined;

type HomeDashboardProps = {
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  activeSidebarPage?: HomeSidebarPage;
  counts?: HomeSidebarProps['counts'];
  cacheStats?: HomeSidebarProps['cacheStats'];
  onOpenPdf(): void | Promise<unknown>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
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
  onOpenSettings(): void;
  onOpenTags(): void;
};

export function HomeDashboard({
  recentDocuments,
  favoriteDocuments,
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
  onOpenPdf,
  onBrowserFileChange,
  onReopenRecentDocument,
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
  onOpenSettings,
  onOpenTags,
}: HomeDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const homeContent = (
    <div className="home-content">
      <div className="home-primary">
        <HomeQuickStart onOpenPdf={handleOpenPdf} onPickBrowserFile={openBrowserFilePicker} />
        <HomeRecentSessions documents={recentDocuments} onReopenDocument={onReopenRecentDocument} />
        <HomeFavorites documents={favoriteDocuments} onToggleFavorite={onToggleFavorite} />
      </div>
      <HomeStatusPanel />
    </div>
  );

  const mainContent = isHomeBlankPageId(activeSidebarPage) ? (
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
        <div className="home-main">
          <header className="home-header">
            <div>
              <p>SmartReader</p>
              <h1>阅读仪表盘</h1>
            </div>
            <span>离线优先 · 桌面工作区</span>
          </header>
          {mainContent}
        </div>
      </section>
    </div>
  );
}
