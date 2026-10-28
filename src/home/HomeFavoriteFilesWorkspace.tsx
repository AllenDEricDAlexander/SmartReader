import { FileText, Grid2X2, List, Search, Star, Tags } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { BookList } from '../components/book-list/BookList';
import { BookListMenu } from '../components/book-list/BookListMenu';
import { documentBookItem, matchesBookSource, type BookSourceFilter } from '../components/book-list/bookListAdapters';
import { useBookListPagination } from '../components/book-list/useBookListPagination';
import type { Paper } from '../library/libraryModels';
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
  papersByKey?: ReadonlyMap<string, Paper>;
  tags: Tag[];
  onOpenPdf(): void | Promise<unknown>;
  onOpenDocument(document: FavoriteDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onBatchUnfavorite?(documentKeys: string[]): Promise<string[]>;
  onLocateFile(document: FavoriteDocument): void | Promise<void>;
  onOpenTags(): void;
};

export function HomeFavoriteFilesWorkspace({
  documents,
  papersByKey,
  tags,
  onOpenPdf,
  onOpenDocument,
  onToggleFavorite,
  onBatchUnfavorite,
  onLocateFile,
  onOpenTags,
}: HomeFavoriteFilesWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<FavoriteSortMode>('recent');
  const [progressFilter, setProgressFilter] = useState<FavoriteProgressFilter>('all');
  const [tagFilter, setTagFilter] = useState<FavoriteTagFilter>('all');
  const [directoryFilter, setDirectoryFilter] = useState<FavoriteDirectoryFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<BookSourceFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const batchRunning = useRef(false);
  const availableKeys = useRef(new Set(documents.map((document) => document.documentKey)));
  const batchKeys = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    availableKeys.current = new Set(documents.map((document) => document.documentKey));
    if (batchKeys.current) {
      for (const key of batchKeys.current) if (!availableKeys.current.has(key)) batchKeys.current.delete(key);
    }
  }, [documents]);

  const tagOptions = useMemo(() => buildFavoriteTagOptions(documents, tags), [documents, tags]);
  const directoryOptions = useMemo(() => buildFavoriteDirectoryOptions(documents), [documents]);
  const visibleDocuments = useMemo(() => {
    const filteredDocuments = filterFavoriteDocuments(documents, {
      query,
      progressFilter,
      tagFilter,
      directoryFilter,
    });

    return sortFavoriteDocuments(filteredDocuments.filter((document) => matchesBookSource(document, sourceFilter)), sortMode);
  }, [directoryFilter, documents, progressFilter, query, sortMode, sourceFilter, tagFilter]);
  const page = useBookListPagination(visibleDocuments, JSON.stringify([query, sortMode, progressFilter, tagFilter, directoryFilter, sourceFilter]));
  const shownKeys = new Set((viewMode === 'list' ? page.items : visibleDocuments).map((document) => document.documentKey));
  const selectedOutsidePage = [...selectedKeys].filter((key) => !shownKeys.has(key)).length;
  const overview = useMemo(() => deriveFavoriteOverview(documents), [documents]);
  const recentActivity = useMemo(() => getRecentFavoriteActivity(documents), [documents]);
  const recommendations = useMemo(
    () => buildFavoriteRecommendations(documents, tags),
    [documents, tags],
  );
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  useEffect(() => {
    const available = new Set(documents.map((document) => document.documentKey));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [documents]);

  const selectKeys = (keys: readonly string[], checked: boolean) => setSelectedKeys((current) => {
    const next = new Set(current);
    for (const key of keys) checked ? next.add(key) : next.delete(key);
    return next;
  });

  const batchUnfavorite = async () => {
    if (!onBatchUnfavorite || batchRunning.current || !selectedKeys.size) return;
    batchRunning.current = true;
    setBatchBusy(true);
    setBatchError(null);
    batchKeys.current = new Set(selectedKeys);
    try {
      const failed = await onBatchUnfavorite([...selectedKeys]);
      setSelectedKeys(new Set(failed.filter((key) => availableKeys.current.has(key) && batchKeys.current?.has(key))));
      if (failed.length) setBatchError(`${failed.length} 个文件取消收藏失败，请重试。`);
    } catch (failure) {
      setBatchError(failure instanceof Error ? failure.message : '批量取消收藏失败，请重试。');
    } finally {
      batchKeys.current = null;
      batchRunning.current = false;
      setBatchBusy(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setTagFilter('all');
    setDirectoryFilter('all');
    setSourceFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const renderTags = (document: FavoriteDocument, table = false) => (
    <div className="favorite-workspace-tags" aria-label={`${document.displayName} 标签`}>
      {document.tagIds.length > 0 ? (
        document.tagIds.map((tagId) => {
          const tag = tagsById.get(tagId);
          return tag ? (
            <button
              type="button"
              key={tag.id}
              className={table ? 'book-list-tag' : 'favorite-tag-chip'}
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
  );

  const renderActions = (document: FavoriteDocument) => (
    <div className="favorite-workspace-actions">
      <button type="button" className="secondary-button" aria-label={`继续阅读 ${document.displayName}`}
        onClick={() => void onOpenDocument(document)}>继续阅读</button>
      <button type="button" className="icon-button active" aria-label={`取消收藏 ${document.displayName}`}
        aria-pressed="true" disabled={batchBusy} onClick={() => void onToggleFavorite(document.documentKey, false)}>
        <Star size={16} fill="currentColor" />
      </button>
      <BookListMenu name={document.displayName} disabled={batchBusy} actions={[
        { label: '打开', onSelect: () => onOpenDocument(document) },
        { label: '取消收藏', onSelect: () => onToggleFavorite(document.documentKey, false) },
        { label: '定位文件', onSelect: () => onLocateFile(document) },
      ]} />
    </div>
  );

  const renderDocument = (document: FavoriteDocument) => {
    const progressPercent = formatProgressPercent(document.progress);
    const directory = getFavoriteDirectoryLabel(document);

    return (
      <article
        key={document.documentKey}
        className="favorite-workspace-card"
        data-testid="favorite-workspace-document"
      >
        {onBatchUnfavorite ? <label className="recent-selection"><input type="checkbox" aria-label={`选择 ${document.displayName}`}
          checked={selectedKeys.has(document.documentKey)} disabled={batchBusy}
          onChange={(event) => selectKeys([document.documentKey], event.target.checked)} /></label> : null}
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
        {renderTags(document)}
        {renderActions(document)}
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
                <span>文件来源筛选</span>
                <select value={sourceFilter} aria-label="文件来源筛选" onChange={(event) => setSourceFilter(event.target.value as BookSourceFilter)}>
                  <option value="all">全部来源</option><option value="paper">本地文献库</option>
                  <option value="desktop">本地路径</option><option value="browser">浏览器文件</option>
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

            {selectedKeys.size ? <div className="recent-batch-bar" aria-label="批量收藏操作">
              <span>已选择 {selectedKeys.size} 个文件</span>
              {selectedOutsidePage ? <span>其中 {selectedOutsidePage} 个不在当前显示范围</span> : null}
              <button type="button" className="secondary-button" disabled={batchBusy || !onBatchUnfavorite} onClick={() => void batchUnfavorite()}>
                {batchBusy ? '正在取消收藏…' : '批量取消收藏'}
              </button>
              <button type="button" className="text-link-button" disabled={batchBusy} onClick={() => setSelectedKeys(new Set())}>取消选择</button>
            </div> : null}
            {batchError ? <p role="alert">{batchError}</p> : null}
            {visibleDocuments.length > 0 ? (
              viewMode === 'cards' ? <div className="favorite-workspace-grid" data-testid="favorite-workspace-results">
                {visibleDocuments.map(renderDocument)}
              </div> : <div data-testid="favorite-workspace-results">
                <BookList label="收藏文件列表"
                  items={page.items.map((document) => ({ ...documentBookItem(document, papersByKey?.get(document.documentKey)), favorite: true }))}
                  columns={onBatchUnfavorite ? ['selection', 'name', 'authors', 'journal', 'path', 'opened', 'progress', 'page', 'tags', 'actions'] : ['name', 'authors', 'journal', 'path', 'opened', 'progress', 'page', 'tags', 'actions']}
                  rowTestId="favorite-workspace-document" nameTestId="favorite-workspace-document-name"
                  selection={onBatchUnfavorite ? { selectedKeys, isDisabled: () => batchBusy,
                    onChange: (item, checked) => selectKeys([item.key], checked),
                    onSelectPage: (checked) => selectKeys(page.items.map((document) => document.documentKey), checked) } : undefined}
                  onOpen={(item) => void onOpenDocument(item.source)}
                  renderTags={(item) => renderTags(item.source, true)} renderActions={(item) => renderActions(item.source)}
                  pagination={page.pagination} />
                {onBatchUnfavorite && visibleDocuments.length > page.items.length ? <button type="button" className="text-link-button"
                  disabled={batchBusy} onClick={() => selectKeys(visibleDocuments.map((document) => document.documentKey), true)}>
                  选择全部 {visibleDocuments.length} 条筛选结果
                </button> : null}
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
