import { listen } from '@tauri-apps/api/event';
import { getPdfPathsFromArgs } from './pathFilters';

export type OpenWithListener = (paths: string[]) => void;

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
    transformCallback?: unknown;
  };
};

export async function listenForOpenWith(listener: OpenWithListener): Promise<() => void> {
  if (!hasTauriRuntime()) {
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

function hasTauriRuntime(): boolean {
  const internals = (window as TauriRuntimeWindow).__TAURI_INTERNALS__;

  return (
    typeof internals?.invoke === 'function' &&
    typeof internals.transformCallback === 'function'
  );
}
