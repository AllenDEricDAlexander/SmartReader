import {
  exportSmartReaderCache,
  importSmartReaderCache,
  smartReaderCacheKey,
  validateSmartReaderCacheEnvelope
} from "../state/smartReaderCache";
import type { SmartReaderCacheEnvelope } from "../types/reader";

export interface LoadSmartReaderCacheResponse {
  cache?: SmartReaderCacheEnvelope;
}

export interface SmartReaderCacheClient {
  read: () => Promise<SmartReaderCacheEnvelope | undefined>;
  write: (envelope: SmartReaderCacheEnvelope) => Promise<void>;
}

const loadCommand = "load_smartreader_cache";
const saveCommand = "save_smartreader_cache";

export function createSmartReaderCacheClient(
  storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage
): SmartReaderCacheClient {
  return {
    read: async () => {
      const tauriValue = await readFromTauri();

      if (tauriValue !== undefined) {
        return tauriValue;
      }

      const raw = storage?.getItem(smartReaderCacheKey);
      return raw ? importSmartReaderCache(raw) : undefined;
    },
    write: async (envelope) => {
      const wroteToTauri = await writeToTauri(envelope);

      if (!wroteToTauri) {
        storage?.setItem(smartReaderCacheKey, exportSmartReaderCache(envelope));
      }
    }
  };
}

async function readFromTauri(): Promise<SmartReaderCacheEnvelope | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<LoadSmartReaderCacheResponse>(loadCommand);

    return validateSmartReaderCacheEnvelope(response.cache);
  } catch {
    return undefined;
  }
}

async function writeToTauri(cache: SmartReaderCacheEnvelope): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(saveCommand, { cache });

    return true;
  } catch {
    return false;
  }
}
