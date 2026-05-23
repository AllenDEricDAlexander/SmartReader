import { createAccessErrorSession, createDesktopPathFile, isTauriRuntime } from "./fileSources";
import { createSessionFromFile } from "../state/documentSessions";
import type { CommandId } from "../state/commandRegistry";
import type { DocumentSession, ReaderFileSource, SmartReaderCacheEnvelope } from "../types/reader";

type TauriUnlisten = () => void;

export interface DesktopEpubChapterMetadata {
  id: string;
  href: string;
  label: string;
  index: number;
}

export interface DesktopEpubOutlineItem {
  id: string;
  title: string;
  href: string;
  index?: number;
  level: number;
}

export interface DesktopEpubDocument {
  id: string;
  title?: string;
  chapters: DesktopEpubChapterMetadata[];
  outline: DesktopEpubOutlineItem[];
}

export interface DesktopEpubChapter extends DesktopEpubChapterMetadata {
  sanitizedHtml: string;
  text: string;
}

export interface DesktopEpubSearchResult {
  id: string;
  label: string;
  snippet: string;
  href: string;
  index: number;
  progress: number;
}

export interface DesktopPdfOutlineItem {
  id: string;
  title: string;
  page: number;
  level: number;
}

export interface DesktopPdfDocument {
  id: string;
  pageCount: number;
  outline: DesktopPdfOutlineItem[];
}

export interface DesktopPdfSearchResult {
  id: string;
  label: string;
  snippet: string;
  page: number;
}

export interface DesktopCacheInfo {
  defaultPath: string;
  activePath: string;
  isCustom: boolean;
  schemaVersion: number;
}

export interface DesktopLoadCacheResult {
  cache?: SmartReaderCacheEnvelope;
  info: DesktopCacheInfo;
}

export interface DesktopSetCacheLocationResult {
  activePath: string;
  moved: boolean;
  fallbackUsed?: boolean;
}

export interface DesktopExportCacheResult {
  path: string;
  bytesWritten: number;
  exportedAt: number;
}

export interface DesktopImportCacheResult {
  cache: SmartReaderCacheEnvelope;
  importedAt: number;
  applied: boolean;
}

const supportedExtensions = ["pdf", "epub"];
const desktopOpenFileEvent = "smartreader://open-file";
const supportedDocumentPath = /\.(pdf|epub)$/i;

export async function openDesktopFileDialog(): Promise<string | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Documents", extensions: supportedExtensions }]
  });

  return typeof selected === "string" ? selected : undefined;
}

export async function openCacheDirectoryDialog(): Promise<string | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: true
  });

  return typeof selected === "string" ? selected : undefined;
}

export async function openCacheImportDialog(): Promise<string | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "SmartReader Cache", extensions: ["json"] }]
  });

  return typeof selected === "string" ? selected : undefined;
}

export async function openCacheExportDialog(): Promise<string | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: "smartreader-cache.json",
    filters: [{ name: "SmartReader Cache", extensions: ["json"] }]
  });

  return typeof selected === "string" ? selected : undefined;
}

export async function readDesktopFile(path: string): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const data = await invoke<number[] | ArrayBuffer>("read_document", { path });

  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

export async function createDesktopSession(path: string): Promise<DocumentSession> {
  try {
    if (path.toLowerCase().endsWith(".pdf")) {
      await openPdfDocument(path);
    } else if (!path.toLowerCase().endsWith(".epub")) {
      await readDesktopFile(path);
    }
    return createSessionFromFile(createDesktopPathFile(path));
  } catch {
    return createAccessErrorSession(path);
  }
}

export async function openPdfDocument(path: string): Promise<DesktopPdfDocument> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopPdfDocument>("open_pdf_document", { path });
}

export async function searchPdfDocument(
  path: string,
  query: string
): Promise<DesktopPdfSearchResult[]> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopPdfSearchResult[]>("search_pdf_document", { path, query });
}

export async function openEpubDocument(path: string): Promise<DesktopEpubDocument> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopEpubDocument>("open_epub_document", { path });
}

