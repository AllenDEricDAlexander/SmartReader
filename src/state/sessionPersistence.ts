import { createEmptySession } from "./documentSessions";
import type {
  AppSessionSnapshot,
  DocumentSession,
  PersistedDocumentSession,
  Preferences,
  ReaderAnnotation,
  ReaderLocation
} from "../types/reader";

export const appSessionKey = "smartreader.appSession.v1";

interface AppSessionState {
  sessions: DocumentSession[];
  activeTabId: string;
  sidebarOpen: boolean;
  preferences: Preferences;
}

export function createAppSessionSnapshot(input: {
  sessions: DocumentSession[];
  activeTabId: string;
  sidebarOpen: boolean;
  preferences: Preferences;
}): AppSessionSnapshot {
  const sessions = input.sessions
    .map((session) => persistDocumentSession(session, input.preferences))
    .filter((session): session is PersistedDocumentSession => Boolean(session));

  return {
    version: 1,
    activeTabId: sessions.some((session) => session.id === input.activeTabId)
      ? input.activeTabId
      : sessions[0]?.id ?? "",
    sidebarOpen: input.sidebarOpen,
    preferences: input.preferences,
    sessions
  };
}

export function loadAppSessionSnapshot(): AppSessionSnapshot | undefined {
  try {
    const raw = localStorage.getItem(appSessionKey);

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    return isAppSessionSnapshot(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveAppSessionSnapshot(snapshot: AppSessionSnapshot): void {
  localStorage.setItem(appSessionKey, JSON.stringify(snapshot));
}

export function restoreAppSessionSnapshot(
  snapshot: AppSessionSnapshot | undefined,
  fallbackPreferences: Preferences,
  options: { preferFallbackPreferences?: boolean } = {}
): AppSessionState {
  const preferences = options.preferFallbackPreferences
    ? {
        ...(snapshot?.preferences ?? {}),
        ...fallbackPreferences
      }
    : {
        ...fallbackPreferences,
        ...(snapshot?.preferences ?? {})
      };

  if (!snapshot || !preferences.reopenLastSession) {
    const empty = createEmptySession();

    return {
      sessions: [empty],
      activeTabId: empty.id,
      sidebarOpen: preferences.defaultSidebarVisible,
      preferences
    };
  }

  const sessions = snapshot.sessions.map((session) => restoreDocumentSession(session, preferences));
  const activeTabId = sessions.some((session) => session.id === snapshot.activeTabId)
    ? snapshot.activeTabId
    : sessions[0]?.id;

  if (!activeTabId || sessions.length === 0) {
    const empty = createEmptySession();

    return {
      sessions: [empty],
      activeTabId: empty.id,
      sidebarOpen: preferences.defaultSidebarVisible,
      preferences
    };
  }

  return {
    sessions,
    activeTabId,
    sidebarOpen: snapshot.sidebarOpen,
    preferences
  };
}

function persistDocumentSession(
  session: DocumentSession,
  preferences: Preferences
): PersistedDocumentSession | undefined {
  if (session.fileSource.kind !== "desktop-path" && session.fileSource.kind !== "empty") {
    return undefined;
  }

  if (session.protection) {
    return undefined;
  }

  const location = preferences.rememberPosition ? session.location : initialLocationForSession(session);

  return {
    id: session.id,
    title: session.title,
    filePath: session.filePath,
    fileSource: session.fileSource,
    format: session.format,
    status: session.status,
    error: session.error,
    location,
    lastLocation: location,
    zoom: session.zoom,
    fitMode: session.fitMode,
    sidebarMode: session.sidebarMode,
    bookmarks: session.bookmarks,
    annotations: stripManagedPdfKitCopyPaths(session.annotations),
    pendingDeletedAnnotations: session.pendingDeletedAnnotations
      ? stripManagedPdfKitCopyPaths(session.pendingDeletedAnnotations)
      : undefined,
    nativePdfAnnotations: session.nativePdfAnnotations,
    pageCount: session.pageCount,
    epubSettings: session.epubSettings,
    openedAt: session.openedAt,
    updatedAt: session.updatedAt
  };
}

function restoreDocumentSession(
  session: PersistedDocumentSession,
  preferences: Preferences
): DocumentSession {
  return {
    ...session,
    fileSource: session.fileSource,
    fitMode: session.format === "pdf" ? preferences.defaultPdfFitMode : session.fitMode,
    epubSettings: {
      fontSize: preferences.epubFontSize,
      theme: preferences.epubTheme
    },
    source: undefined,
    objectUrl: undefined,
    outline: [],
    searchResults: [],
    annotations: stripManagedPdfKitCopyPaths(session.annotations ?? []),
    pendingDeletedAnnotations: session.pendingDeletedAnnotations
      ? stripManagedPdfKitCopyPaths(session.pendingDeletedAnnotations)
      : undefined,
    nativePdfAnnotations: session.nativePdfAnnotations,
    pdfKitManagedCopyPath: undefined
  };
}

function stripManagedPdfKitCopyPaths(annotations: ReaderAnnotation[]): ReaderAnnotation[] {
  return annotations.map((annotation) => {
    const nativePdfKitWithLegacyPath = annotation.nativePdfKit as
      | (NonNullable<ReaderAnnotation["nativePdfKit"]> & { writePath?: string })
      | undefined;

    if (!nativePdfKitWithLegacyPath?.managedCopyPath && !nativePdfKitWithLegacyPath?.writePath) {
      return annotation;
    }

    const {
      managedCopyPath: _managedCopyPath,
      writePath: _writePath,
      ...nativePdfKit
    } = nativePdfKitWithLegacyPath;

    return { ...annotation, nativePdfKit };
  });
}

function isAppSessionSnapshot(value: AppSessionSnapshot): value is AppSessionSnapshot {
  return value?.version === 1 && Array.isArray(value.sessions);
}

function initialLocationForSession(session: DocumentSession): ReaderLocation {
  if (session.format === "pdf") {
    return { kind: "page", page: 1 };
  }

  if (session.format === "epub") {
    return { kind: "epub", progress: 0 };
  }

  return { kind: "none" };
}
