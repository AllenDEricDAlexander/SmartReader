import type { DocumentSession, RecentFile } from "../types/reader";

const recentFilesKey = "smartreader.recentFiles.v1";

export function recordRecentFile(
  current: RecentFile[],
  session: DocumentSession,
  retention = 12
): RecentFile[] {
  if (session.format !== "pdf" && session.format !== "epub") {
    return current;
  }

  const path = session.filePath ?? session.title;
  const next: RecentFile = {
    id: path,
    title: session.title,
    path,
    parentPath: parentPathFor(path),
    format: session.format,
    access: session.fileSource.kind === "desktop-path" ? "desktop-path" : "browser-file",
    lastOpenedAt: Date.now(),
    resumeLabel: resumeLabelFor(session),
    location: session.location
  };

  return [next, ...current.filter((item) => item.path !== path)].slice(0, retention);
}

export function clearRecentFiles(): RecentFile[] {
  return [];
}

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(recentFilesKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as RecentFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentFiles(recentFiles: RecentFile[]): void {
  localStorage.setItem(recentFilesKey, JSON.stringify(recentFiles));
}

function parentPathFor(path: string): string {
  const index = path.lastIndexOf("/");

  if (index <= 0) {
    return "Local file";
  }

  return path.slice(0, index);
}

function resumeLabelFor(session: DocumentSession): string {
  if (session.location.kind === "page") {
    return `Page ${session.location.page}`;
  }

  if (session.location.kind === "epub") {
    if (session.location.chapterLabel) {
      return session.location.chapterLabel;
    }

    return `${Math.round(session.location.progress * 100)}%`;
  }

  return "Start";
}
