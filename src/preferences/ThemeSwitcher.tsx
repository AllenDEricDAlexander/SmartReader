import type { ReaderTheme } from './preferencesModels';
import { themeOptions } from './themeOptions';

type ThemeSwitcherProps = {
  theme: ReaderTheme;
  disabled?: boolean;
  onChange(theme: ReaderTheme): void;
};

export function ThemeSwitcher({ theme, disabled, onChange }: ThemeSwitcherProps) {
  const { Icon } = themeOptions.find((option) => option.id === theme) ?? themeOptions[1];

  return (
    <label className="theme-switcher" title="切换主题">
      <Icon size={16} aria-hidden="true" />
      <select
        aria-label="切换主题"
        value={theme}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ReaderTheme)}
      >
        {themeOptions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  );
}
