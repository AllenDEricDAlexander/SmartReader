import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type CheckUpdatesButtonProps = {
  onCheckUpdates?(): void | Promise<void>;
  placement?: 'status-bar';
};

export function CheckUpdatesButton({ onCheckUpdates, placement }: CheckUpdatesButtonProps) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const showResult = useRef(false);
  const inStatusBar = placement === 'status-bar';

  const dismiss = () => {
    showResult.current = false;
    setMessage(null);
  };

  useEffect(() => {
    if (!inStatusBar || (!message && !checking)) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', dismiss);
    };
  }, [checking, inStatusBar, message]);

  const checkUpdates = async () => {
    if (checking) return;
    showResult.current = true;
    if (!onCheckUpdates) {
      setMessage('当前版本暂未接入自动检查更新。');
      return;
    }

    setChecking(true);
    setMessage(null);
    try {
      await onCheckUpdates();
    } catch {
      if (showResult.current) setMessage('检查更新失败，请重试。');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div ref={containerRef} className={inStatusBar ? 'update-check status-update-check' : 'update-check'}
      onBlur={(event) => {
        if (inStatusBar && !event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}>
      <button type="button" disabled={checking && !inStatusBar} aria-disabled={checking && inStatusBar ? true : undefined}
        onClick={(event) => {
          if (inStatusBar) event.currentTarget.focus();
          void checkUpdates();
        }}>
        <RefreshCw size={14} aria-hidden="true" />
        {checking ? '正在检查更新…' : '检查更新'}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
