import { RotateCcw, Save, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CommandRegistry } from '../commands/commandRegistry';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { CacheSettings } from './CacheSettings';
import { DesktopIntegrationSettings } from './DesktopIntegrationSettings';
import { SessionRestoreSettings } from './SessionRestoreSettings';
import { ShortcutSettings } from './ShortcutSettings';

export type SettingsSection = 'shortcuts' | 'cache' | 'desktop' | 'restore';

type SettingsWorkspaceProps = {
  commandRegistry: CommandRegistry;
  preferences: ReaderPreferences;
  openSessionCount: number;
  recentDocumentCount: number;
  initialSection?: SettingsSection;
  saving?: boolean;
  onClose(): void;
  onSave(preferences: ReaderPreferences): void | Promise<void>;
};

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: 'shortcuts', label: '快捷键' },
  { id: 'cache', label: '缓存' },
  { id: 'desktop', label: '桌面集成' },
  { id: 'restore', label: '会话恢复' },
];

export function SettingsWorkspace({
  commandRegistry,
  preferences,
  openSessionCount,
  recentDocumentCount,
  initialSection = 'shortcuts',
  saving,
  onClose,
  onSave,
}: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (!dirty) {
      setDraftPreferences(preferences);
    }
  }, [dirty, preferences]);

  const updateDraftPreferences = (nextPreferences: ReaderPreferences) => {
    setDirty(true);
    setDraftPreferences(nextPreferences);
  };

  const handleSave = async () => {
    await onSave(draftPreferences);
    setDirty(false);
  };

  const handleClose = () => {
    setDirty(false);
    onClose();
  };

  return (
    <section className="settings-workspace" aria-label="设置工作区">
      <aside className="workspace-sidebar">
        <div className="brand-lockup">
          <Settings size={22} />
          <div>
            <strong>设置</strong>
            <span>阅读工作台偏好</span>
          </div>
        </div>
        <nav className="workspace-nav" aria-label="设置导航">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={section.id === activeSection ? 'active' : undefined}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="workspace-main">
        <header className="workspace-header">
          <div>
            <p>Settings</p>
            <h1>设置</h1>
          </div>
          <div className="workspace-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => updateDraftPreferences(defaultReaderPreferences)}
            >
              <RotateCcw size={14} />
              恢复默认
            </button>
            <button type="button" onClick={handleClose}>
              取消
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              <Save size={14} />
              保存设置
            </button>
            <button type="button" aria-label="关闭设置" onClick={handleClose}>
              <X size={14} />
            </button>
          </div>
        </header>
        <div className="settings-content">
          {activeSection === 'shortcuts' ? (
            <ShortcutSettings
              commandRegistry={commandRegistry}
              preferences={draftPreferences}
              onChange={updateDraftPreferences}
            />
          ) : null}
          {activeSection === 'cache' ? (
            <CacheSettings
              openSessionCount={openSessionCount}
              recentDocumentCount={recentDocumentCount}
            />
          ) : null}
          {activeSection === 'desktop' ? <DesktopIntegrationSettings /> : null}
          {activeSection === 'restore' ? (
            <SessionRestoreSettings
              preferences={draftPreferences}
              onChange={updateDraftPreferences}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
