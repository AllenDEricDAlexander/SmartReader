import { BookOpen, FileText, Settings, Tags } from 'lucide-react';
import type { ChangeEventHandler } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { HomeFavorites } from './HomeFavorites';
import { HomeQuickStart } from './HomeQuickStart';
import { HomeRecentSessions } from './HomeRecentSessions';
import { HomeStatusPanel } from './HomeStatusPanel';

type HomeDashboardProps = {
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  onOpenPdf(): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
};

export function HomeDashboard({
  recentDocuments,
  favoriteDocuments,
  onOpenPdf,
  onBrowserFileChange,
  onReopenRecentDocument,
}: HomeDashboardProps) {
  return (
    <section className="home-dashboard" aria-label="SmartReader 首页">
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
            首页
          </button>
          <button type="button" disabled aria-disabled="true">
            <Tags size={16} />
            标签
          </button>
          <button type="button" disabled aria-disabled="true">
            <Settings size={16} />
            设置
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
            <HomeQuickStart onOpenPdf={onOpenPdf} onBrowserFileChange={onBrowserFileChange} />
            <HomeRecentSessions
              documents={recentDocuments}
              onReopenDocument={onReopenRecentDocument}
            />
            <HomeFavorites documents={favoriteDocuments} />
          </div>
          <HomeStatusPanel />
        </div>
      </div>
    </section>
  );
}
