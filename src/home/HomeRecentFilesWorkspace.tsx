import { FileText, Grid2X2, List, Search, Star } from 'lucide-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { formatDateTime, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';

type SortMode = 'recent' | 'name' | 'progressDesc' | 'progressAsc';
type ProgressFilter = 'all' | 'notStarted' | 'reading' | 'completed';
type FavoriteFilter = 'all' | 'favorite' | 'notFavorite';
type ViewMode = 'list' | 'cards';

type HomeRecentFilesWorkspaceProps = {
  documents: PersistedDocument[];
  favoriteDocumentKeys: Set<string>;
  onOpenPdf(): void | Promise<unknown>;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecent(document: PersistedDocument): void;
};

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

function getDocumentSearchText(document: PersistedDocument) {
  return [document.displayName, document.path, document.documentKey]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function matchesProgressFilter(document: PersistedDocument, filter: ProgressFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'notStarted') {
    return document.progress <= 0;
  }

  if (filter === 'reading') {
    return document.progress > 0 && document.progress < 1;
  }

  return document.progress >= 1;
}

function getModifiedTime(document: PersistedDocument) {
  if (!document.modifiedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = new Date(document.modifiedAt).getTime();

  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function compareByName(left: PersistedDocument, right: PersistedDocument) {
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN');
}

function sortDocuments(documents: PersistedDocument[], sortMode: SortMode) {
  return [...documents].sort((left, right) => {
    if (sortMode === 'name') {
      return compareByName(left, right);
    }

    if (sortMode === 'progressDesc') {
      return right.progress - left.progress || compareByName(left, right);
    }

    if (sortMode === 'progressAsc') {
      return left.progress - right.progress || compareByName(left, right);
    }

    return getModifiedTime(right) - getModifiedTime(left) || compareByName(left, right);
  });
}

export function HomeRecentFilesWorkspace({
  documents,
  favoriteDocumentKeys,
  onOpenPdf,
  onReopenDocument,
  onToggleFavorite,
  onLocateFile: _onLocateFile,
  onRemoveRecent: _onRemoveRecent,
}: HomeRecentFilesWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const normalizedQuery = normalizeSearchValue(query);
  const filtering = normalizedQuery !== '' || progressFilter !== 'all' || favoriteFilter !== 'all';

  const visibleDocuments = useMemo(() => {
    const filteredDocuments = documents.filter((document) => {
      if (normalizedQuery && !getDocumentSearchText(document).includes(normalizedQuery)) {
        return false;
      }

      if (!matchesProgressFilter(document, progressFilter)) {
        return false;
      }

      const favorite = favoriteDocumentKeys.has(document.documentKey);

      if (favoriteFilter === 'favorite') {
        return favorite;
      }

      if (favoriteFilter === 'notFavorite') {
        return !favorite;
      }

      return true;
    });

    return sortDocuments(filteredDocuments, sortMode);
  }, [documents, favoriteDocumentKeys, favoriteFilter, normalizedQuery, progressFilter, sortMode]);

  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setFavoriteFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const renderDocument = (document: PersistedDocument) => {
    const favorite = favoriteDocumentKeys.has(document.documentKey);
    const progressPercent = formatProgressPercent(document.progress);

    return (
      <article
        key={document.documentKey}
        className={viewMode === 'cards' ? 'recent-workspace-card' : 'recent-workspace-row'}
        data-testid="recent-workspace-document"
      >
        <div className="recent-workspace-file-main">
          <span className="pdf-file-icon" aria-hidden="true">
            <FileText size={16} />
          </span>
          <div>
            <strong data-testid="recent-workspace-document-name" title={document.displayName}>
              {document.displayName}
            </strong>
            <span title={document.path ?? '本地浏览器文件'}>{getDirectoryPath(document.path)}</span>
          </div>
        </div>
        <div className="recent-workspace-meta">
          <span>{formatDateTime(document.modifiedAt)}</span>
          <span>
            {document.pageCount ? `${document.lastPage} / ${document.pageCount} 页` : '页数未知'}
          </span>
        </div>
        <div className="progress-cell">
          <span>{progressPercent}%</span>
          <span
            className="recent-progress"
            role="progressbar"
            aria-label={`阅读进度 ${document.displayName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        </div>
        <div className="recent-workspace-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onReopenDocument(document)}
          >
            继续阅读
          </button>
          <button
            type="button"
            className={favorite ? 'icon-button active' : 'icon-button'}
            aria-label={`${favorite ? '取消收藏' : '收藏'} ${document.displayName}`}
            onClick={() => void onToggleFavorite(document.documentKey, !favorite)}
          >
            <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </article>
    );
  };

  return (
    <section className="home-panel recent-workspace" aria-labelledby="recent-workspace-title">
      <div className="section-heading horizontal recent-workspace-heading">
        <div>
          <p>文档管理</p>
          <h2 id="recent-workspace-title">最近文件</h2>
          <span>查看、筛选并继续阅读最近打开过的本地 PDF。</span>
        </div>
        <span className="recent-workspace-count">
          共 {documents.length} 个最近文件，当前显示 {visibleDocuments.length} 个
        </span>
      </div>

      {documents.length > 0 ? (
        <>
          <div className="recent-workspace-toolbar">
            <label className="recent-workspace-search">
              <span>搜索最近文件</span>
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                aria-label="搜索最近文件"
                placeholder="搜索文件名或路径..."
                onChange={handleQueryChange}
              />
            </label>
            <label>
              <span>排序方式</span>
              <select
                value={sortMode}
                aria-label="排序方式"
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="recent">最近打开优先</option>
                <option value="name">文件名 A-Z</option>
                <option value="progressDesc">阅读进度高到低</option>
                <option value="progressAsc">阅读进度低到高</option>
              </select>
            </label>
            <label>
              <span>阅读进度筛选</span>
              <select
                value={progressFilter}
                aria-label="阅读进度筛选"
                onChange={(event) => setProgressFilter(event.target.value as ProgressFilter)}
              >
                <option value="all">全部进度</option>
                <option value="notStarted">未开始</option>
                <option value="reading">阅读中</option>
                <option value="completed">已读完</option>
              </select>
            </label>
            <label>
              <span>收藏状态筛选</span>
              <select
                value={favoriteFilter}
                aria-label="收藏状态筛选"
                onChange={(event) => setFavoriteFilter(event.target.value as FavoriteFilter)}
              >
                <option value="all">全部文件</option>
                <option value="favorite">已收藏</option>
                <option value="notFavorite">未收藏</option>
              </select>
            </label>
            <div className="recent-workspace-view-toggle" aria-label="显示方式">
              <button
                type="button"
                className="icon-text-button"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                <List size={16} />
                列表视图
              </button>
              <button
                type="button"
                className="icon-text-button"
                aria-pressed={viewMode === 'cards'}
                onClick={() => setViewMode('cards')}
              >
                <Grid2X2 size={16} />
                卡片视图
              </button>
            </div>
            <button type="button" className="text-link-button" disabled={!filtering} onClick={clearFilters}>
              清除筛选
            </button>
          </div>

          {visibleDocuments.length > 0 ? (
            <div className={viewMode === 'cards' ? 'recent-workspace-grid' : 'recent-workspace-list'}>
              {visibleDocuments.map(renderDocument)}
            </div>
          ) : (
            <div className="empty-block">
              <strong>没有匹配的最近文件</strong>
              <span>调整关键词或筛选条件后再试。</span>
            </div>
          )}
        </>
      ) : (
        <div className="empty-block recent-workspace-empty">
          <strong>暂无最近文件</strong>
          <span>打开 PDF 后会显示在这里。</span>
          <button type="button" className="primary-button" onClick={() => void onOpenPdf()}>
            打开文件
          </button>
        </div>
      )}
    </section>
  );
}
