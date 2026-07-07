import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import type { PersistenceApi } from '../persistence/persistenceApi';
import type { Tag, TagDashboard } from './tagModels';
import {
  filterTagRows,
  getDefaultTagId,
  paginateTagRows,
  sortTagRows,
  type TagSortKey,
} from './tagDashboardUtils';

type TagManagerProps = {
  persistence: Pick<
    PersistenceApi,
    'loadTagDashboard' | 'createTag' | 'renameTag' | 'deleteTag' | 'mergeTags'
  >;
  onTagsChange: Dispatch<SetStateAction<Tag[]>>;
  onClose(): void;
  onOpenDocument(
    documentKey: string,
    documentPath: string | null,
    page: number,
    missing: boolean,
  ): void;
};

export function TagManager({ persistence, onClose }: TagManagerProps) {
  const [dashboard, setDashboard] = useState<TagDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState('all');
  const [sortKey, setSortKey] = useState<TagSortKey>('usage');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextDashboard = await persistence.loadTagDashboard();
      setDashboard(nextDashboard);
      setSelectedTagId((current) => current ?? getDefaultTagId(nextDashboard.tags));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '标签看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [persistence]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const visibleRows = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    return sortTagRows(filterTagRows(dashboard.tags, query, color), sortKey);
  }, [color, dashboard, query, sortKey]);

  const pageRows = paginateTagRows(visibleRows, page, pageSize);
  const selectedDetail =
    dashboard?.details.find((detail) => detail.tag.id === selectedTagId) ??
    dashboard?.details[0] ??
    null;

  return (
    <section className="tag-dashboard-workspace" aria-label="标签管理工作区">
      <main className="tag-dashboard-main">
        <header className="tag-dashboard-heading">
          <h1>标签管理</h1>
        </header>
        {loading ? (
          <div className="tag-dashboard-state" role="status">
            <Loader2 size={18} />
            <span>正在加载标签看板...</span>
          </div>
        ) : error ? (
          <div className="tag-dashboard-state error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void loadDashboard()}>
              <RotateCcw size={14} />
              重试
            </button>
          </div>
        ) : dashboard ? (
          <div className="tag-dashboard-content">
            <div className="tag-dashboard-toolbar">
              <input
                aria-label="搜索标签名称或描述"
                placeholder="搜索标签名称或描述..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
              <select
                aria-label="颜色筛选"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              >
                <option value="all">全部颜色</option>
                {Array.from(new Set(dashboard.tags.map((tag) => tag.color))).map((tagColor) => (
                  <option key={tagColor} value={tagColor}>
                    {tagColor}
                  </option>
                ))}
              </select>
              <select
                aria-label="排序方式"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as TagSortKey)}
              >
                <option value="usage">使用次数</option>
                <option value="documents">关联文献</option>
                <option value="recent">最近使用</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setColor('all');
                  setSortKey('usage');
                  setPage(1);
                }}
              >
                清除筛选
              </button>
              <button type="button" className="tag-dashboard-primary">
                <Plus size={14} />
                创建标签
              </button>
            </div>
            <section className="tag-dashboard-card">
              <h2>标签概览</h2>
              <div className="tag-dashboard-overview-grid">
                <strong>{dashboard.overview.totalTags}</strong>
                <strong>{dashboard.overview.activeTags}</strong>
                <strong>{dashboard.overview.totalUsage}</strong>
                <strong>{dashboard.overview.orphanTags}</strong>
              </div>
            </section>
            <section className="tag-dashboard-card">
              <h2>标签云</h2>
              <div className="tag-cloud-list">
                {dashboard.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setSelectedTagId(tag.id)}
                    style={{ borderColor: tag.color, color: tag.color }}
                  >
                    {tag.name} <span>{tag.usageCount}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="tag-dashboard-card tag-table-card">
              <h2>全部标签（{visibleRows.length}）</h2>
              <div className="tag-dashboard-table" role="table">
                {pageRows.items.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="tag-dashboard-row"
                    onClick={() => setSelectedTagId(tag.id)}
                  >
                    <span style={{ backgroundColor: tag.color }} />
                    <strong>{tag.name}</strong>
                    <span>{tag.usageCount}</span>
                    <span>{tag.documentCount}</span>
                    <span>{tag.recentUsedAt ?? '暂无'}</span>
                    <span>{tag.description}</span>
                  </button>
                ))}
              </div>
              <div className="tag-dashboard-pagination">
                <span>共 {visibleRows.length} 条记录</span>
                <button
                  type="button"
                  disabled={pageRows.page <= 1}
                  onClick={() => setPage(pageRows.page - 1)}
                >
                  上一页
                </button>
                <span>
                  {pageRows.page} / {pageRows.totalPages}
                </span>
                <button
                  type="button"
                  disabled={pageRows.page >= pageRows.totalPages}
                  onClick={() => setPage(pageRows.page + 1)}
                >
                  下一页
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
      <aside className="tag-dashboard-detail-panel">
        <header>
          <h2>标签详情</h2>
          <button type="button" aria-label="关闭标签详情" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {selectedDetail ? <strong>{selectedDetail.tag.name}</strong> : <span>暂无标签</span>}
      </aside>
    </section>
  );
}
