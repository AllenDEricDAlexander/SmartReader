import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AiService } from '../ai/aiService';
import { emptyLibrary } from '../library/libraryModels';
import type { LibraryService, LibraryView } from '../library/libraryService';

export type ResearchServices = { library: LibraryService; ai: AiService };
export const ResearchContext = createContext<ResearchServices | null>(null);
export const useResearch = () => useContext(ResearchContext);

const unavailableView: LibraryView = {
  loaded: false, error: null, snapshot: emptyLibrary(), papers: [], lockedPaperIds: [], unlockedVaultIds: [],
};
const emptySubscribe = () => () => undefined;
const getUnavailableView = () => unavailableView;

export function useLibraryView(library?: LibraryService | null): LibraryView {
  return useSyncExternalStore(library?.subscribe ?? emptySubscribe, library?.getView ?? getUnavailableView);
}
