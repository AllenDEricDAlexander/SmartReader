import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import type { DesktopPathFileSource } from './fileSource';
import { isTauriRuntimeAvailable } from './tauriRuntime';

type OpenDialog = typeof tauriOpen;
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type DesktopPdfMetadataResponse = {
  path: string;
  name: string;
  fileSize: number;
  modifiedAt: string | null;
};

/**
 * Shapes a raw IPC payload can arrive as. A binary command result reaches the
 * webview as an ArrayBuffer, but the transport is runtime-provided, so this
 * stays tolerant of a typed array (or the legacy number array) instead of
 * failing to open the document.
 */
type RawPdfBytes = ArrayBuffer | Uint8Array | number[];

export function toPdfBytes(payload: RawPdfBytes): Uint8Array {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  return Uint8Array.from(payload);
}

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
  const hasInjectedDependencies = Boolean(dependencies.open && dependencies.invoke);

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
  // Metadata and contents travel separately: the description is small and JSON
  // suits it, while the document itself is transferred as raw binary.
  const [metadata, payload] = await Promise.all([
    invoke<DesktopPdfMetadataResponse>('stat_desktop_pdf', { path }),
    invoke<RawPdfBytes>('read_desktop_pdf_bytes', { path }),
  ]);

  return {
    source: {
      kind: 'desktop-path',
      path: metadata.path,
      name: metadata.name,
    },
    bytes: toPdfBytes(payload),
    fileSize: metadata.fileSize,
    modifiedAt: metadata.modifiedAt,
  };
}
