import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function ReaderDrawer({ id, title, icon, children, onClose }: {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onClose(): void;
}) {
  return (
    <aside id={id} className="reader-drawer" aria-labelledby={`${id}-title`} onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.stopPropagation();
        onClose();
      }
    }}>
      <header className="reader-drawer-header">
        <h2 id={`${id}-title`}>{icon}{title}</h2>
        <button type="button" className="toolbar-icon-button" aria-label={`关闭${title}`} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="reader-drawer-content">{children}</div>
    </aside>
  );
}
