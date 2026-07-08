import {
  FileText,
  Grid2X2,
  List,
  MoreVertical,
  Search,
  Star,
  Tags,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
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
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [openTagEditorKey, setOpenTagEditorKey] = useState<string | null>(null);
  const [selectedDocumentKeys, setSelectedDocumentKeys] = useState<Set<string>>(() => new Set());
  const [batchTagId, setBatchTagId] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuItemRefs = useRef(new Map<string, Array<HTMLButtonElement | null>>());
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
        ),
        sortMode,
      ),
    [documents, favoriteDocumentKeys, favoriteFilter, progressFilter, query, sortMode, tagFilter],
  );
  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentKeys.has(document.documentKey)),
    [documents, selectedDocumentKeys],
  );
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
  const filtering =
    query.trim() !== '' ||
    progressFilter !== 'all' ||
    tagFilter !== 'all' ||
    favoriteFilter !== 'all';

  useEffect(() => {
    setSelectedDocumentKeys((previous) => {
      const validKeys = new Set(documents.map((document) => document.documentKey));
      const next = new Set([...previous].filter((key) => validKeys.has(key)));

      return sameSelectedKeys(previous, next) ? previous : next;
    });
  }, [documents]);

  useEffect(() => {
    if (!openMenuKey) {
      return;
    }

    menuItemRefs.current.get(openMenuKey)?.[0]?.focus();
  }, [openMenuKey]);

  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setTagFilter('all');
    setFavoriteFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const closeMenu = () => {
    setOpenMenuKey(null);
  };

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

  const renderTags = (document: PersistedDocument) => {
    const documentTags = document.tagIds
      .map((tagId) => tagsById.get(tagId))
      .filter((tag): tag is Tag => Boolean(tag));
    const tagEditorOpen = openTagEditorKey === document.documentKey;

    return (
      <div className="recent-tag-cell">
        <div className="recent-tag-list">
          {documentTags.length > 0 ? (
            documentTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="recent-tag-chip"
                style={{ '--recent-tag-color': tag.color } as CSSProperties}
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
          <button
            type="button"
            className="icon-button"
            aria-label={`编辑标签 ${document.displayName}`}
            aria-expanded={tagEditorOpen}
            onClick={() => setOpenTagEditorKey(tagEditorOpen ? null : document.documentKey)}
          >
            <Tags size={15} />
          </button>
          {tagEditorOpen ? (
            <div className="recent-tag-picker">
              {tags.length > 0 ? (
                tags.map((tag) => {
                  const selected = document.tagIds.includes(tag.id);

                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-label={`切换标签 ${tag.name}`}
                      aria-pressed={selected}
                      onClick={() => handleToggleDocumentTag(document, tag)}
                    >
                      <span style={{ background: tag.color }} />
                      {tag.name}
                    </button>
                  );
                })
              ) : (
                <span>暂无标签</span>
              )}
              <button type="button" className="text-link-button" onClick={() => onOpenTags?.()}>
                管理标签
              </button>
            </div>
          ) : null}
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
    const menuOpen = openMenuKey === document.documentKey;

    return (
      <div className="recent-workspace-actions">
        <button
          type="button"
          className="secondary-button"
          aria-label={`继续阅读 ${document.displayName}`}
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
                onClick={() => handleMenuAction(() => onReopenDocument(document))}
              >
                打开
              </button>
              <button
                type="button"
                ref={(element) => setMenuItemRef(document.documentKey, 1, element)}
                role="menuitem"
                onClick={() =>
                  handleMenuAction(() => onToggleFavorite(document.documentKey, !favorite))
                }
              >
                {favorite ? '取消收藏' : '收藏'}
              </button>
              <button
                type="button"
                ref={(element) => setMenuItemRef(document.documentKey, 2, element)}
                role="menuitem"
                onClick={() => handleMenuAction(() => onLocateFile(document))}
              >
                定位文件
              </button>
              <button
                type="button"
                ref={(element) => setMenuItemRef(document.documentKey, 3, element)}
                role="menuitem"
                onClick={() => handleMenuAction(() => onOpenTags?.())}
              >
                管理标签
              </button>
              <button
                type="button"
                ref={(element) => setMenuItemRef(document.documentKey, 4, element)}
                role="menuitem"
                onClick={() => handleMenuAction(() => removeDocuments([document]))}
              >
                从最近记录移除
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
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
        <span title={document.path ?? '本地浏览器文件'}>{getDirectoryPath(document.path)}</span>
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
    <div className="recent-workspace-table-wrap" data-testid="recent-workspace-results">
      <table className="recent-workspace-table">
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                aria-label="选择当前可见文件"
                checked={allVisibleSelected}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
                  }
                }}
                onChange={(event) => toggleVisibleSelection(event.target.checked)}
              />
            </th>
            <th scope="col">文件名</th>
            <th scope="col">本地路径</th>
            <th scope="col">最近打开</th>
            <th scope="col">阅读进度</th>
            <th scope="col">标签</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {visibleDocuments.map((document) => (
            <tr key={document.documentKey} data-testid="recent-workspace-document">
              <td>
                <input
                  type="checkbox"
                  aria-label={`选择 ${document.displayName}`}
                  checked={selectedDocumentKeys.has(document.documentKey)}
                  onChange={(event) =>
                    toggleDocumentSelection(document.documentKey, event.target.checked)
                  }
                />
              </td>
              <td>{renderFileMain(document)}</td>
              <td className="path-cell" title={document.path ?? '本地浏览器文件'}>
                {getDirectoryPath(document.path)}
              </td>
              <td>{formatDateTime(document.lastOpenedAt ?? document.modifiedAt)}</td>
              <td>
                <div className="recent-table-progress">
                  {renderProgress(document)}
                  <span>{formatPageProgress(document)}</span>
                </div>
              </td>
              <td>{renderTags(document)}</td>
              <td>{renderActions(document)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
