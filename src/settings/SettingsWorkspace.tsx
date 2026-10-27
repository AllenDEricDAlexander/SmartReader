import { RotateCcw, Save, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CommandId, CommandRegistry } from '../commands/commandRegistry';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import { CacheSettings } from './CacheSettings';
import { DesktopIntegrationSettings } from './DesktopIntegrationSettings';
import { SessionRestoreSettings } from './SessionRestoreSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { AiSettings } from './AiSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { AboutSettings } from './AboutSettings';
import type { HomeAppVersion } from '../home/homeTypes';
import type { CacheStats } from '../persistence/persistenceApi';
import { useResearch } from '../app/ResearchContext';

export type SettingsSection = 'appearance' | 'shortcuts' | 'cache' | 'desktop' | 'restore' | 'ai' | 'about';

type SettingsWorkspaceProps = {
  commandRegistry: CommandRegistry;
  preferences: ReaderPreferences;
  openSessionCount: number;
  recentDocumentCount: number;
  appVersion?: HomeAppVersion;
  cacheStats?: CacheStats;
  initialSection?: SettingsSection;
  navigationRequest?: number;
  saving?: boolean;
  onClose(): void;
  onSave(preferences: ReaderPreferences): void | Promise<void>;
};

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'cache', label: '缓存' },
  { id: 'about', label: '版本信息' },
  { id: 'desktop', label: '桌面集成' },
  { id: 'restore', label: '会话恢复' },
];

type PreferenceField = Exclude<keyof ReaderPreferences, 'shortcuts'>;

function preferenceFields(preferences: ReaderPreferences): PreferenceField[] {
  return (Object.keys(preferences) as Array<keyof ReaderPreferences>).filter((key): key is PreferenceField => key !== 'shortcuts');
}

function rebaseDraft(draft: ReaderPreferences, preferences: ReaderPreferences, edits: Map<string, number>): ReaderPreferences {
  const preserved = Object.fromEntries(preferenceFields(draft).filter((key) => edits.has(key)).map((key) => [key, draft[key]]));
  const shortcuts = { ...preferences.shortcuts };
  for (const key of Object.keys(draft.shortcuts) as CommandId[]) {
    if (edits.has(`shortcut:${key}`)) shortcuts[key] = draft.shortcuts[key];
  }
  return { ...preferences, ...preserved, shortcuts };
}

export function SettingsWorkspace({
  commandRegistry,
  preferences,
  openSessionCount,
  recentDocumentCount,
  appVersion = { version: '0.1.0', build: null },
  cacheStats,
  initialSection = 'shortcuts',
  navigationRequest = 0,
  saving,
  onClose,
  onSave,
}: SettingsWorkspaceProps) {
  const research = useResearch();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef(preferences);
  const editVersions = useRef(new Map<string, number>());
  const editVersion = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection, navigationRequest]);

  useEffect(() => {
    const next = rebaseDraft(draftRef.current, preferences, editVersions.current);
    draftRef.current = next;
    setDraftPreferences(next);
  }, [dirty, preferences]);

  const updateDraftPreferences = (nextPreferences: ReaderPreferences) => {
    const previous = draftRef.current;
    const version = ++editVersion.current;
    for (const key of preferenceFields(nextPreferences)) {
      if (nextPreferences[key] !== previous[key]) editVersions.current.set(key, version);
    }
    for (const key of Object.keys(nextPreferences.shortcuts) as CommandId[]) {
      if (nextPreferences.shortcuts[key] !== previous.shortcuts[key]) editVersions.current.set(`shortcut:${key}`, version);
    }
    setSaveError(null);
    setDirty(editVersions.current.size > 0);
    draftRef.current = nextPreferences;
    setDraftPreferences(nextPreferences);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const submitted = draftRef.current;
    const submittedVersions = new Map(editVersions.current);
    setSaveError(null);
    try {
      await onSave(submitted);
      for (const [key, version] of submittedVersions) {
        if (editVersions.current.get(key) === version) editVersions.current.delete(key);
      }
      setDirty(editVersions.current.size > 0);
    } catch (error) {
      setSaveError(error instanceof Error ? `设置保存失败：${error.message}` : '设置保存失败，请重试。');
    } finally {
      savingRef.current = false;
    }
  };

  const handleClose = () => {
    editVersions.current.clear();
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
          {[...sections, ...(research ? [{ id: 'ai' as const, label: 'AI 厂商' }] : [])].map((section) => (
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
            {activeSection !== 'ai' ? <>
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
            </> : null}
            <button type="button" aria-label="关闭设置" onClick={handleClose}>
              <X size={14} />
            </button>
          </div>
        </header>
        <div className="settings-content">
          {activeSection === 'about' ? <AboutSettings appVersion={appVersion} /> : null}
          {saveError ? <p className="settings-error" role="alert">{saveError}</p> : null}
          {activeSection === 'appearance' ? (
            <AppearanceSettings
              preferences={draftPreferences}
              onChange={updateDraftPreferences}
            />
          ) : null}
          {activeSection === 'ai' && research ? <AiSettings library={research.library} ai={research.ai} /> : null}
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
              cacheStats={cacheStats}
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
