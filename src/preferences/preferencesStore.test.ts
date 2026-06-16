import { describe, expect, it } from 'vitest';
import { defaultReaderPreferences, mergeReaderPreferences } from './preferencesStore';

describe('preferencesStore', () => {
  it('merges stored preferences over defaults', () => {
    expect(
      mergeReaderPreferences({
        sessionRestoreEnabled: false,
        defaultZoomMode: 'fit-page',
        shortcuts: { 'file.open': 'Meta+Shift+O' },
      }),
    ).toEqual({
      ...defaultReaderPreferences,
      sessionRestoreEnabled: false,
      defaultZoomMode: 'fit-page',
      shortcuts: {
        ...defaultReaderPreferences.shortcuts,
        'file.open': 'Meta+Shift+O',
      },
    });
  });
});
