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
  wasm: { enabled: true }
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
});
