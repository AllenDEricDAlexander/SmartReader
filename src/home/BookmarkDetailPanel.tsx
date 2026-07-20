import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatBookmarkFileSize,
  formatBookmarkPageProgress,
  type BookmarkManagementRecord,
} from './bookmarkManagementUtils';

type BookmarkDetailPanelProps = {
  bookmark: BookmarkManagementRecord | null;
  previous: BookmarkManagementRecord | null;
  next: BookmarkManagementRecord | null;
  canOpen: boolean;
  onClearSelection(): void;
  onNavigate(bookmark: BookmarkManagementRecord): void;
  onOpen(bookmark: BookmarkManagementRecord): void;
  onEdit(bookmark: BookmarkManagementRecord, initialFocus: 'title' | 'note'): void;
  onCopy(bookmark: BookmarkManagementRecord): void;
  onDelete(bookmark: BookmarkManagementRecord): void;
};

export function BookmarkDetailPanel({
  bookmark,
  previous,
  next,
  canOpen,
  onClearSelection,
  onNavigate,
  onOpen,
  onEdit,
  onCopy,
  onDelete,
}: BookmarkDetailPanelProps) {
  if (!bookmark) {
    return (
      <aside className="bookmark-management-detail" aria-label="书签详情">
        请选择一条书签查看详情
      </aside>
    );
  }

  const displayName = bookmark.documentDisplayName ?? bookmark.documentKey;
  const progress = formatBookmarkPageProgress(bookmark);

  return (
    <aside className="bookmark-management-detail" aria-label="书签详情">
      <header>
        <div>
          <span>书签详情</span>
          <h2>{bookmark.title}</h2>
        </div>
        <button type="button" aria-label="关闭书签详情" onClick={onClearSelection}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <section className="bookmark-management-page-preview">
        <FileText size={28} aria-hidden="true" />
        <strong>{progress.pageLabel}</strong>
        {progress.ratioLabel ? <span>{progress.ratioLabel}</span> : null}
        {progress.percent != null ? (
          <progress
            aria-label={`书签页码进度 ${progress.percent}%`}
            max={100}
            value={progress.percent}
          />
        ) : null}
      </section>

      <section className="bookmark-management-detail-card">
        <h3>书签内容</h3>
        <strong>{bookmark.title}</strong>
        <p>{bookmark.note || '—'}</p>
      </section>

      <section className="bookmark-management-detail-card">
        <h3>所属文档</h3>
        <strong>{displayName}</strong>
        <p>{bookmark.documentPath ?? '路径未知'}</p>
        <dl>
          <div>
            <dt>文件大小</dt>
            <dd>{formatBookmarkFileSize(bookmark.documentFileSize)}</dd>
          </div>
          <div>
            <dt>总页数</dt>
            <dd>{bookmark.documentPageCount ?? '—'}</dd>
          </div>
        </dl>
        {bookmark.documentMissing ? (
          <p className="bookmark-management-missing">源文件不可用</p>
        ) : null}
        <button
          type="button"
          aria-label={`打开文档 ${displayName}`}
          disabled={!canOpen}
          onClick={() => onOpen(bookmark)}
        >
          <ExternalLink size={16} aria-hidden="true" />
          打开文档
        </button>
      </section>

      <section className="bookmark-management-detail-card">
        <h3>章节位置</h3>
        <p>未识别章节</p>
      </section>

      <nav className="bookmark-management-neighbors" aria-label="相邻书签">
        <button
          type="button"
          aria-label={
            previous ? `上一条书签 ${previous.title}` : '没有上一条书签'
          }
          disabled={!previous}
          onClick={() => previous && onNavigate(previous)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          上一条
        </button>
        <button
          type="button"
          aria-label={next ? `下一条书签 ${next.title}` : '没有下一条书签'}
          disabled={!next}
          onClick={() => next && onNavigate(next)}
        >
          下一条
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>

      <section className="bookmark-management-quick-actions" aria-label="快捷操作">
        <button
          type="button"
          aria-label={`跳转到书签 ${bookmark.title}`}
          disabled={!canOpen}
          onClick={() => onOpen(bookmark)}
        >
          <ExternalLink size={16} aria-hidden="true" />
          跳转到书签
        </button>
        <button
          type="button"
          aria-label={`编辑备注 ${bookmark.title}`}
          onClick={() => onEdit(bookmark, 'note')}
        >
          <Pencil size={16} aria-hidden="true" />
          编辑备注
        </button>
        <button
          type="button"
          aria-label={`复制引用 ${bookmark.title}`}
          onClick={() => onCopy(bookmark)}
        >
          <Copy size={16} aria-hidden="true" />
          复制引用
        </button>
        <button
          type="button"
          aria-label={`删除书签 ${bookmark.title}`}
          onClick={() => onDelete(bookmark)}
        >
          <Trash2 size={16} aria-hidden="true" />
          删除书签
        </button>
      </section>
    </aside>
  );
}
