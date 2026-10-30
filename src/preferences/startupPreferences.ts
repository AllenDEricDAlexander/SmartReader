import type { PersistenceApi } from '../persistence/persistenceApi';
import type { ReaderPreferences } from './preferencesModels';
import { defaultReaderPreferences, mergeReaderPreferences } from './preferencesStore';

export type StartupPreferences = {
  preferences: ReaderPreferences;
  error: string | null;
};

export async function loadStartupPreferences(persistence: Pick<PersistenceApi, 'loadPreferences'>): Promise<StartupPreferences> {
  try {
    return { preferences: mergeReaderPreferences(await persistence.loadPreferences()), error: null };
  } catch (error) {
    return {
      preferences: defaultReaderPreferences,
      error: `设置加载失败，暂时无法切换主题：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
