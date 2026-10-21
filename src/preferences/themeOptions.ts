import { Leaf, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { ReaderTheme } from './preferencesModels';

export const themeOptions = [
  { id: 'dark', label: '暗色', Icon: Moon },
  { id: 'light', label: '亮色', Icon: Sun },
  { id: 'eye-care', label: '护眼色', Icon: Leaf },
] satisfies Array<{ id: ReaderTheme; label: string; Icon: LucideIcon }>;
