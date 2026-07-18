import { BookMarked, X } from 'lucide-react';
import type { PersistedBookmarkRecord } from '../persistence/persistenceApi';
import { BookmarkActions } from '../reader/annotations/BookmarkActions';

type BookmarkManagerWorkspaceProps = {
  bookmarks: PersistedBookmarkRecord[];
  error: string | null;
  canOpenBookmark(bookmark: PersistedBookmarkRecord): boolean;
  onClose(): void;
  onDeleteBookmark(bookmark: PersistedBookmarkRecord): void | Promise<void>;
  onOpenBookmark(bookmark: PersistedBookmarkRecord): void;
  onRenameBookmark(bookmark: PersistedBookmarkRecord, title: string): void | Promise<void>;
};

export function BookmarkManagerWorkspace({
  bookmarks,
  error,
  canOpenBookmark,
  onClose,
  onDeleteBookmark,
  onOpenBookmark,
  onRenameBookmark,
}: BookmarkManagerWorkspaceProps) {
  return (
    <section className="tool-workspace" aria-label="书签管理工作区">
      <header className="workspace-header">
        <div>
          <p>Bookmarks</p>
          <h1>书签</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        <section className="tool-panel">
          <div className="panel-title">
            <BookMarked size={18} />
            <h2>全部书签</h2>
          </div>
          {error ? (
            <p className="muted-copy" role="status">
              {error}
            </p>
          ) : bookmarks.length > 0 ? (
            <div className="workspace-list">
              {bookmarks.map((bookmark) => {
                const canOpen = canOpenBookmark(bookmark);

                return (
                  <article
                    key={bookmark.id ?? `${bookmark.documentKey}:${bookmark.page}:${bookmark.title}`}
                    className="workspace-list-item"
                  >
                    <button
                      type="button"
                      className="workspace-list-row"
                      disabled={!canOpen}
                      onClick={() => onOpenBookmark(bookmark)}
                    >
                      <strong>{bookmark.title}</strong>
                      <span>
                        {bookmark.documentDisplayName ?? bookmark.documentKey} · 第 {bookmark.page}{' '}
                        页
                      </span>
                    </button>
                    <BookmarkActions
                      bookmark={bookmark}
                      onDelete={onDeleteBookmark}
                      onRename={onRenameBookmark}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted-copy">暂无书签。阅读 PDF 时添加书签后会显示在这里。</p>
          )}
        </section>
      </div>
    </section>
  );
}
