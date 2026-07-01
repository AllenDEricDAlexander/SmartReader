import { listen } from '@tauri-apps/api/event';
import { getPdfPathsFromArgs } from './pathFilters';
import { isTauriRuntimeAvailable } from './tauriRuntime';

export type OpenWithListener = (paths: string[]) => void;

export async function listenForOpenWith(listener: OpenWithListener): Promise<() => void> {
  if (!isTauriRuntimeAvailable()) {
    return () => undefined;
  }

  const unlisten = await listen<string[]>('smartreader://open-pdfs', (event) => {
    const paths = getPdfPathsFromArgs(event.payload);

    if (paths.length > 0) {
      listener(paths);
    }
  });

  return unlisten;
}
