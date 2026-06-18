import { Keyboard, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CommandRegistry } from '../commands/commandRegistry';
import type { ReaderPreferences } from '../preferences/preferencesModels';

type ShortcutSettingsProps = {
  commandRegistry: CommandRegistry;
  preferences: ReaderPreferences;
  onChange(preferences: ReaderPreferences): void;
};

export function ShortcutSettings({
  commandRegistry,
  preferences,
  onChange,
}: ShortcutSettingsProps) {
  const [editing, setEditing] = useState(false);
  const commands = commandRegistry.list();
  const conflicts = useMemo(() => {
    const byShortcut = new Map<string, string[]>();

    for (const command of commands) {
      const shortcut = preferences.shortcuts[command.id];

      if (!shortcut) {
        continue;
      }

      byShortcut.set(shortcut, [...(byShortcut.get(shortcut) ?? []), command.label]);
    }

    return [...byShortcut.entries()].filter(([, labels]) => labels.length > 1);
  }, [commands, preferences.shortcuts]);

  return (
    <section className="settings-card" aria-labelledby="shortcut-settings-title">
      <div className="settings-card-header">
        <div className="panel-title">
          <Keyboard size={16} />
          <h2 id="shortcut-settings-title">快捷键</h2>
        </div>
        <label className="inline-toggle">
          <input
            type="checkbox"
            checked={editing}
            onChange={(event) => setEditing(event.target.checked)}
          />
          编辑快捷键
        </label>
      </div>
      {conflicts.length === 0 ? (
        <p className="muted-copy">当前没有快捷键冲突。</p>
      ) : (
        <div className="settings-warning" role="status">
          <strong>快捷键冲突</strong>
          {conflicts.map(([shortcut, labels]) => (
            <span key={shortcut}>
              {shortcut}: {labels.join('、')}
            </span>
          ))}
        </div>
      )}
      <div className="shortcut-list">
        {commands.map((command) => (
          <label key={command.id} className="shortcut-row">
            <span>
              <strong>{command.label}</strong>
              <small>{command.id}</small>
            </span>
            <input
              aria-label={`${command.label} shortcut`}
              value={preferences.shortcuts[command.id] ?? ''}
              disabled={!editing}
              placeholder="未设置"
              onChange={(event) =>
                onChange({
                  ...preferences,
                  shortcuts: {
                    ...preferences.shortcuts,
                    [command.id]: event.target.value.trim() || null,
                  },
                })
              }
            />
            <button type="button" disabled={!editing} aria-label={`编辑 ${command.label}`}>
              <Pencil size={14} />
            </button>
          </label>
        ))}
      </div>
    </section>
  );
}
