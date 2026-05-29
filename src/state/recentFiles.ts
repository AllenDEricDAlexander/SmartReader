import type { DocumentSession, RecentFile, RecentReadingProgressSummary } from "../types/reader";
import { redactProtectedRecentFilesForStorage } from "./recentLibraryEncryption";

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
    protection: session.protection,
    lastOpenedAt: Date.now(),
    resumeLabel: resumeLabelFor(session),
    location: session.location,
    readingProgress: readingProgressForSession(session)
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
  localStorage.setItem(recentFilesKey, JSON.stringify(redactProtectedRecentFilesForStorage(recentFiles)));
}

export function readingProgressForRecentFile(file: RecentFile): RecentReadingProgressSummary {
  if (file.readingProgress) {
    return file.readingProgress;
  }

  if (file.location.kind === "page") {
    return {
      progressLabel: "Progress unknown",
      positionLabel: `Page ${file.location.page}`,
      contentLabel: "PDF content"
    };
  }

  if (file.location.kind === "epub") {
    return {
      progressLabel: `${readingProgressPercent(file.location.progress)}% read`,
      positionLabel: file.location.chapterLabel ? `Chapter: ${file.location.chapterLabel}` : "Chapter unknown",
      contentLabel: file.location.chapterLabel ?? file.location.chapterHref ?? "EPUB content"
    };
  }

  return {
    progressLabel: "Progress unknown",
    positionLabel: file.resumeLabel,
    contentLabel: file.format.toUpperCase()
  };
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

function readingProgressForSession(session: DocumentSession): RecentReadingProgressSummary {
  if (session.location.kind === "page") {
    const pageCount = session.pageCount;

    return {
      progressLabel: pageCount ? `${readingProgressPercent(session.location.page / pageCount)}% read` : "Progress unknown",
      positionLabel: pageCount ? `Page ${session.location.page} of ${pageCount}` : `Page ${session.location.page}`,
      contentLabel: "PDF content"
    };
  }

  if (session.location.kind === "epub") {
    const location = session.location;
    const chapterItems = session.outline.filter((item) => item.location.kind === "epub");
    const chapterIndex = chapterItems.findIndex((item) =>
      item.location.kind === "epub" &&
      item.location.chapterHref === location.chapterHref
    );
    const hasChapterCount = chapterItems.length > 0 && chapterIndex >= 0;

    return {
      progressLabel: `${readingProgressPercent(location.progress)}% read`,
      positionLabel: hasChapterCount
        ? `Chapter ${chapterIndex + 1} of ${chapterItems.length}`
        : location.chapterLabel
          ? `Chapter: ${location.chapterLabel}`
          : "Chapter unknown",
      contentLabel: location.chapterLabel ?? location.chapterHref ?? "EPUB content"
    };
  }

  return {
    progressLabel: "Progress unknown",
    positionLabel: "Start",
    contentLabel: session.format.toUpperCase()
  };
}

function readingProgressPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}
