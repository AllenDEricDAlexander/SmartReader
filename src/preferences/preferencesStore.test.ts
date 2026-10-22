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

  it('defaults restore scope and preserves stored restore scope', () => {
    expect(mergeReaderPreferences(null).restoreScope).toBe('all');
    expect(mergeReaderPreferences({ restoreScope: 'active' }).restoreScope).toBe('active');
  });

  it('defaults home display preferences for older settings and preserves saved choices', () => {
    expect(mergeReaderPreferences(null)).toMatchObject({
      homeWelcomeEnabled: true,
      homeRecentViewMode: 'list',
    });
    expect(mergeReaderPreferences({ homeWelcomeEnabled: false, homeRecentViewMode: 'cards' }))
      .toMatchObject({ homeWelcomeEnabled: false, homeRecentViewMode: 'cards' });
    expect(mergeReaderPreferences(JSON.parse('{"homeWelcomeEnabled":null,"homeRecentViewMode":"unknown"}')))
      .toMatchObject({ homeWelcomeEnabled: true, homeRecentViewMode: 'list' });
  });

  it.each(['light', 'dark', 'eye-care'] as const)('preserves the saved %s theme', (theme) => {
    expect(mergeReaderPreferences({ theme }).theme).toBe(theme);
  });

  it('uses the light theme for older or unsupported preferences', () => {
    expect(mergeReaderPreferences(null).theme).toBe('light');
    expect(mergeReaderPreferences(undefined).theme).toBe('light');
    expect(mergeReaderPreferences({ sessionRestoreEnabled: false }).theme).toBe('light');
    expect(mergeReaderPreferences(JSON.parse('{"theme":"sepia"}')).theme).toBe('light');
    expect(mergeReaderPreferences(JSON.parse('{"theme":null}')).theme).toBe('light');
  });
});
