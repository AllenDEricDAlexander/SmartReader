import { useMemo } from 'react';
import { createDebouncedFlush } from '../../persistence/debounce';
import {
  createPersistenceApi,
  type PersistenceApi,
} from '../../persistence/persistenceApi';
import { createTauriBridge, type TauriBridge } from '../../platform/tauriBridge';

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
  const bridge = providedBridge ?? defaultBridge;
  const persistence = providedPersistence ?? defaultPersistence;
  const sessionPersistence = useMemo(
    () => createDebouncedFlush(persistence.saveReaderSession, 250),
    [persistence],
  );

  return { bridge, persistence, sessionPersistence };
}
