import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

type CheckUpdatesButtonProps = {
  onCheckUpdates?(): void | Promise<void>;
};

export function CheckUpdatesButton({ onCheckUpdates }: CheckUpdatesButtonProps) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const checkUpdates = async () => {
    if (!onCheckUpdates) {
      setMessage('当前版本暂未接入自动检查更新。');
      return;
    }

    setChecking(true);
    setMessage(null);
    try {
      await onCheckUpdates();
    } catch {
      setMessage('检查更新失败，请重试。');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="update-check">
      <button type="button" disabled={checking} onClick={() => void checkUpdates()}>
        <RefreshCw size={14} />
        {checking ? '正在检查更新…' : '检查更新'}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
