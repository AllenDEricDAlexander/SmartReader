import { Palette } from 'lucide-react';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { themeOptions } from '../preferences/themeOptions';

type AppearanceSettingsProps = {
  preferences: ReaderPreferences;
  onChange(preferences: ReaderPreferences): void;
};

export function AppearanceSettings({ preferences, onChange }: AppearanceSettingsProps) {
  return (
    <section className="settings-card" aria-labelledby="appearance-title">
      <div className="panel-title">
        <Palette size={16} />
        <h2 id="appearance-title">外观</h2>
      </div>
      <div className="settings-field">
        <span>界面主题</span>
        <div className="segmented-control three" role="group" aria-label="界面主题">
          {themeOptions.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={preferences.theme === id ? 'active' : undefined}
              aria-pressed={preferences.theme === id}
              onClick={() => onChange({ ...preferences, theme: id })}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <span>统一应用于软件页面和 PDF 阅读页面，保存设置后生效。</span>
      </div>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={preferences.homeWelcomeEnabled}
          onChange={(event) =>
            onChange({ ...preferences, homeWelcomeEnabled: event.target.checked })
          }
        />
        <span>
          <strong>进入首页时显示欢迎语</strong>
          <small>关闭首页欢迎语后，可在这里重新开启，保存设置后生效。</small>
        </span>
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={preferences.homeQuickTipsEnabled}
          onChange={(event) =>
            onChange({ ...preferences, homeQuickTipsEnabled: event.target.checked })
          }
        />
        <span>
          <strong>首页显示快速上手</strong>
          <small>关闭快速上手卡片后，可在这里重新开启，保存设置后生效。</small>
        </span>
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={preferences.homeDesktopIntegrationEnabled}
          onChange={(event) =>
            onChange({ ...preferences, homeDesktopIntegrationEnabled: event.target.checked })
          }
        />
        <span>
          <strong>首页显示桌面集成</strong>
          <small>关闭桌面集成卡片后，可在这里重新开启，保存设置后生效。</small>
        </span>
      </label>
    </section>
  );
}
