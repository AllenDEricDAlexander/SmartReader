import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './paperPreview.css';

type LibraryDialogProps = {
  title: string;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
  onClose(): void;
};

const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LibraryDialog({ title, busy = false, wide = false, children, onClose }: LibraryDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog?.querySelector<HTMLElement>(focusableSelector))?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
    } else if (event.key === 'Tab') {
      const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) {
        event.preventDefault();
      } else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div className="library-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div ref={dialogRef} className={`library-dialog${wide ? ' library-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} onKeyDown={handleKeyDown}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}><X size={17} aria-hidden="true" /></button>
        </header>
        {children}
      </div>
    </div>, document.body,
  );
}
