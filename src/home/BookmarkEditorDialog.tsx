import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { X } from 'lucide-react';
import type {
  BookmarkManagementRecord,
  BookmarkUpdateInput,
} from './bookmarkManagementUtils';

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type BookmarkEditorDialogProps = {
  bookmark: BookmarkManagementRecord;
  initialFocus: 'title' | 'note';
  saving: boolean;
  error: string | null;
  onSave(updates: BookmarkUpdateInput): void;
  onRequestClose(dirty: boolean): void;
};

type BookmarkConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
};

export function BookmarkEditorDialog({
  bookmark,
  initialFocus,
  saving,
  error,
  onSave,
  onRequestClose,
}: BookmarkEditorDialogProps) {
  const [title, setTitle] = useState(bookmark.title);
  const [note, setNote] = useState(bookmark.note ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const dirty = title !== bookmark.title || note !== (bookmark.note ?? '');

  useEffect(() => {
    setTitle(bookmark.title);
    setNote(bookmark.note ?? '');
    setValidationError(null);
  }, [bookmark.id, bookmark.note, bookmark.title]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const target = initialFocus === 'title' ? titleRef.current : noteRef.current;
    target?.focus();
    return () => previousFocus?.focus();
  }, [initialFocus]);

  const requestClose = () => {
    if (!saving) {
      onRequestClose(dirty);
    }
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setValidationError('书签名称不能为空。');
      titleRef.current?.focus();
      return;
    }
    setValidationError(null);
    onSave({
      title: title.trim(),
      note: note.trim() || null,
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }
    trapDialogFocus(event, dialogRef.current);
  };

  return (
    <div className="bookmark-management-dialog-backdrop">
      <form
        ref={dialogRef}
        className="bookmark-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="编辑书签"
        aria-busy={saving}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
      >
        <header>
          <h2>编辑书签</h2>
          <button
            type="button"
            aria-label="关闭编辑书签"
            disabled={saving}
            onClick={requestClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <label>
          <span>书签名称</span>
          <input
            ref={titleRef}
            aria-label="书签名称"
            value={title}
            disabled={saving}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setValidationError(null);
            }}
          />
        </label>
        <label>
          <span>书签备注</span>
          <textarea
            ref={noteRef}
            aria-label="书签备注"
            value={note}
            disabled={saving}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>
        {validationError ? <p role="alert">{validationError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer className="bookmark-management-dialog-actions">
          <button type="button" disabled={saving} onClick={requestClose}>
            取消编辑
          </button>
          <button type="submit" disabled={saving}>
            保存书签
          </button>
        </footer>
      </form>
    </div>
  );
}

export function BookmarkConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: BookmarkConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) {
        onCancel();
      }
      return;
    }
    trapDialogFocus(event, dialogRef.current);
  };

  return (
    <div className="bookmark-management-dialog-backdrop">
      <div
        ref={dialogRef}
        className="bookmark-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy}
        onKeyDown={handleKeyDown}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <footer className="bookmark-management-dialog-actions">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'bookmark-management-danger-action' : undefined}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

function trapDialogFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
) {
  if (event.key !== 'Tab' || !container) {
    return;
  }

  const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)];
  if (focusable.length === 0) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
