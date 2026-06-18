import { RotateCcw } from 'lucide-react';
import type { ReaderPreferences } from '../preferences/preferencesModels';

type SessionRestoreSettingsProps = {
  preferences: ReaderPreferences;
  onChange(preferences: ReaderPreferences): void;
};

export function SessionRestoreSettings({
  preferences,
  onChange,
}: SessionRestoreSettingsProps) {
  return (
    <section className="settings-card" aria-labelledby="session-restore-title">
      <div className="panel-title">
        <RotateCcw size={16} />
        <h2 id="session-restore-title">会话恢复</h2>
      </div>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={preferences.sessionRestoreEnabled}
          onChange={(event) =>
            onChange({
              ...preferences,
              sessionRestoreEnabled: event.target.checked,
            })
          }
        />
        <span>
          <strong>启动时恢复上次阅读状态</strong>
          <small>保存打开的桌面文档、页码、缩放和侧栏状态。</small>
        </span>
      </label>
      <div className="settings-field">
        <span>恢复范围</span>
        <div className="segmented-control three" role="group" aria-label="恢复范围">
          <button
            type="button"
            className={preferences.restoreScope === 'active' ? 'active' : undefined}
            aria-pressed={preferences.restoreScope === 'active'}
            onClick={() =>
              onChange({
                ...preferences,
                restoreScope: 'active',
              })
            }
          >
            当前文档
          </button>
          <button
            type="button"
            className={preferences.restoreScope === 'all' ? 'active' : undefined}
            aria-pressed={preferences.restoreScope === 'all'}
            onClick={() =>
              onChange({
                ...preferences,
                restoreScope: 'all',
              })
            }
          >
            全部标签
          </button>
          <button type="button" disabled aria-disabled="true">
            最近项目
          </button>
        </div>
      </div>
    </section>
  );
}
