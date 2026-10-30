import { describe, expect, it, vi } from 'vitest';
import type { ReaderPreferences } from './preferencesModels';
import { defaultReaderPreferences } from './preferencesStore';
import { loadStartupPreferences } from './startupPreferences';

describe('startup preferences', () => {
  it('waits for persisted preferences instead of exposing the default light theme', async () => {
    let resolve!: (preferences: ReaderPreferences) => void;
    const loadPreferences = vi.fn(() => new Promise<ReaderPreferences>((done) => { resolve = done; }));
    const ready = vi.fn();
    const loading = loadStartupPreferences({ loadPreferences }).then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    resolve({ ...defaultReaderPreferences, theme: 'eye-care' });
    await loading;
    expect(ready).toHaveBeenCalledWith({ preferences: { ...defaultReaderPreferences, theme: 'eye-care' }, error: null });
  });

  it('uses defaults on first launch and keeps read failures recoverable', async () => {
    const loadPreferences = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('database unavailable'));
    expect(await loadStartupPreferences({ loadPreferences })).toEqual({ preferences: defaultReaderPreferences, error: null });
    expect(await loadStartupPreferences({ loadPreferences })).toEqual({
      preferences: defaultReaderPreferences,
      error: '设置加载失败，暂时无法切换主题：database unavailable',
    });
  });
});
