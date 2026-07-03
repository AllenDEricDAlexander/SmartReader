import { useEffect, useRef, type KeyboardEvent } from 'react';

type HomeActionNoticeProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?(): void;
  onClose(): void;
};

export function HomeActionNotice({
  title,
  message,
  confirmLabel,
  cancelLabel = '关闭',
  onConfirm,
  onClose,
}: HomeActionNoticeProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (confirmButtonRef.current ?? closeButtonRef.current)?.focus();

    return () => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;

      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const actions = [closeButtonRef.current, confirmButtonRef.current].filter(
      (action): action is HTMLButtonElement => Boolean(action),
    );

    if (actions.length === 0) {
      return;
    }

    event.preventDefault();
    const activeIndex = actions.indexOf(document.activeElement as HTMLButtonElement);
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    const nextIndex = event.shiftKey
      ? (currentIndex - 1 + actions.length) % actions.length
      : (currentIndex + 1) % actions.length;

    actions[nextIndex].focus();
  };

  return (
    <div className="home-notice-backdrop" role="presentation">
      <section
        className="home-action-notice"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="home-notice-actions">
          <button ref={closeButtonRef} type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          {onConfirm && confirmLabel ? (
            <button
              ref={confirmButtonRef}
              type="button"
              className="primary-action"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
