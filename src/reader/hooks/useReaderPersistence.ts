import { useMemo } from 'react';
import { createDebouncedFlush } from '../../persistence/debounce';
import {
  createPersistenceApi,
  type PersistenceApi,
} from '../../persistence/persistenceApi';
import { createTauriBridge, type TauriBridge } from '../../platform/tauriBridge';
import { useResearch } from '../../app/ResearchContext';
import { createLibraryPersistence } from '../../library/libraryPersistence';

type UseReaderPersistenceInput = {
  bridge?: TauriBridge;
  persistence?: PersistenceApi;
};

export function useReaderPersistence({
  bridge: providedBridge,
  persistence: providedPersistence,
}: UseReaderPersistenceInput) {
  const defaultBridge = useMemo(() => createTauriBridge(), []);
  const defaultPersistence = useMemo(() => createPersistenceApi(), []);
  const research = useResearch();
  const bridge = providedBridge ?? defaultBridge;
  const basePersistence = providedPersistence ?? defaultPersistence;
  const persistence = useMemo(() => research
    ? createLibraryPersistence(basePersistence, research.library) : basePersistence, [basePersistence, research]);
  const sessionPersistence = useMemo(
    () => createDebouncedFlush(persistence.saveReaderSession, 250),
    [persistence],
  );

  return { bridge, persistence, sessionPersistence };
}
