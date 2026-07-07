import { FileText, Grid2X2, List, MoreVertical, Search, Star, Tags } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';
import {
  buildFavoriteDirectoryOptions,
  buildFavoriteRecommendations,
  buildFavoriteTagOptions,
  deriveFavoriteOverview,
  filterFavoriteDocuments,
  getFavoriteDirectoryLabel,
  getRecentFavoriteActivity,
  sortFavoriteDocuments,
  type FavoriteDirectoryFilter,
  type FavoriteProgressFilter,
  type FavoriteSortMode,
  type FavoriteTagFilter,
} from './favoriteWorkspaceUtils';
import { formatDateTime, formatProgressPercent } from './homeDisplayUtils';

type ViewMode = 'cards' | 'list';

type HomeFavoriteFilesWorkspaceProps = {
  documents: FavoriteDocument[];
  tags: Tag[];
  onOpenPdf(): void | Promise<unknown>;
  onOpenDocument(document: FavoriteDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: FavoriteDocument): void | Promise<void>;
  onOpenTags(): void;
};

export function HomeFavoriteFilesWorkspace({
  documents,
  tags,
  onOpenPdf,
  onOpenDocument,
  onToggleFavorite,
  onLocateFile,
  onOpenTags,
}: HomeFavoriteFilesWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<FavoriteSortMode>('recent');
  const [progressFilter, setProgressFilter] = useState<FavoriteProgressFilter>('all');
  const [tagFilter, setTagFilter] = useState<FavoriteTagFilter>('all');
  const [directoryFilter, setDirectoryFilter] = useState<FavoriteDirectoryFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuItemRefs = useRef(new Map<string, Array<HTMLButtonElement | null>>());

  const tagOptions = useMemo(() => buildFavoriteTagOptions(documents, tags), [documents, tags]);
  const directoryOptions = useMemo(() => buildFavoriteDirectoryOptions(documents), [documents]);
  const visibleDocuments = useMemo(() => {
    const filteredDocuments = filterFavoriteDocuments(documents, {
      query,
      progressFilter,
      tagFilter,
      directoryFilter,
    });

    return sortFavoriteDocuments(filteredDocuments, sortMode);
  }, [directoryFilter, documents, progressFilter, query, sortMode, tagFilter]);
  const overview = useMemo(() => deriveFavoriteOverview(documents), [documents]);
  const recentActivity = useMemo(() => getRecentFavoriteActivity(documents), [documents]);
  const recommendations = useMemo(
    () => buildFavoriteRecommendations(documents, tags),
    [documents, tags],
  );
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setTagFilter('all');
    setDirectoryFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  useEffect(() => {
    if (!openMenuKey) {
      return;
    }

    menuItemRefs.current.get(openMenuKey)?.[0]?.focus();
  }, [openMenuKey]);

  const closeMenu = () => setOpenMenuKey(null);

  const closeMenuAndFocusTrigger = (documentKey: string) => {
    closeMenu();
    triggerRefs.current.get(documentKey)?.focus();
  };

  const handleMenuAction = (action: () => void | Promise<void>) => {
    closeMenu();
    void action();
  };

  const setTriggerRef = (documentKey: string, element: HTMLButtonElement | null) => {
    if (element) {
      triggerRefs.current.set(documentKey, element);
      return;
    }

    triggerRefs.current.delete(documentKey);
  };

  const setMenuItemRef = (
    documentKey: string,
    index: number,
    element: HTMLButtonElement | null,
  ) => {
    const items = menuItemRefs.current.get(documentKey) ?? [];

    if (element) {
      items[index] = element;
      menuItemRefs.current.set(documentKey, items);
      return;
    }

    items[index] = null;
    if (items.some(Boolean)) {
      menuItemRefs.current.set(documentKey, items);
      return;
    }

    menuItemRefs.current.delete(documentKey);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>, documentKey: string) => {
    const menuItems = menuItemRefs.current.get(documentKey)?.filter(Boolean) ?? [];

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenuAndFocusTrigger(documentKey);
      return;
    }

    if (menuItems.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      menuItems.findIndex((item) => item === document.activeElement),
      0,
    );

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      menuItems[(currentIndex + 1) % menuItems.length]?.focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length]?.focus();
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      menuItems[0]?.focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      menuItems[menuItems.length - 1]?.focus();
    }
  };

  const renderDocument = (document: FavoriteDocument) => {
    const progressPercent = formatProgressPercent(document.progress);
    const directory = getFavoriteDirectoryLabel(document);
    const menuOpen = openMenuKey === document.documentKey;

    return (
      <article
        key={document.documentKey}
        className={viewMode === 'cards' ? 'favorite-workspace-card' : 'favorite-workspace-row'}
        data-testid="favorite-workspace-document"
      >
        <div className="favorite-workspace-file-main">
          <span className="pdf-file-icon" aria-hidden="true">
            <FileText size={16} />
          </span>
          <div>
            <strong data-testid="favorite-workspace-document-name" title={document.displayName}>
              {document.displayName}
            </strong>
            <span title={document.path ?? directory}>{directory}</span>
          </div>
        </div>
        <div className="favorite-workspace-meta">
          <span>
            {document.lastOpenedAt ? formatDateTime(document.lastOpenedAt) : '最近打开时间未知'}
          </span>
          <span>
            {document.pageCount
              ? `${document.lastPage} / ${document.pageCount} 页`
              : `第 ${document.lastPage} 页`}
          </span>
        </div>
        <div className="favorite-workspace-progress">
          <span>阅读进度</span>
          <div className="recent-progress" aria-label={`阅读进度 ${progressPercent}`}>
            <span style={{ width: progressPercent }} />
          </div>
          <strong>{progressPercent}</strong>
        </div>
        <div className="favorite-workspace-tags" aria-label={`${document.displayName} 标签`}>
          {document.tagIds.length > 0 ? (
            document.tagIds.map((tagId) => {
              const tag = tagsById.get(tagId);
              return tag ? (
                <button
                  type="button"
                  key={tag.id}
                  className="favorite-tag-chip"
                  style={{ borderColor: tag.color, color: tag.color }}
                  onClick={() => setTagFilter(`${tag.id}`)}
                >
                  {tag.name}
                </button>
              ) : null;
            })
          ) : (
            <span>暂无标签</span>
          )}
        </div>
        <div className="favorite-workspace-actions">
          <button
            type="button"
            className="secondary-button"
            aria-label={`继续阅读 ${document.displayName}`}
            onClick={() => void onOpenDocument(document)}
          >
            继续阅读
          </button>
          <button
            type="button"
            className="icon-button active"
            aria-label={`取消收藏 ${document.displayName}`}
            aria-pressed="true"
            onClick={() => void onToggleFavorite(document.documentKey, false)}
          >
            <Star size={16} fill="currentColor" />
          </button>
          <div className="recent-workspace-menu-wrap">
            <button
              type="button"
              ref={(element) => setTriggerRef(document.documentKey, element)}
              className="icon-button"
              aria-label={`更多操作 ${document.displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setOpenMenuKey(menuOpen ? null : document.documentKey)}
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen ? (
              <div
                className="recent-file-menu"
                role="menu"
                onKeyDown={(event) => handleMenuKeyDown(event, document.documentKey)}
              >
                <button
                  type="button"
                  ref={(element) => setMenuItemRef(document.documentKey, 0, element)}
                  role="menuitem"
                  onClick={() => handleMenuAction(() => onOpenDocument(document))}
                >
                  打开
                </button>
                <button
                  type="button"
                  ref={(element) => setMenuItemRef(document.documentKey, 1, element)}
                  role="menuitem"
                  onClick={() =>
                    handleMenuAction(() => onToggleFavorite(document.documentKey, false))
                  }
                >
                  取消收藏
                </button>
                <button
                  type="button"
                  ref={(element) => setMenuItemRef(document.documentKey, 2, element)}
                  role="menuitem"
                  onClick={() => handleMenuAction(() => onLocateFile(document))}
                >
                  定位文件
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="favorite-workspace-layout">
      <section className="home-panel favorite-workspace" aria-labelledby="favorite-workspace-title">
        <div className="section-heading horizontal recent-workspace-heading">
          <div>
            <p>文档管理</p>
            <h2 id="favorite-workspace-title">收藏文件</h2>
            <span>集中管理已收藏的本地 PDF。</span>
          </div>
          <span className="recent-workspace-count">
            共 {documents.length} 个收藏，当前显示 {visibleDocuments.length} 个
          </span>
        </div>

        {documents.length > 0 ? (
          <>
            <div className="favorite-workspace-toolbar">
              <label className="recent-workspace-search">
                <span>搜索收藏文件</span>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  aria-label="搜索收藏文件"
                  placeholder="搜索文件名、路径或目录..."
                  onChange={handleQueryChange}
                />
              </label>
              <label>
                <span>排序方式</span>
                <select
                  value={sortMode}
                  aria-label="排序方式"
                  onChange={(event) => setSortMode(event.target.value as FavoriteSortMode)}
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
                  onChange={(event) =>
                    setProgressFilter(event.target.value as FavoriteProgressFilter)
                  }
                >
                  <option value="all">全部进度</option>
                  <option value="notStarted">未开始</option>
                  <option value="reading">阅读中</option>
                  <option value="completed">已读完</option>
                </select>
              </label>
              <label>
                <span>标签筛选</span>
                <select
                  value={tagFilter}
                  aria-label="标签筛选"
                  onChange={(event) => setTagFilter(event.target.value as FavoriteTagFilter)}
                >
                  <option value="all">全部标签</option>
                  {tagOptions.map((option) => (
                    <option key={option.tag.id} value={`${option.tag.id}`}>
                      {option.tag.name}（{option.count}）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>目录筛选</span>
                <select
                  value={directoryFilter}
                  aria-label="目录筛选"
                  onChange={(event) =>
                    setDirectoryFilter(event.target.value as FavoriteDirectoryFilter)
                  }
                >
                  <option value="all">全部目录</option>
                  {directoryOptions.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}（{option.count}）
                    </option>
                  ))}
                </select>
              </label>
              <div className="recent-workspace-view-toggle" aria-label="显示方式">
                <button
                  type="button"
                  className="icon-text-button"
                  aria-pressed={viewMode === 'cards'}
                  onClick={() => setViewMode('cards')}
                >
                  <Grid2X2 size={16} />
                  卡片视图
                </button>
                <button
                  type="button"
                  className="icon-text-button"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                >
                  <List size={16} />
                  列表视图
                </button>
              </div>
              <button type="button" className="text-link-button" onClick={clearFilters}>
                清除筛选
              </button>
            </div>

            {visibleDocuments.length > 0 ? (
              <div
                className={viewMode === 'cards' ? 'favorite-workspace-grid' : 'favorite-workspace-list'}
                data-testid="favorite-workspace-results"
              >
                {visibleDocuments.map(renderDocument)}
              </div>
            ) : (
              <div className="empty-block recent-workspace-empty">
                <strong>没有匹配的收藏文件</strong>
                <span>调整搜索、标签、目录或阅读状态筛选后再试。</span>
                <button type="button" className="secondary-button" onClick={clearFilters}>
                  清除筛选
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-block recent-workspace-empty">
            <strong>暂无收藏文件</strong>
            <span>收藏 PDF 后会显示在这里。</span>
            <button type="button" className="primary-button" onClick={() => void onOpenPdf()}>
              打开文件
            </button>
          </div>
        )}
      </section>

      <aside className="favorite-workspace-aside" aria-label="收藏文件辅助信息">
        <section className="favorite-insight-card">
          <h3>收藏概览</h3>
          <div className="favorite-overview-grid">
            <span><strong>{overview.totalCount}</strong>收藏文件</span>
            <span><strong>{overview.taggedCount}</strong>有标签</span>
            <span><strong>{overview.directoryCount}</strong>目录</span>
            <span><strong>{Math.round(overview.completedRatio * 100)}%</strong>已读完</span>
          </div>
          <p>平均阅读进度 {Math.round(overview.averageProgress * 100)}%</p>
        </section>

        <section className="favorite-insight-card">
          <div className="favorite-insight-heading">
            <h3>常用标签</h3>
            <button type="button" className="text-link-button" onClick={onOpenTags}>
              管理标签
            </button>
          </div>
          {tagOptions.length > 0 ? (
            <div className="favorite-tag-list">
              {tagOptions.map((option) => (
                <button
                  key={option.tag.id}
                  type="button"
                  aria-label={`按标签筛选 ${option.tag.name}`}
                  onClick={() => setTagFilter(`${option.tag.id}`)}
                >
                  <span style={{ color: option.tag.color }}>{option.tag.name}</span>
                  <strong>{option.count}</strong>
                </button>
              ))}
            </div>
          ) : (
            <p>暂无标签，前往标签管理后可用于筛选收藏文件。</p>
          )}
        </section>

        <section className="favorite-insight-card">
          <h3>最近打开的收藏</h3>
          {recentActivity.length > 0 ? (
            <ol className="favorite-activity-list">
              {recentActivity.map((document) => (
                <li key={document.documentKey}>
                  <strong>{document.displayName}</strong>
                  <span>{document.lastOpenedAt ? formatDateTime(document.lastOpenedAt) : '时间未知'}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无最近打开记录。</p>
          )}
        </section>

        <section className="favorite-insight-card">
          <h3>智能推荐收藏理由</h3>
          {recommendations.length > 0 ? (
            <ul className="favorite-recommendation-list">
              {recommendations.map((recommendation) => (
                <li key={recommendation.documentKey}>
                  <Tags size={14} aria-hidden="true" />
                  <span>{recommendation.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无可用推荐理由</p>
          )}
        </section>
      </aside>
    </div>
  );
}
