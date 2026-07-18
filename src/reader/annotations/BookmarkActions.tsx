import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Bookmark } from '../../annotations/annotationModels';

type BookmarkActionsProps = {
  bookmark: Bookmark;
  onDelete(bookmark: Bookmark): void | Promise<void>;
  onRename(bookmark: Bookmark, title: string): void | Promise<void>;
};

export function BookmarkActions({ bookmark, onDelete, onRename }: BookmarkActionsProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(bookmark.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setTitle(bookmark.title);
    }
  }, [bookmark.title, editing]);

  if (bookmark.id === null) {
    return null;
  }

  const cancelRename = () => {
    setEditing(false);
    setTitle(bookmark.title);
    setError(null);
  };

  const saveRename = async () => {
    const normalizedTitle = title.trim();

    if (!normalizedTitle || normalizedTitle === bookmark.title) {
      cancelRename();
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onRename(bookmark, normalizedTitle);
      setEditing(false);
    } catch {
      setError('书签重命名失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const deleteBookmark = async () => {
    setSaving(true);
    setError(null);

    try {
      await onDelete(bookmark);
    } catch {
      setError('书签删除失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bookmark-actions">
      {editing ? (
        <div className="bookmark-rename">
          <input
            aria-label={`重命名书签 ${bookmark.title}`}
            value={title}
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveRename();
              }

              if (event.key === 'Escape') {
                cancelRename();
              }
            }}
          />
          <button
            type="button"
            aria-label={`保存书签名称 ${bookmark.title}`}
            disabled={saving || !title.trim()}
            onClick={() => void saveRename()}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label={`取消重命名书签 ${bookmark.title}`}
            disabled={saving}
            onClick={cancelRename}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-label={`重命名书签 ${bookmark.title}`}
            disabled={saving}
            onClick={() => {
              setEditing(true);
              setError(null);
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="compact-danger"
            aria-label={`删除书签 ${bookmark.title}`}
            disabled={saving}
            onClick={() => void deleteBookmark()}
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
      {error ? (
        <span className="bookmark-action-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
