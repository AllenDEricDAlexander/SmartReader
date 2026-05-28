import { describe, expect, it } from "vitest";
import { createSessionFromFile, updateSessionLocation, updateSessionZoom } from "./documentSessions";
import {
  createAppSessionSnapshot,
  loadAppSessionSnapshot,
  restoreAppSessionSnapshot,
  saveAppSessionSnapshot
} from "./sessionPersistence";
import type { Preferences } from "../types/reader";

const preferences: Preferences = {
  reopenLastSession: true,
  rememberPosition: true,
  defaultSidebarVisible: true,
  defaultPdfFitMode: "continuous",
  epubFontSize: 18,
  epubTheme: "system",
  recentRetention: 12,
  cacheLocation: { mode: "default" },
  search: { resultLimit: "unlimited", includePdf: true, includeEpub: true },
  shortcuts: [],
  wasm: { enabled: true },
  pdfKit: { enabled: false }
};

describe("app session persistence", () => {
  it("restores desktop tabs, active tab, and per-file reading progress", () => {
    const pdf = updateSessionZoom(
      updateSessionLocation(
        createSessionFromFile({
          kind: "desktop-path",
          path: "/Users/mario/Books/spec.pdf",
          name: "spec.pdf",
          size: 0,
          lastModified: 0
        }),
        { kind: "page", page: 18 }
      ),
      1.25
    );
    const epub = updateSessionLocation(
      createSessionFromFile({
        kind: "desktop-path",
        path: "/Users/mario/Books/novel.epub",
        name: "novel.epub",
        size: 0,
        lastModified: 0
      }),
      {
        kind: "epub",
        chapterHref: "chapter-4.xhtml",
        chapterLabel: "Chapter 4",
        progress: 0.4
      }
    );

    const snapshot = createAppSessionSnapshot({
      sessions: [pdf, epub],
      activeTabId: epub.id,
      sidebarOpen: false,
      preferences
    });
    const restored = restoreAppSessionSnapshot(snapshot, preferences);

    expect(restored.sessions).toHaveLength(2);
    expect(restored.activeTabId).toBe(epub.id);
    expect(restored.sidebarOpen).toBe(false);
    expect(restored.sessions[0].location).toEqual({ kind: "page", page: 18 });
    expect(restored.sessions[0].zoom).toBe(1.25);
    expect(restored.sessions[1].location).toEqual({
      kind: "epub",
      chapterHref: "chapter-4.xhtml",
      chapterLabel: "Chapter 4",
      progress: 0.4
    });
  });

  it("preserves EPUB chapter scroll offsets without letting saved reading settings override current preferences", () => {
    const epub = updateSessionLocation(
      createSessionFromFile({
        kind: "desktop-path",
        path: "/Users/mario/Books/novel.epub",
        name: "novel.epub",
        size: 0,
        lastModified: 0
      }),
      {
        kind: "epub",
        chapterHref: "chapter-4.xhtml",
        chapterLabel: "Chapter 4",
        progress: 0.4,
        scrollTop: 320
      }
    );
    const savedPreferences = {
      ...preferences,
      epubFontSize: 22,
      epubTheme: "dark" as const
    };
    const currentPreferences = {
      ...preferences,
      epubFontSize: 16,
      epubTheme: "light" as const
    };

    const snapshot = createAppSessionSnapshot({
      sessions: [
        {
          ...epub,
          epubSettings: {
            fontSize: 22,
            theme: "dark"
          }
        }
      ],
      activeTabId: epub.id,
      sidebarOpen: false,
      preferences: savedPreferences
    });
    const restored = restoreAppSessionSnapshot(snapshot, currentPreferences, {
      preferFallbackPreferences: true
    });

    expect(restored.preferences.epubFontSize).toBe(16);
    expect(restored.preferences.epubTheme).toBe("light");
    expect(restored.sessions[0].location).toEqual({
      kind: "epub",
      chapterHref: "chapter-4.xhtml",
      chapterLabel: "Chapter 4",
      progress: 0.4,
      scrollTop: 320
    });
    expect(restored.sessions[0].epubSettings).toEqual({
      fontSize: 16,
      theme: "light"
    });
  });

  it("restores saved global preferences by default on startup", () => {
    const session = createSessionFromFile({
      kind: "desktop-path",
      path: "/Users/mario/Books/spec.pdf",
      name: "spec.pdf",
      size: 0,
      lastModified: 0
    });
    const savedPreferences = {
      ...preferences,
      defaultPdfFitMode: "fit-width" as const,
      epubFontSize: 20,
      epubTheme: "dark" as const
    };

    const snapshot = createAppSessionSnapshot({
      sessions: [session],
      activeTabId: session.id,
      sidebarOpen: true,
      preferences: savedPreferences
    });
    const restored = restoreAppSessionSnapshot(snapshot, preferences);

    expect(restored.preferences.defaultPdfFitMode).toBe("fit-width");
    expect(restored.preferences.epubFontSize).toBe(20);
    expect(restored.preferences.epubTheme).toBe("dark");
    expect(restored.sessions[0].fitMode).toBe("fit-width");
  });

  it("does not persist browser File sessions that cannot be reopened", () => {
    const file = new File(["content"], "browser.pdf", { type: "application/pdf" });
    const browserSession = createSessionFromFile({
      kind: "browser-file",
      path: file.name,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      file
    });

    const snapshot = createAppSessionSnapshot({
      sessions: [browserSession],
      activeTabId: browserSession.id,
      sidebarOpen: true,
      preferences
    });
    const restored = restoreAppSessionSnapshot(snapshot, preferences);

    expect(snapshot.sessions).toHaveLength(0);
    expect(restored.sessions[0].status).toBe("empty");
  });

  it("stores the session contract in localStorage", () => {
    const session = createSessionFromFile({
      kind: "desktop-path",
      path: "/Users/mario/Books/spec.pdf",
      name: "spec.pdf",
      size: 0,
      lastModified: 0
    });
    const snapshot = createAppSessionSnapshot({
      sessions: [session],
      activeTabId: session.id,
      sidebarOpen: true,
      preferences
    });

    saveAppSessionSnapshot(snapshot);

    expect(localStorage.getItem("smartreader.appSession.v1")).toContain("/Users/mario/Books/spec.pdf");
    expect(loadAppSessionSnapshot()).toMatchObject({
      activeTabId: session.id,
      sessions: [{ id: session.id, filePath: "/Users/mario/Books/spec.pdf" }]
    });

    localStorage.setItem("smartreader.appSession.v1", "{not json");

    expect(loadAppSessionSnapshot()).toBeUndefined();
  });

  it("persists annotation metadata with reopened desktop sessions", () => {
    const session = {
      ...createSessionFromFile({
        kind: "desktop-path",
        path: "/Users/mario/Books/spec.pdf",
        name: "spec.pdf",
        size: 0,
        lastModified: 0
      }),
      annotations: [
        {
          id: "annotation-1",
          type: "highlight" as const,
          tag: "重点" as const,
          color: "#ffe28a",
          thickness: 2,
          note: "Important result",
          selectedText: "important result",
          location: { kind: "page" as const, page: 4 },
          createdAt: 1,
          updatedAt: 1,
          hidden: false
        }
      ],
      nativePdfAnnotations: {
        schemaVersion: 1 as const,
        annotations: [{ annotation: { id: "native-annotation-1" } }],
        updatedAt: 2
      }
    };

    const snapshot = createAppSessionSnapshot({
      sessions: [session],
      activeTabId: session.id,
      sidebarOpen: true,
      preferences
    });
    const restored = restoreAppSessionSnapshot(snapshot, preferences);

    expect(snapshot.sessions[0].annotations).toHaveLength(1);
    expect(restored.sessions[0].annotations).toEqual(session.annotations);
    expect(snapshot.sessions[0].nativePdfAnnotations).toEqual(session.nativePdfAnnotations);
    expect(restored.sessions[0].nativePdfAnnotations).toEqual(session.nativePdfAnnotations);
  });

  it("drops persisted PDFKit managed copy paths before restoring sessions", () => {
    const session = {
      ...createSessionFromFile({
        kind: "desktop-path",
        path: "/Users/mario/Books/spec.pdf",
        name: "spec.pdf",
        size: 0,
        lastModified: 0
      }),
      annotations: [
        {
          id: "annotation-1",
          type: "area" as const,
          tag: "重点" as const,
          color: "#ffe28a",
          thickness: 2,
          location: { kind: "page" as const, page: 4 },
          nativePdfKit: {
            supported: true,
            status: "upserted",
            nativeId: "smartreader:annotation-1",
            writePath: "/.../legacy-write.pdf",
            managedCopyPath: "/.../victim.pdf",
            syncedAt: 1
          },
          createdAt: 1,
          updatedAt: 1
        }
      ],
      pendingDeletedAnnotations: [
        {
          id: "annotation-delete",
          type: "area" as const,
          tag: "重点" as const,
          color: "#ffe28a",
          thickness: 2,
          location: { kind: "page" as const, page: 4 },
          nativePdfKit: {
            supported: false,
            status: "sync-failed",
            writePath: "/.../legacy-delete.pdf",
            managedCopyPath: "/.../victim.pdf",
            dirty: true,
            pendingOperation: "delete" as const,
            lastSyncError: "native delete failed",
            failedAt: 2
          },
          createdAt: 1,
          updatedAt: 1
        }
      ],
      pdfKitManagedCopyPath: "/.../victim.pdf"
    };

    const snapshot = createAppSessionSnapshot({
      sessions: [session],
      activeTabId: session.id,
      sidebarOpen: true,
      preferences
    });
    const restored = restoreAppSessionSnapshot(
      {
        ...snapshot,
        sessions: [
          {
            ...snapshot.sessions[0],
            pdfKitManagedCopyPath: "/.../victim.pdf",
            annotations: session.annotations,
            pendingDeletedAnnotations: session.pendingDeletedAnnotations
          } as typeof snapshot.sessions[number]
        ]
      },
      preferences
    );

    expect(JSON.stringify(snapshot)).not.toContain("/.../victim.pdf");
    expect(JSON.stringify(snapshot)).not.toContain("/.../legacy-write.pdf");
    expect(restored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    expect(restored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("writePath");
    expect(restored.sessions[0].pendingDeletedAnnotations?.[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    expect(restored.sessions[0].pendingDeletedAnnotations?.[0].nativePdfKit).not.toHaveProperty("writePath");
    expect(restored.sessions[0].pdfKitManagedCopyPath).toBeUndefined();
  });
});
