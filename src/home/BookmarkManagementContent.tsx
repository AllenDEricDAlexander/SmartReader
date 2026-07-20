import { useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import { BookmarkDetailPanel } from './BookmarkDetailPanel';
import {
  BookmarkConfirmDialog,
  BookmarkEditorDialog,
} from './BookmarkEditorDialog';
import { BookmarkGroupList } from './BookmarkGroupList';
import { BookmarkToolbar } from './BookmarkToolbar';
import {
  buildBookmarkReference,
  findAdjacentBookmarks,
  findSelectionAfterDelete,
  flattenBookmarkDashboard,
  type BookmarkDeleteResult,
  type BookmarkManagementRecord,
  type BookmarkUpdateInput,
} from './bookmarkManagementUtils';
import { useBookmarkManagement } from './useBookmarkManagement';

type DeleteConfirmation =
  | { kind: 'single'; bookmarks: BookmarkManagementRecord[] }
  | { kind: 'batch'; bookmarks: BookmarkManagementRecord[] };

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
  canOpenBookmark,
  onOpenPdf,
  onOpenBookmark,
  onUpdateBookmark,
  onDeleteBookmarks,
  onRefresh,
  onClose,
}: BookmarkManagementContentProps) {
  const records = useMemo(() => flattenBookmarkDashboard(dashboard), [dashboard]);
  const management = useBookmarkManagement({ records });
  const [editor, setEditor] = useState<{
    bookmark: BookmarkManagementRecord;
    initialFocus: 'title' | 'note';
  } | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{
    tone: 'status' | 'alert';
    message: string;
  } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const selectedBatchBookmarks = records.filter(
    (record) => record.id != null && management.selectedBatchIds.has(record.id),
  );
  const adjacent =
    management.selectedBookmark?.id == null
      ? { previous: null, next: null }
      : findAdjacentBookmarks(records, management.selectedBookmark.id);
  const openEditor = (
    bookmark: BookmarkManagementRecord,
    initialFocus: 'title' | 'note',
  ) => {
    setEditor({ bookmark, initialFocus });
    setEditorError(null);
  };
  const saveEditor = async (updates: BookmarkUpdateInput) => {
    if (!editor) {
      return;
    }
    setEditorSaving(true);
    setEditorError(null);
    try {
      await onUpdateBookmark(editor.bookmark, updates);
      setEditor(null);
    } catch {
      setEditorError('书签保存失败，请重试。');
    } finally {
      setEditorSaving(false);
    }
  };
  const copyReference = async (bookmark: BookmarkManagementRecord) => {
    setCopyStatus(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(buildBookmarkReference(bookmark));
      setCopyStatus({ tone: 'status', message: '引用已复制' });
    } catch {
      setCopyStatus({ tone: 'alert', message: '复制引用失败，请重试。' });
    }
  };
  const requestSingleDelete = (bookmark: BookmarkManagementRecord) => {
    setDeleteError(null);
    setDeleteConfirmation({ kind: 'single', bookmarks: [bookmark] });
  };
  const confirmDelete = async () => {
    if (!deleteConfirmation) {
      return;
    }

    const target = deleteConfirmation;
    const fallbackId =
      target.kind === 'single' && target.bookmarks[0].id != null
        ? findSelectionAfterDelete(
            management.derived.allMatchingBookmarks,
            target.bookmarks[0].id,
          )
        : null;
    setDeleteBusy(true);
    setDeleteError(null);
    setDeleteStatus(null);

    try {
      const result = await onDeleteBookmarks(target.bookmarks);
      if (target.kind === 'single') {
        const id = target.bookmarks[0].id;
        if (id != null && result.succeededIds.includes(id)) {
          management.setSelectedBookmarkId(fallbackId);
          setDeleteConfirmation(null);
        } else {
          setDeleteError('删除书签失败，请重试。');
        }
        return;
      }

      management.setSelectedBatchIds(new Set(result.failedIds));
      setDeleteStatus(
        `批量删除完成：成功 ${result.succeededIds.length} 条，失败 ${result.failedIds.length} 条`,
      );
      setDeleteConfirmation(null);
      if (result.failedIds.length === 0) {
        management.setBatchMode(false);
      }
    } catch {
      setDeleteError(
        target.kind === 'single'
          ? '删除书签失败，请重试。'
          : '批量删除失败，所选书签未发生变化。',
      );
    } finally {
      setDeleteBusy(false);
    }
  };
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
        {management.batchMode ? (
          <BookmarkBatchToolbar
            selectedCount={selectedBatchBookmarks.length}
            onRequestDelete={() =>
              setDeleteConfirmation({
                kind: 'batch',
                bookmarks: selectedBatchBookmarks,
              })
            }
          />
        ) : null}
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
              canOpenBookmark={canOpenBookmark}
              onOpenBookmark={(bookmark) => void onOpenBookmark(bookmark)}
              onEditBookmark={(bookmark) => openEditor(bookmark, 'title')}
              onCopyBookmark={(bookmark) => void copyReference(bookmark)}
              onDeleteBookmark={requestSingleDelete}
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
        {copyStatus ? (
          <p className="bookmark-management-status" role={copyStatus.tone}>
            {copyStatus.message}
          </p>
        ) : null}
        {deleteStatus ? (
          <p className="bookmark-management-status" role="status">
            {deleteStatus}
          </p>
        ) : null}
        <div className="bookmark-management-layout">
          <main className="bookmark-management-main">{body}</main>
          <BookmarkDetailPanel
            bookmark={management.selectedBookmark}
            previous={adjacent.previous}
            next={adjacent.next}
            canOpen={
              management.selectedBookmark != null &&
              canOpenBookmark(management.selectedBookmark)
            }
            onClearSelection={() => management.setSelectedBookmarkId(null)}
            onNavigate={management.navigateToBookmark}
            onOpen={(bookmark) => void onOpenBookmark(bookmark)}
            onEdit={openEditor}
            onCopy={(bookmark) => void copyReference(bookmark)}
            onDelete={requestSingleDelete}
          />
        </div>
      </div>
      {editor ? (
        <BookmarkEditorDialog
          bookmark={editor.bookmark}
          initialFocus={editor.initialFocus}
          saving={editorSaving}
          error={editorError}
          onSave={(updates) => void saveEditor(updates)}
          onRequestClose={(dirty) => {
            if (dirty) {
              setDiscardConfirmOpen(true);
            } else {
              setEditor(null);
            }
          }}
        />
      ) : null}
      {editor && discardConfirmOpen ? (
        <BookmarkConfirmDialog
          title="放弃书签更改"
          message="当前名称或备注尚未保存。"
          confirmLabel="放弃更改"
          cancelLabel="继续编辑"
          danger
          onCancel={() => setDiscardConfirmOpen(false)}
          onConfirm={() => {
            setDiscardConfirmOpen(false);
            setEditor(null);
          }}
        />
      ) : null}
      {deleteConfirmation ? (
        <>
          <BookmarkConfirmDialog
            title={
              deleteConfirmation.kind === 'single'
                ? '删除书签'
                : '批量删除书签'
            }
            message={
              deleteConfirmation.kind === 'single'
                ? `确定删除“${deleteConfirmation.bookmarks[0].title}”吗？此操作不可撤销。`
                : `确定删除选中的 ${deleteConfirmation.bookmarks.length} 条书签吗？此操作不可撤销。`
            }
            confirmLabel={
              deleteConfirmation.kind === 'single' ? '确认删除' : '确认批量删除'
            }
            cancelLabel={
              deleteConfirmation.kind === 'single' ? '取消删除' : '取消批量删除'
            }
            danger
            busy={deleteBusy}
            onCancel={() => {
              setDeleteError(null);
              setDeleteConfirmation(null);
            }}
            onConfirm={() => void confirmDelete()}
          />
          {deleteError ? <p role="alert">{deleteError}</p> : null}
        </>
      ) : null}
    </section>
  );
}

function BookmarkBatchToolbar({
  selectedCount,
  onRequestDelete,
}: {
  selectedCount: number;
  onRequestDelete(): void;
}) {
  return (
    <div
      className="bookmark-management-batch-toolbar"
      role="region"
      aria-label="书签批量操作"
    >
      <strong>已选择 {selectedCount} 条书签</strong>
      <button type="button" disabled={selectedCount === 0} onClick={onRequestDelete}>
        批量删除 {selectedCount} 条书签
      </button>
    </div>
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
