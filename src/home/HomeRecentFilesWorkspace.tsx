import {
  FileText,
  Grid2X2,
  List,
  Search,
  Star,
  Tags,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { BookList } from '../components/book-list/BookList';
import { BookListMenu } from '../components/book-list/BookListMenu';
import { documentBookItem, matchesBookSource, type BookSourceFilter } from '../components/book-list/bookListAdapters';
import { useBookListPagination } from '../components/book-list/useBookListPagination';
import type { Paper } from '../library/libraryModels';
import type { Tag } from '../tags/tagModels';
import { formatDateTime, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';
import {
  buildRecentActivityItems,
  buildRecentStats,
  buildRecentTagOptions,
  filterRecentDocuments,
  sortRecentDocuments,
  type RecentFavoriteFilter,
  type RecentProgressFilter,
  type RecentSortMode,
  type RecentTagFilter,
} from './recentWorkspaceUtils';

type ViewMode = 'list' | 'cards';
type ConfirmDialog = 'clear' | 'batchRemove';

type HomeRecentFilesWorkspaceProps = {
  documents: PersistedDocument[];
  favoriteDocumentKeys: Set<string>;
  papersByKey?: ReadonlyMap<string, Paper>;
  tags?: Tag[];
  onOpenPdf(): void | Promise<unknown>;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onToggleDocumentTag?(document: PersistedDocument, tag: Tag, selected: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecent?(document: PersistedDocument): void;
  onRemoveRecentDocuments?(documents: PersistedDocument[]): void | Promise<void>;
  onClearRecentDocuments?(): void | Promise<void>;
  onOpenTags?(): void;
};

function formatPageProgress(document: PersistedDocument) {
  if (!document.pageCount) {
    return '页数未知';
  }

  return `${document.lastPage} / ${document.pageCount} 页`;
}

function sameSelectedKeys(first: Set<string>, second: Set<string>) {
  if (first.size !== second.size) {
    return false;
  }

  for (const key of first) {
    if (!second.has(key)) {
      return false;
    }
  }

  return true;
}

export function HomeRecentFilesWorkspace({
  documents,
  favoriteDocumentKeys,
  papersByKey,
  tags = [],
  onOpenPdf,
  onReopenDocument,
  onToggleFavorite,
  onToggleDocumentTag,
  onLocateFile,
  onRemoveRecent,
  onRemoveRecentDocuments,
  onClearRecentDocuments,
  onOpenTags,
}: HomeRecentFilesWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<RecentSortMode>('recent');
  const [progressFilter, setProgressFilter] = useState<RecentProgressFilter>('all');
  const [tagFilter, setTagFilter] = useState<RecentTagFilter>('all');
  const [favoriteFilter, setFavoriteFilter] = useState<RecentFavoriteFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<BookSourceFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedDocumentKeys, setSelectedDocumentKeys] = useState<Set<string>>(() => new Set());
  const [batchTagId, setBatchTagId] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const tagOptions = useMemo(() => buildRecentTagOptions(documents, tags), [documents, tags]);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const visibleDocuments = useMemo(
    () =>
      sortRecentDocuments(
        filterRecentDocuments(
          documents,
          {
            query,
            progressFilter,
            tagFilter,
            favoriteFilter,
          },
          favoriteDocumentKeys,
        ).filter((document) => matchesBookSource(document, sourceFilter)),
        sortMode,
      ),
    [documents, favoriteDocumentKeys, favoriteFilter, progressFilter, query, sortMode, sourceFilter, tagFilter],
  );
  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentKeys.has(document.documentKey)),
    [documents, selectedDocumentKeys],
  );
  const page = useBookListPagination(visibleDocuments, JSON.stringify([query, sortMode, progressFilter, tagFilter, favoriteFilter, sourceFilter]));
  const selectedBatchTag = useMemo(
    () => tags.find((tag) => String(tag.id) === batchTagId) ?? null,
    [batchTagId, tags],
  );
  const stats = useMemo(
    () => buildRecentStats(documents, favoriteDocumentKeys),
    [documents, favoriteDocumentKeys],
  );
  const activities = useMemo(
    () => buildRecentActivityItems(documents, favoriteDocumentKeys, tags),
    [documents, favoriteDocumentKeys, tags],
  );
  const selectedVisibleCount = visibleDocuments.filter((document) =>
    selectedDocumentKeys.has(document.documentKey),
  ).length;
  const allVisibleSelected =
    visibleDocuments.length > 0 && selectedVisibleCount === visibleDocuments.length;
  const shownKeys = new Set((viewMode === 'list' ? page.items : visibleDocuments).map((document) => document.documentKey));
  const selectedOutsidePage = selectedDocuments.filter((document) => !shownKeys.has(document.documentKey)).length;
  const filtering =
    query.trim() !== '' ||
    progressFilter !== 'all' ||
    tagFilter !== 'all' ||
    favoriteFilter !== 'all' ||
    sourceFilter !== 'all';

  useEffect(() => {
    setSelectedDocumentKeys((previous) => {
      const validKeys = new Set(documents.map((document) => document.documentKey));
      const next = new Set([...previous].filter((key) => validKeys.has(key)));

      return sameSelectedKeys(previous, next) ? previous : next;
    });
  }, [documents]);


  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setTagFilter('all');
    setFavoriteFilter('all');
    setSourceFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const toggleDocumentSelection = (documentKey: string, selected: boolean) => {
    setSelectedDocumentKeys((previous) => {
      const next = new Set(previous);

      if (selected) {
        next.add(documentKey);
      } else {
        next.delete(documentKey);
      }

      return next;
    });
  };

  const toggleVisibleSelection = (selected: boolean) => {
    setSelectedDocumentKeys((previous) => {
      const next = new Set(previous);

      for (const document of visibleDocuments) {
        if (selected) {
          next.add(document.documentKey);
        } else {
          next.delete(document.documentKey);
        }
      }

      return next;
    });
  };

  const removeDocuments = (documentsToRemove: PersistedDocument[]) => {
    if (documentsToRemove.length === 0) {
      return;
    }

    if (onRemoveRecentDocuments) {
      void onRemoveRecentDocuments(documentsToRemove);
    } else if (onRemoveRecent) {
      for (const document of documentsToRemove) {
        onRemoveRecent(document);
      }
    }

    setSelectedDocumentKeys((previous) => {
      const next = new Set(previous);

      for (const document of documentsToRemove) {
        next.delete(document.documentKey);
      }

      return next;
    });
  };

  const handleBatchTagChange = (selected: boolean) => {
    if (!selectedBatchTag || !onToggleDocumentTag) {
      return;
    }

    for (const document of selectedDocuments) {
      void onToggleDocumentTag(document, selectedBatchTag, selected);
    }
  };

  const handleToggleDocumentTag = (document: PersistedDocument, tag: Tag) => {
    const selected = !document.tagIds.includes(tag.id);

    void onToggleDocumentTag?.(document, tag, selected);
  };

  const renderTags = (document: PersistedDocument, table = false) => {
    const documentTags = document.tagIds
      .map((tagId) => tagsById.get(tagId))
      .filter((tag): tag is Tag => Boolean(tag));

    return (
      <div className="recent-tag-cell">
        <div className="recent-tag-list">
          {documentTags.length > 0 ? (
            documentTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={table ? 'book-list-tag' : 'recent-tag-chip'}
                style={table ? { color: tag.color, borderColor: tag.color } : { '--recent-tag-color': tag.color } as CSSProperties}
                onClick={() => setTagFilter(String(tag.id) as RecentTagFilter)}
              >
                {tag.name}
              </button>
            ))
          ) : (
            <span className="recent-tag-empty">未绑定</span>
          )}
        </div>
        <div className="recent-tag-editor-wrap">
          <BookListMenu name={document.displayName} triggerLabel={`编辑标签 ${document.displayName}`} icon={<Tags size={15} />}
            actions={[
              ...tags.map((tag) => ({ label: tag.name, ariaLabel: `切换标签 ${tag.name}`,
                checked: document.tagIds.includes(tag.id), keepOpen: true,
                onSelect: () => handleToggleDocumentTag(document, tag) })),
              { label: '管理标签', onSelect: () => onOpenTags?.() },
            ]} />
        </div>
      </div>
    );
  };

  const renderProgress = (document: PersistedDocument) => {
    const progressPercent = formatProgressPercent(document.progress);

    return (
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
    );
  };

  const renderActions = (document: PersistedDocument) => {
    const favorite = favoriteDocumentKeys.has(document.documentKey);
    return <div className="recent-workspace-actions">
      <button type="button" className="secondary-button" aria-label={`继续阅读 ${document.displayName}`}
        onClick={() => void onReopenDocument(document)}>继续阅读</button>
      <button type="button" className={favorite ? 'icon-button active' : 'icon-button'}
        aria-label={`${favorite ? '取消收藏' : '收藏'} ${document.displayName}`}
        onClick={() => void onToggleFavorite(document.documentKey, !favorite)}>
        <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
      </button>
      <BookListMenu name={document.displayName} actions={[
        { label: '打开', onSelect: () => onReopenDocument(document) },
        { label: favorite ? '取消收藏' : '收藏', onSelect: () => onToggleFavorite(document.documentKey, !favorite) },
        { label: '定位文件', onSelect: () => onLocateFile(document) },
        { label: '管理标签', onSelect: () => onOpenTags?.() },
        { label: '从最近记录移除', onSelect: () => removeDocuments([document]) },
      ]} />
    </div>;
  };

  const renderFileMain = (document: PersistedDocument) => (
    <div className="recent-workspace-file-main">
      <span className="pdf-file-icon" aria-hidden="true">
        <FileText size={16} />
      </span>
      <div>
        <strong data-testid="recent-workspace-document-name" title={document.displayName}>
          {document.displayName}
        </strong>
        <span title={document.path ?? (document.documentKey.startsWith('paper:') ? '本地文献库' : '本地浏览器文件')}>{getDirectoryPath(document.path, document.documentKey)}</span>
      </div>
    </div>
  );

  const renderCard = (document: PersistedDocument) => (
    <article
      key={document.documentKey}
      className="recent-workspace-card"
      data-testid="recent-workspace-document"
    >
      <label className="recent-selection">
        <input
          type="checkbox"
          aria-label={`选择 ${document.displayName}`}
          checked={selectedDocumentKeys.has(document.documentKey)}
          onChange={(event) => toggleDocumentSelection(document.documentKey, event.target.checked)}
        />
      </label>
      {renderFileMain(document)}
      <div className="recent-workspace-meta">
        <span>{formatDateTime(document.lastOpenedAt ?? document.modifiedAt)}</span>
        <span>{formatPageProgress(document)}</span>
      </div>
      {renderProgress(document)}
      {renderTags(document)}
      {renderActions(document)}
    </article>
  );

  const renderTable = () => (
    <div data-testid="recent-workspace-results">
      <BookList label="最近文件列表"
        items={page.items.map((document) => ({ ...documentBookItem(document, papersByKey?.get(document.documentKey)), favorite: favoriteDocumentKeys.has(document.documentKey) }))}
        columns={['selection', 'name', 'authors', 'journal', 'path', 'opened', 'progress', 'page', 'tags', 'actions']}
        rowTestId="recent-workspace-document" nameTestId="recent-workspace-document-name"
        selection={{ selectedKeys: selectedDocumentKeys, selectPageLabel: '选择当前页全部文件',
          onChange: (item, selected) => toggleDocumentSelection(item.key, selected),
          onSelectPage: (selected) => setSelectedDocumentKeys((previous) => {
            const next = new Set(previous);
            for (const document of page.items) selected ? next.add(document.documentKey) : next.delete(document.documentKey);
            return next;
          }) }}
        onOpen={(item) => void onReopenDocument(item.source)}
        renderTags={(item) => renderTags(item.source, true)} renderActions={(item) => renderActions(item.source)}
        pagination={page.pagination} />
      {visibleDocuments.length > page.items.length ? <button type="button" className="text-link-button"
        onClick={() => toggleVisibleSelection(!allVisibleSelected)}>
        {allVisibleSelected ? '取消选择全部筛选结果' : `选择全部 ${visibleDocuments.length} 条筛选结果`}
      </button> : null}
    </div>
  );

  const renderConfirmDialog = () => {
    if (!confirmDialog) {
      return null;
    }

    const clearHistory = confirmDialog === 'clear';
    const title = clearHistory ? '清空历史记录' : '批量移出最近';
    const message = clearHistory
      ? '仅清空最近文件列表，不会删除本地文件、收藏、标签、书签或批注。'
      : `将 ${selectedDocuments.length} 个文件移出最近列表，不会删除文件本体。`;

    return (
      <div className="tag-dialog-backdrop">
        <div className="tag-dialog recent-confirm-dialog" role="dialog" aria-labelledby="recent-dialog-title">
          <header>
            <h2 id="recent-dialog-title">{title}</h2>
          </header>
          <p>{message}</p>
          <footer>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setConfirmDialog(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => {
                if (clearHistory) {
                  void onClearRecentDocuments?.();
                  setSelectedDocumentKeys(new Set());
                } else {
                  removeDocuments(selectedDocuments);
                }
                setConfirmDialog(null);
              }}
            >
              {clearHistory ? '确认清空' : '确认移出'}
            </button>
          </footer>
        </div>
      </div>
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
        <div className="recent-workspace-layout">
          <div className="recent-workspace-main">
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
                  onChange={(event) => setSortMode(event.target.value as RecentSortMode)}
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
                  onChange={(event) => setProgressFilter(event.target.value as RecentProgressFilter)}
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
                  onChange={(event) => setTagFilter(event.target.value as RecentTagFilter)}
                >
                  <option value="all">全部标签</option>
                  <option value="untagged">未绑定标签</option>
                  {tagOptions.map((option) => (
                    <option key={option.tag.id} value={option.tag.id}>
                      {option.tag.name} ({option.count})
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
                <span>收藏状态筛选</span>
                <select
                  value={favoriteFilter}
                  aria-label="收藏状态筛选"
                  onChange={(event) => setFavoriteFilter(event.target.value as RecentFavoriteFilter)}
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
              <button
                type="button"
                className="text-link-button danger"
                onClick={() => setConfirmDialog('clear')}
              >
                清空历史记录
              </button>
            </div>

            {selectedDocuments.length > 0 ? (
              <div className="recent-batch-bar">
                <span>已选择 {selectedDocuments.length} 个文件</span>
                {selectedOutsidePage ? <span>其中 {selectedOutsidePage} 个不在当前显示范围</span> : null}
                <select
                  value={batchTagId}
                  aria-label="批量选择标签"
                  onChange={(event) => setBatchTagId(event.target.value)}
                >
                  <option value="">选择标签</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedBatchTag}
                  onClick={() => handleBatchTagChange(true)}
                >
                  批量绑定标签
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedBatchTag}
                  onClick={() => handleBatchTagChange(false)}
                >
                  批量移除标签
                </button>
                <button
                  type="button"
                  className="secondary-button danger"
                  onClick={() => setConfirmDialog('batchRemove')}
                >
                  批量移出最近
                </button>
              </div>
            ) : null}

            {visibleDocuments.length > 0 ? (
              viewMode === 'cards' ? (
                <div className="recent-workspace-grid" data-testid="recent-workspace-results">
                  {visibleDocuments.map(renderCard)}
                </div>
              ) : (
                renderTable()
              )
            ) : (
              <div className="empty-block">
                <strong>没有匹配的最近文件</strong>
                <span>调整关键词或筛选条件后再试。</span>
              </div>
            )}
          </div>

          <aside className="recent-workspace-aside" aria-label="最近文件辅助信息">
            <section>
              <header>
                <h3>最近活动</h3>
                <button type="button" className="text-link-button" onClick={() => onOpenTags?.()}>
                  管理标签
                </button>
              </header>
              {activities.length > 0 ? (
                <ol className="recent-activity-list">
                  {activities.map((item) => (
                    <li key={item.id} data-tone={item.tone}>
                      <span />
                      <div>
                        <strong>{item.description}</strong>
                        <p>{item.title}</p>
                        <small>{formatDateTime(item.time)}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="recent-aside-empty">暂无最近活动</p>
              )}
            </section>
            <section>
              <h3>快速操作</h3>
              <button type="button" className="secondary-button" onClick={() => void onOpenPdf()}>
                打开本地 PDF
              </button>
              <button type="button" className="secondary-button" onClick={() => onOpenTags?.()}>
                管理标签
              </button>
              <button
                type="button"
                className="secondary-button danger"
                aria-label="快速清空历史记录"
                onClick={() => setConfirmDialog('clear')}
              >
                <Trash2 size={15} />
                清空历史记录
              </button>
            </section>
            <section>
              <h3>本地统计</h3>
              <dl className="recent-stats-grid">
                <div>
                  <dt>最近文件</dt>
                  <dd>{stats.recentCount}</dd>
                </div>
                <div>
                  <dt>收藏文件</dt>
                  <dd>{stats.favoriteCount}</dd>
                </div>
                <div>
                  <dt>已标标签</dt>
                  <dd>{stats.taggedCount}</dd>
                </div>
                <div>
                  <dt>已读完</dt>
                  <dd>{stats.completedCount}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      ) : (
        <div className="empty-block recent-workspace-empty">
          <strong>暂无最近文件</strong>
          <span>打开 PDF 后会显示在这里。</span>
          <button type="button" className="primary-button" onClick={() => void onOpenPdf()}>
            打开文件
          </button>
        </div>
      )}

      {renderConfirmDialog()}
    </section>
  );
}