export async function readEpubChapter(path: string, href: string): Promise<DesktopEpubChapter> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopEpubChapter>("read_epub_chapter", { path, href });
}

export async function searchEpubDocument(
  path: string,
  query: string
): Promise<DesktopEpubSearchResult[]> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopEpubSearchResult[]>("search_epub_document", { path, query });
}

export async function getSmartReaderCacheInfo(): Promise<DesktopCacheInfo> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopCacheInfo>("get_cache_info");
}

export async function loadSmartReaderCache(): Promise<DesktopLoadCacheResult> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopLoadCacheResult>("load_smartreader_cache");
}

export async function saveSmartReaderCache(cache: SmartReaderCacheEnvelope): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");

  await invoke("save_smartreader_cache", { cache });
}

export async function setSmartReaderCacheLocation(
  path: string,
  moveExisting: boolean
): Promise<DesktopSetCacheLocationResult> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopSetCacheLocationResult>("set_cache_location", { path, moveExisting });
}

export async function exportSmartReaderCacheFile(
  destinationPath: string,
  cache?: SmartReaderCacheEnvelope
): Promise<DesktopExportCacheResult> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopExportCacheResult>("export_smartreader_cache", { destinationPath, cache });
}

export async function importSmartReaderCacheFile(
  sourcePath: string,
  apply: boolean
): Promise<DesktopImportCacheResult> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<DesktopImportCacheResult>("import_smartreader_cache", { sourcePath, apply });
}

export async function readFileSource(source: ReaderFileSource): Promise<ArrayBuffer> {
  if (source.kind === "browser-file") {
    return source.file.arrayBuffer();
  }

  const data = await readDesktopFile(source.path);
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  return copy.buffer;
}

export async function setupTauriMenu(dispatchCommand: (commandId: CommandId) => void): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const { Menu } = await import("@tauri-apps/api/menu");
  const menu = await Menu.new({
    items: [
      {
        id: "file-menu",
        text: "File",
        items: [
          menuCommand("file.open", "Open...", "CmdOrCtrl+O", dispatchCommand),
          menuCommand("file.closeTab", "Close Tab", "CmdOrCtrl+W", dispatchCommand)
        ]
      },
      {
        id: "view-menu",
        text: "View",
        items: [menuCommand("view.toggleSidebar", "Toggle Sidebar", "CmdOrCtrl+B", dispatchCommand)]
      },
      {
        id: "find-menu",
        text: "Find",
        items: [menuCommand("find.open", "Find...", "CmdOrCtrl+F", dispatchCommand)]
      },
      {
        id: "smartreader-menu",
        text: "SmartReader",
        items: [menuCommand("app.preferences", "Preferences...", "CmdOrCtrl+,", dispatchCommand)]
      }
    ]
  });

  await menu.setAsAppMenu();
}

export async function listenForDesktopOpenFiles(
  openPath: (path: string) => void
): Promise<TauriUnlisten | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const { listen } = await import("@tauri-apps/api/event");

  return listen<string>(desktopOpenFileEvent, (event) => {
    const path = desktopOpenPayloadToPath(event.payload);

    if (path) {
      openPath(path);
    }
  });
}

export async function openPendingDesktopFiles(openPath: (path: string) => void): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const paths = await invoke<string[]>("pending_open_files");
  paths.forEach((payload) => {
    const path = desktopOpenPayloadToPath(payload);

    if (path) {
      openPath(path);
    }
  });
}

export function desktopOpenPayloadToPath(payload: string): string | undefined {
  if (!payload) {
    return undefined;
  }

  try {
    const url = new URL(payload);

    if (url.protocol !== "file:") {
      return undefined;
    }

    return supportedDocumentPath.test(url.pathname) ? decodeURIComponent(url.pathname) : undefined;
  } catch {
    return supportedDocumentPath.test(payload) ? payload : undefined;
  }
}

function menuCommand(
  id: CommandId,
  text: string,
  accelerator: string,
  dispatchCommand: (commandId: CommandId) => void
) {
  return {
    id,
    text,
    accelerator,
    action: () => dispatchCommand(id)
  };
}
