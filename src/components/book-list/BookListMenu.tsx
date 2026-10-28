import { MoreVertical } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type BookListMenuAction = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  checked?: boolean;
  keepOpen?: boolean;
  onSelect(): void | Promise<void>;
};

export function BookListMenu({ name, actions, disabled = false, triggerLabel, icon }: {
  name: string; actions: BookListMenuAction[]; disabled?: boolean; triggerLabel?: string; icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    const top = anchor.bottom + bounds.height + 4 > window.innerHeight ? Math.max(4, anchor.top - bounds.height - 4) : anchor.bottom + 4;
    const left = Math.max(4, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 4));
    setPosition((current) => current.top === top && current.left === left ? current : { top, left });
  }, [open, actions]);

  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const index = Math.max(0, items.findIndex((item) => item === document.activeElement));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return <>
    <button type="button" ref={trigger} className="icon-button" aria-label={triggerLabel ?? `更多操作 ${name}`}
      aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      {icon ?? <MoreVertical size={16} />}
    </button>
    {open ? createPortal(<div ref={menu} className="book-list-menu" role="menu" onKeyDown={onKeyDown} style={position}>
      {actions.map((action, index) => <button key={`${action.label}:${index}`} type="button" role={action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-label={action.ariaLabel} aria-checked={action.checked} disabled={action.disabled}
        onClick={() => { if (!action.keepOpen) setOpen(false); void action.onSelect(); }}>{action.checked ? '✓ ' : ''}{action.label}</button>)}
    </div>, document.body) : null}
  </>;
}
