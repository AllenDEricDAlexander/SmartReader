import type {
  DocumentFormat,
  DocumentSession,
  EpubReadingSettings,
  FitMode,
  ReaderFileLike,
  ReaderLocation,
  RecentFile,
  SidebarMode
} from "../types/reader";

let sessionCounter = 0;

const defaultEpubSettings: EpubReadingSettings = {
  fontSize: 18,
  theme: "system"
};

export function detectDocumentFormat(fileName: string): DocumentFormat {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (lowerName.endsWith(".epub")) {
    return "epub";
  }

  return "unsupported";
}

export function createEmptySession(): DocumentSession {
  return createBaseSession({
    title: "Empty Tab",
    format: "empty",
    status: "empty",
    location: { kind: "none" }
  });
}

export function createSessionFromFile(file: ReaderFileLike): DocumentSession {
  const format = detectDocumentFormat(file.name);
  const fileSource =
    file.kind === "desktop-path" && file.path
      ? { kind: "desktop-path" as const, path: file.path }
      : file.file
        ? { kind: "browser-file" as const, file: file.file, objectUrl: file.objectUrl }
        : { kind: "desktop-path" as const, path: file.path ?? file.name };
  const base = createBaseSession({
    title: file.name,
    format,
    status: format === "unsupported" ? "error" : "ready",
    location: format === "pdf" ? { kind: "page", page: 1 } : initialLocationForFormat(format)
  });

  return {
    ...base,
    filePath: file.path ?? file.name,
    fileSource,
    source: file.file,
    objectUrl: file.objectUrl,
    error:
      format === "unsupported"
        ? {
            kind: "unsupported-format",
            title: "Unsupported file",
            message: "SmartReader MVP opens PDF and EPUB files."
          }
        : undefined
  };
}

/** Creates a path-backed reopen session while preserving recent-file reading progress. */
export function createSessionFromRecentFile(recent: RecentFile): DocumentSession {
  const session = createSessionFromFile({
    kind: "desktop-path",
    path: recent.path,
    name: recent.title,
    size: 0,
    lastModified: recent.lastOpenedAt
  });

  return {
    ...session,
    location: recent.location,
    lastLocation: recent.location,
    updatedAt: Date.now()
  };
}

export function updateSessionLocation(
  session: DocumentSession,
  location: ReaderLocation
): DocumentSession {
  return {
    ...session,
    location,
    lastLocation: location,
    updatedAt: Date.now()
  };
}

export function updateSessionZoom(session: DocumentSession, zoom: number): DocumentSession {
  const clampedZoom = Math.min(3, Math.max(0.5, Number(zoom.toFixed(2))));

  return {
    ...session,
    zoom: clampedZoom,
    updatedAt: Date.now()
  };
}

export function updateSessionSidebarMode(
  session: DocumentSession,
  sidebarMode: SidebarMode
): DocumentSession {
  return {
    ...session,
    sidebarMode,
    updatedAt: Date.now()
  };
}

export function updateSessionFitMode(session: DocumentSession, fitMode: FitMode): DocumentSession {
  return {
    ...session,
    fitMode,
    zoom: fitMode === "actual-size" ? 1 : session.zoom,
    updatedAt: Date.now()
  };
}

function createBaseSession(input: {
  title: string;
  format: DocumentFormat;
  status: DocumentSession["status"];
  location: ReaderLocation;
}): DocumentSession {
  const now = Date.now();

  return {
    id: `tab-${now}-${sessionCounter++}`,
    title: input.title,
    fileSource: { kind: "empty" },
    format: input.format,
    status: input.status,
    location: input.location,
    lastLocation: input.location,
    zoom: 1,
    fitMode: "continuous",
    sidebarMode: "contents",
    outline: [],
    searchResults: [],
    bookmarks: [],
    annotations: [],
    epubSettings: defaultEpubSettings,
    openedAt: now,
    updatedAt: now
  };
}

function initialLocationForFormat(format: DocumentFormat): ReaderLocation {
  if (format === "epub") {
    return { kind: "epub", progress: 0 };
  }

  return { kind: "none" };
}
