import { createSessionFromFile } from "../state/documentSessions";
import type { DocumentSession, ReaderFileLike, ReaderFileSource } from "../types/reader";

interface TauriRuntimeProbe {
  __TAURI_INTERNALS__?: unknown;
}

export function isTauriRuntime(scope: TauriRuntimeProbe = window as TauriRuntimeProbe): boolean {
  return Boolean(scope.__TAURI_INTERNALS__);
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");

  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function createDesktopPathFile(path: string): ReaderFileLike {
  return {
    kind: "desktop-path",
    path,
    name: fileNameFromPath(path),
    size: 0,
    lastModified: 0
  };
}

export function isDesktopFileSource(source: ReaderFileLike | ReaderFileSource): boolean {
  return source.kind === "desktop-path";
}

export function createAccessErrorSession(path: string): DocumentSession {
  const session = createSessionFromFile(createDesktopPathFile(path));

  return {
    ...session,
    status: "error",
    error: {
      kind: "access-denied",
      title: "File access needed",
      message: "SmartReader cannot access this file path. Choose the file again to reopen it."
    }
  };
}
