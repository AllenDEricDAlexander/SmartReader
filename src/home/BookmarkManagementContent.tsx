import { useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import { BookmarkGroupList } from './BookmarkGroupList';
import { BookmarkToolbar } from './BookmarkToolbar';
import {
  flattenBookmarkDashboard,
  type BookmarkDeleteResult,
  type BookmarkManagementRecord,
  type BookmarkUpdateInput,
} from './bookmarkManagementUtils';
import { useBookmarkManagement } from './useBookmarkManagement';

export type BookmarkManagementContentProps = {
  dashboard: BookmarkDashboard | null;
  loading: boolean;
  error: string | null;
  canOpenBookmark(bookmark: BookmarkManagementRecord): boolean;
  onOpenPdf(): void | Promise<unknown>;
  onOpenBookmark(bookmark: BookmarkManagementRecord): void | Promise<void>;
  onUpdateBookmark(
    bookmark: BookmarkManagementRecord,
    updates: BookmarkUpdateInput,
  ): Promise<void>;
  onDeleteBookmarks(bookmarks: BookmarkManagementRecord[]): Promise<BookmarkDeleteResult>;
  onRefresh(): void | Promise<void>;
  onClose?: () => void;
};

export function BookmarkManagementContent({
  dashboard,
  loading,
  error,
  onOpenPdf,
  onRefresh,
  onClose,
}: BookmarkManagementContentProps) {
  const records = useMemo(() => flattenBookmarkDashboard(dashboard), [dashboard]);
  const management = useBookmarkManagement({ records });
  const heading = (
    <header className="bookmark-management-heading">
      <div>
        <h1>书签管理</h1>
        <p>统一管理所有文献中的书签，快速定位重要内容</p>
      </div>
      <div className="bookmark-management-heading-actions">
        <span className="bookmark-management-count">
          共 {dashboard?.totalBookmarks ?? 0} 个书签
        </span>
        {onClose ? (
          <button type="button" aria-label="返回首页" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  );

  let body: ReactNode;
  const filtering =
    management.query.trim() !== '' ||
    management.documentKey !== 'all' ||
    management.dateFilter !== 'all';

  if (!dashboard) {
    body = error ? (
      <BookmarkPageState role="alert">
        <strong>书签加载失败</strong>
        <p>{error}</p>
        <button type="button" onClick={() => void onRefresh()}>
          重试加载书签
        </button>
      </BookmarkPageState>
    ) : (
      <div className="bookmark-management-skeleton" aria-label="正在加载书签">
        <span />
        <span />
        <span />
      </div>
    );
  } else if (dashboard.totalBookmarks === 0) {
    body = (
      <BookmarkPageState>
        <strong>暂无书签</strong>
        <p>在阅读文献时添加书签后，可在这里统一管理</p>
        <button type="button" onClick={() => void onOpenPdf()}>
          打开文档添加书签
        </button>
      </BookmarkPageState>
    );
  } else {
    body = (
      <>
        <BookmarkToolbar
          query={management.query}
          documentKey={management.documentKey}
          dateFilter={management.dateFilter}
          sortMode={management.sortMode}
          pageSize={management.pageSize}
          density={management.density}
          documentOptions={management.documentOptions}
          filtering={filtering}
          batchMode={management.batchMode}
          onQueryChange={management.setQuery}
          onDocumentChange={management.setDocumentKey}
          onDateFilterChange={management.setDateFilter}
          onSortModeChange={management.setSortMode}
          onPageSizeChange={management.setPageSize}
          onDensityChange={management.setDensity}
          onClearFilters={management.clearFilters}
          onStartBatch={management.startBatchMode}
          onCancelBatch={management.cancelBatchMode}
        />
        <p className="bookmark-management-status">
          当前页 {management.derived.visibleBookmarks.length} 条，共{' '}
          {management.derived.totalBookmarks} 条书签
        </p>
        {management.derived.totalBookmarks === 0 ? (
          <BookmarkPageState>
            <strong>没有找到符合条件的书签</strong>
            <button type="button" onClick={management.clearFilters}>
              清除筛选
            </button>
          </BookmarkPageState>
        ) : (
          <>
            <BookmarkGroupList
              groups={management.derived.groups}
              density={management.density}
              expandedDocumentKeys={management.expandedDocumentKeys}
              selectedBookmarkId={management.selectedBookmarkId}
              batchMode={management.batchMode}
              selectedBatchIds={management.selectedBatchIds}
              allVisibleSelected={management.allVisibleSelected}
              pendingFocusId={management.pendingFocusId}
              onToggleDocument={management.toggleDocument}
              onSelectBookmark={management.selectBookmark}
              onToggleBatchSelection={management.toggleBatchSelection}
              onToggleVisibleBatchSelection={management.toggleVisibleBatchSelection}
              onPendingFocusHandled={() => management.setPendingFocusId(null)}
            />
            <BookmarkPagination
              page={management.page}
              pageCount={management.derived.pageCount}
              onPageChange={management.setPage}
            />
          </>
        )}
      </>
    );
  }

  return (
    <section
      className="bookmark-management-content"
      aria-label="书签管理"
      aria-busy={loading}
    >
      {heading}
      <div className="bookmark-management-body">
        {dashboard && error ? (
          <div className="bookmark-management-refresh-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void onRefresh()}>
              重新加载书签
            </button>
          </div>
        ) : null}
        <div className="bookmark-management-layout">
          <main className="bookmark-management-main">{body}</main>
          <aside className="bookmark-management-detail" aria-label="书签详情">
            请选择一条书签查看详情
          </aside>
        </div>
      </div>
    </section>
  );
}

function BookmarkPageState({
  children,
  role,
}: {
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className="bookmark-management-page-state" role={role}>
      {children}
    </div>
  );
}

function BookmarkPagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange(page: number): void;
}) {
  return (
    <nav className="bookmark-management-pagination" aria-label="书签分页">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </button>
      <span>
        第 {page} / {pageCount} 页
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
