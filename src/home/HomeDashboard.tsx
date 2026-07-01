import { BookOpen, FileText, Settings, Tags } from 'lucide-react';
import { useCallback, useRef, type ChangeEventHandler } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { HomeFavorites } from './HomeFavorites';
import { HomeQuickStart } from './HomeQuickStart';
import { HomeRecentSessions } from './HomeRecentSessions';
import { HomeStatusPanel } from './HomeStatusPanel';
import { HomeTopBar } from './HomeTopBar';

const noop = () => undefined;

type HomeDashboardProps = {
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  onOpenPdf(): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onOpenGlobalSearch?(): void;
  onOpenImport?(): void;
  onOpenCompare?(): void;
  onOpenAnnotations?(): void;
  onOpenBookmarks?(): void;
  onOpenSettings(): void;
  onOpenTags(): void;
};

export function HomeDashboard({
  recentDocuments,
  favoriteDocuments,
  onOpenPdf,
  onBrowserFileChange,
  onReopenRecentDocument,
  onToggleFavorite,
  onOpenGlobalSearch = noop,
  onOpenImport = noop,
  onOpenCompare = noop,
  onOpenAnnotations = noop,
  onOpenBookmarks = noop,
  onOpenSettings,
  onOpenTags,
}: HomeDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openBrowserFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPdf = useCallback(() => {
    try {
      void Promise.resolve(onOpenPdf()).catch(openBrowserFilePicker);
    } catch {
      openBrowserFilePicker();
    }
  }, [onOpenPdf, openBrowserFilePicker]);

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
        onChange={onBrowserFileChange}
      />
      <section className="home-dashboard" aria-label="SmartReader 首页内容">
        <aside className="home-sidebar">
          <div className="brand-lockup">
            <FileText size={22} />
            <div>
              <strong>SmartReader</strong>
              <span>本地 PDF 工作台</span>
            </div>
          </div>
          <nav aria-label="主导航" className="home-nav">
            <button type="button" className="active">
              <BookOpen size={16} />
              <span>首页</span>
            </button>
            <button type="button" onClick={onOpenTags}>
              <Tags size={16} />
              <span>标签管理</span>
            </button>
            <button type="button" onClick={onOpenSettings}>
              <Settings size={16} />
              <span>设置</span>
            </button>
          </nav>
        </aside>
        <div className="home-main">
          <header className="home-header">
            <div>
              <p>SmartReader</p>
              <h1>阅读仪表盘</h1>
            </div>
            <span>离线优先 · 桌面工作区</span>
          </header>
          <div className="home-content">
            <div className="home-primary">
              <HomeQuickStart onOpenPdf={handleOpenPdf} onPickBrowserFile={openBrowserFilePicker} />
              <HomeRecentSessions
                documents={recentDocuments}
                onReopenDocument={onReopenRecentDocument}
              />
              <HomeFavorites documents={favoriteDocuments} onToggleFavorite={onToggleFavorite} />
            </div>
            <HomeStatusPanel />
          </div>
        </div>
      </section>
    </div>
  );
}
