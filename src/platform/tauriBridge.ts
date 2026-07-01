import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import type { DesktopPathFileSource } from './fileSource';
import { isTauriRuntimeAvailable } from './tauriRuntime';

type OpenDialog = typeof tauriOpen;
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type DesktopPdfResponse = {
  path: string;
  name: string;
  bytes: number[];
  fileSize: number;
  modifiedAt: string | null;
};

export type OpenedDesktopPdf = {
  source: DesktopPathFileSource;
  bytes: Uint8Array;
  fileSize: number;
  modifiedAt: string | null;
};

export type TauriBridge = {
  canOpenNativePdf?(): boolean;
  openNativePdf(): Promise<OpenedDesktopPdf | null>;
  readDesktopPdf(path: string): Promise<OpenedDesktopPdf>;
};

export function createTauriBridge(
  dependencies: {
    open?: OpenDialog;
    invoke?: Invoke;
  } = {},
): TauriBridge {
  const open = dependencies.open ?? tauriOpen;
  const invoke = dependencies.invoke ?? tauriInvoke;
  const hasInjectedDependencies = Boolean(dependencies.open || dependencies.invoke);

  return {
    canOpenNativePdf() {
      return hasInjectedDependencies || isTauriRuntimeAvailable();
    },
    async openNativePdf() {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (!selected || Array.isArray(selected)) {
        return null;
      }

      return readDesktopPdfWithInvoke(invoke, selected);
    },
    readDesktopPdf(path) {
      return readDesktopPdfWithInvoke(invoke, path);
    },
  };
}

async function readDesktopPdfWithInvoke(invoke: Invoke, path: string): Promise<OpenedDesktopPdf> {
  const response = await invoke<DesktopPdfResponse>('read_desktop_pdf', { path });

  return {
    source: {
      kind: 'desktop-path',
      path: response.path,
      name: response.name,
    },
    bytes: new Uint8Array(response.bytes),
    fileSize: response.fileSize,
    modifiedAt: response.modifiedAt,
  };
}
