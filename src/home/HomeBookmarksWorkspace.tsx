import { BookMarked } from 'lucide-react';
import type { PersistedBookmarkRecord } from '../persistence/persistenceApi';
import { BookmarkActions } from '../reader/annotations/BookmarkActions';

type HomeBookmarksWorkspaceProps = {
  bookmarks: PersistedBookmarkRecord[];
  error: string | null;
  canOpenBookmark(bookmark: PersistedBookmarkRecord): boolean;
  onDeleteBookmark(bookmark: PersistedBookmarkRecord): void | Promise<void>;
  onOpenBookmark(bookmark: PersistedBookmarkRecord): void;
  onRenameBookmark(bookmark: PersistedBookmarkRecord, title: string): void | Promise<void>;
};

export function HomeBookmarksWorkspace({
  bookmarks,
  error,
  canOpenBookmark,
  onDeleteBookmark,
  onOpenBookmark,
  onRenameBookmark,
}: HomeBookmarksWorkspaceProps) {
  return (
    <section className="home-panel home-bookmarks-workspace" aria-label="书签管理">
      <div className="section-heading horizontal">
        <div>
          <p>Bookmarks</p>
          <h2>书签管理</h2>
        </div>
        <span className="recent-workspace-count">共 {bookmarks.length} 条书签</span>
      </div>
      <section className="tool-panel home-embedded-tool-panel">
        <div className="panel-title">
          <BookMarked size={18} />
          <h3>全部书签</h3>
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
                      {bookmark.documentDisplayName ?? bookmark.documentKey} · 第 {bookmark.page} 页
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
    </section>
  );
}
