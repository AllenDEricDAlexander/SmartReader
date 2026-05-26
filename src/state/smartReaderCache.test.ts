import { describe, expect, it } from "vitest";
import {
  createSmartReaderCacheEnvelope,
  exportSmartReaderCache,
  importSmartReaderCache,
  mergeSmartReaderCache,
  readSmartReaderCache,
  validateSmartReaderCacheEnvelope,
  writeSmartReaderCache
} from "./smartReaderCache";
import type {
  Preferences,
  RecentFile,
  SmartReaderAdapterCache,
  SmartReaderReadingProgress,
  SmartReaderSessionCache
} from "../types/reader";

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

const recentFile: RecentFile = {
  id: "/Users/mario/Books/spec.pdf",
  title: "spec.pdf",
  path: "/Users/mario/Books/spec.pdf",
  parentPath: "/Users/mario/Books",
  format: "pdf",
  access: "desktop-path",
  lastOpenedAt: 100,
  resumeLabel: "Page 7",
  location: { kind: "page", page: 7 }
};

const progress: SmartReaderReadingProgress = {
  documentId: recentFile.id,
  title: recentFile.title,
  path: recentFile.path,
  format: "pdf",
  location: { kind: "page", page: 7 },
  updatedAt: 120
};

const session: SmartReaderSessionCache = {
  activeTabId: "tab-1",
  sidebarOpen: true,
  tabs: [
    {
      id: "tab-1",
      filePath: recentFile.path,
      fileSource: { kind: "desktop-path", path: recentFile.path },
      title: "spec.pdf",
      format: "pdf",
      status: "ready",
      location: { kind: "page", page: 7 },
      lastLocation: { kind: "page", page: 7 },
      zoom: 1,
      fitMode: "continuous",
      sidebarMode: "contents",
      bookmarks: [],
      annotations: [],
      epubSettings: { fontSize: 18, theme: "system" },
      openedAt: 100,
      updatedAt: 130
    }
  ]
};

const adapter: SmartReaderAdapterCache = {
  searchIndexes: [
    {
      documentId: recentFile.id,
      path: recentFile.path,
      format: "pdf",
      adapter: "wasm",
      version: "test",
      updatedAt: 140
    }
  ]
};

describe("smart reader cache", () => {
  it("creates and validates the versioned cache envelope", () => {
    const envelope = createSmartReaderCacheEnvelope({
      settings: preferences,
      recentFiles: [recentFile],
      readingProgress: [progress],
      session,
      adapterCache: adapter
    });

    expect(envelope.schemaVersion).toBe(1);
    expect(validateSmartReaderCacheEnvelope(envelope)).toEqual(envelope);
    expect(validateSmartReaderCacheEnvelope({ schemaVersion: 2 })).toBeUndefined();
    expect(validateSmartReaderCacheEnvelope({ schemaVersion: 1, recentFiles: "bad" })).toBeUndefined();
  });

  it("exports cache metadata without raw document content or browser-only handles", () => {
    const raw = exportSmartReaderCache(
      createSmartReaderCacheEnvelope({
        settings: preferences,
        recentFiles: [recentFile],
        readingProgress: [progress],
        session: {
          activeTabId: "tab-1",
          sidebarOpen: false,
          tabs: [
            {
              id: "tab-1",
              filePath: recentFile.path,
              fileSource: { kind: "desktop-path", path: recentFile.path },
              title: "spec.pdf",
              format: "pdf",
              status: "ready",
              location: { kind: "page", page: 7 },
              lastLocation: { kind: "page", page: 7 },
              zoom: 1,
              fitMode: "continuous",
              sidebarMode: "contents",
              bookmarks: [],
              epubSettings: { fontSize: 18, theme: "system" },
              openedAt: 100,
              updatedAt: 130,
              file: new File(["raw document"], "spec.pdf") as unknown,
              objectUrl: "blob:smartreader-test",
              fullText: "full chapter text",
              pdfProxy: { numPages: 1 }
            }
          ]
        } as unknown as SmartReaderSessionCache
      })
    );

    expect(raw).toContain("\"schemaVersion\":1");
    expect(raw).toContain("\"pdfKit\":{\"enabled\":false}");
    expect(raw).not.toContain("raw document");
    expect(raw).not.toContain("blob:smartreader-test");
    expect(raw).not.toContain("full chapter text");
    expect(raw).not.toContain("pdfProxy");
  });

  it("deep-sanitizes imported cache before state use or re-export", () => {
    const imported = importSmartReaderCache(
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "0.1.0",
        savedAt: "2026-05-23T00:00:00.000Z",
        settings: {
          ...preferences,
          rawText: "raw settings leak",
          shortcuts: [
            {
              commandId: "reader.nextPage",
              shortcut: "ArrowRight",
              enabled: true,
              source: "user",
              parserInternal: { rawText: "shortcut leak" }
            }
          ],
          wasm: {
            enabled: true,
            parserVersion: "v1",
            runtime: { rawText: "wasm runtime leak" }
          }
        },
        recentFiles: [
          {
            ...recentFile,
            objectUrl: "blob:recent",
            rawText: "recent leak"
          }
        ],
        readingProgress: [
          {
            ...progress,
            rawText: "progress leak",
            fullText: "chapter full text"
          }
        ],
        session: {
          activeTabId: "tab-1",
          sidebarOpen: true,
          tabs: [
            {
              ...session.tabs[0],
              objectUrl: "blob:session",
              rawText: "raw session leak",
              fullText: "full session leak",
              pdfProxy: { rawText: "pdf proxy leak" },
              parser: { rawText: "parser leak" },
              bookmarks: [
                {
                  id: "bookmark-1",
                  title: "Bookmark",
                  location: { kind: "page", page: 7 },
                  createdAt: 130,
                  rawText: "bookmark leak"
                }
              ],
              annotations: [
                {
                  id: "annotation-1",
                  type: "highlight",
                  tag: "重点",
                  color: "#ffe28a",
                  thickness: 2,
                  note: "Important",
                  selectedText: "important",
                  location: { kind: "page", page: 7, rawText: "annotation location leak" },
                  hidden: false,
                  createdAt: 130,
                  updatedAt: 131,
                  rawText: "annotation leak"
                }
              ],
              epubSettings: {
                fontSize: 18,
                theme: "system",
                rawText: "epub settings leak"
              }
            }
          ]
        },
        adapterCache: {
          searchIndexes: [
            {
              ...adapter.searchIndexes[0],
              rawPayload: [{ rawText: "raw index payload" }],
              objectUrl: "blob:index"
            }
          ]
        }
      })
    );

    expect(imported).toBeDefined();

    const exported = exportSmartReaderCache(imported!);

    expect(exported).not.toContain("rawText");
    expect(exported).not.toContain("fullText");
    expect(exported).not.toContain("objectUrl");
    expect(exported).not.toContain("blob:");
    expect(exported).not.toContain("pdfProxy");
    expect(exported).not.toContain("parser leak");
    expect(exported).not.toContain("rawPayload");
    expect(exported).toContain("\"annotations\":[");
    expect(exported).toContain("\"tag\":\"重点\"");
  });

  it("rejects imported annotation styles outside the supported palette contract", () => {
    const imported = importSmartReaderCache(
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "0.1.0",
        savedAt: "2026-05-23T00:00:00.000Z",
        settings: preferences,
        recentFiles: [recentFile],
        readingProgress: [progress],
        session: {
          ...session,
          tabs: [
            {
              ...session.tabs[0],
              annotations: [
                {
                  id: "annotation-1",
                  type: "highlight",
                  tag: "重点",
                  color: "red;position:fixed",
                  thickness: 9,
                  location: { kind: "page", page: 7 },
                  createdAt: 130,
                  updatedAt: 131
                }
              ]
            }
          ]
        },
        adapterCache: adapter
      })
    );

    expect(imported).toBeUndefined();
  });

  it("imports old version 1 cache settings without pdfKit and defaults the setting off", () => {
    const { pdfKit: _pdfKit, ...oldSettings } = preferences;
    const imported = importSmartReaderCache(
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "0.1.0",
        savedAt: "2026-05-23T00:00:00.000Z",
        settings: oldSettings,
        recentFiles: [recentFile],
        readingProgress: [progress],
        session,
        adapterCache: { searchIndexes: [] }
      })
    );

    expect(imported).toBeDefined();
    expect(imported?.settings.pdfKit.enabled).toBe(false);
  });

  it("deep-sanitizes nested reader locations before re-export", () => {
    const imported = importSmartReaderCache(
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "0.1.0",
        savedAt: "2026-05-23T00:00:00.000Z",
        settings: preferences,
        recentFiles: [
          {
            ...recentFile,
            location: {
              kind: "page",
              page: 7,
              rawText: "recent location leak",
              objectUrl: "blob:recent-location"
            }
          }
        ],
        readingProgress: [
          {
            ...progress,
            location: {
              kind: "epub",
              progress: 0.4,
              cfi: "epubcfi(/6/2)",
              chapterHref: "chapter.xhtml",
              chapterLabel: "Chapter",
              rawText: "progress location leak",
              objectUrl: "blob:progress-location",
              pdfProxy: { rawText: "progress proxy leak" }
            }
          }
        ],
        session: {
          activeTabId: "tab-1",
          sidebarOpen: true,
          tabs: [
            {
              ...session.tabs[0],
              location: {
                kind: "page",
                page: 7,
                rawText: "tab location leak",
                objectUrl: "blob:tab-location"
              },
              lastLocation: {
                kind: "epub",
                progress: 0.5,
                chapterHref: "last.xhtml",
                chapterLabel: "Last",
                rawText: "last location leak",
                pdfProxy: { rawText: "last proxy leak" }
              },
              bookmarks: [
                {
                  id: "bookmark-1",
                  title: "Bookmark",
                  location: {
                    kind: "page",
                    page: 8,
                    rawText: "bookmark location leak",
                    objectUrl: "blob:bookmark-location"
                  },
                  createdAt: 130
                }
              ]
            }
          ]
        },
        adapterCache: { searchIndexes: [] }
      })
    );

    expect(imported).toBeDefined();

    const exported = exportSmartReaderCache(imported!);
    const reparsed = JSON.parse(exported) as SmartReaderSessionCache & {
      recentFiles: RecentFile[];
      readingProgress: SmartReaderReadingProgress[];
      session: SmartReaderSessionCache;
    };

    expect(exported).not.toContain("location leak");
    expect(exported).not.toContain("blob:");
    expect(exported).not.toContain("pdfProxy");
    expect(reparsed.recentFiles[0].location).toEqual({ kind: "page", page: 7 });
    expect(reparsed.readingProgress[0].location).toEqual({
      kind: "epub",
      cfi: "epubcfi(/6/2)",
      chapterHref: "chapter.xhtml",
      chapterLabel: "Chapter",
      progress: 0.4
    });
    expect(reparsed.session.tabs[0].location).toEqual({ kind: "page", page: 7 });
    expect(reparsed.session.tabs[0].lastLocation).toEqual({
      kind: "epub",
      chapterHref: "last.xhtml",
      chapterLabel: "Last",
      progress: 0.5
    });
    expect(reparsed.session.tabs[0].bookmarks[0].location).toEqual({ kind: "page", page: 8 });
  });

  it("rejects corrupt imported fields instead of coercing partial cache state", () => {
    const current = createSmartReaderCacheEnvelope({
      settings: preferences,
      recentFiles: [recentFile],
      readingProgress: [progress],
      session
    });

    expect(importSmartReaderCache("{not json")).toBeUndefined();
    expect(
      validateSmartReaderCacheEnvelope({
        ...current,
        settings: { ...preferences, recentRetention: "twelve" }
      })
    ).toBeUndefined();
    expect(
      validateSmartReaderCacheEnvelope({
        ...current,
        session: {
          activeTabId: "tab-1",
          sidebarOpen: true,
          tabs: [{ ...session.tabs[0], fileSource: { kind: "browser-file", objectUrl: "blob:test" } }]
        }
      })
    ).toBeUndefined();
  });

  it("merges imported cache by stable identity and keeps latest progress metadata", () => {
    const current = createSmartReaderCacheEnvelope({
      settings: { ...preferences, epubFontSize: 16 },
      recentFiles: [{ ...recentFile, lastOpenedAt: 50, resumeLabel: "Page 2" }],
      readingProgress: [{ ...progress, location: { kind: "page", page: 2 }, updatedAt: 50 }],
      session
    });
    const incoming = createSmartReaderCacheEnvelope({
      settings: preferences,
      recentFiles: [recentFile],
      readingProgress: [progress],
      session,
      adapterCache: adapter
    });

    const merged = mergeSmartReaderCache(current, incoming);

    expect(merged.settings.epubFontSize).toBe(18);
    expect(merged.recentFiles).toHaveLength(1);
    expect(merged.recentFiles[0].resumeLabel).toBe("Page 7");
    expect(merged.readingProgress).toEqual([progress]);
    expect(merged.adapterCache.searchIndexes).toEqual(adapter.searchIndexes);
  });

  it("imports cache text and persists through localStorage fallback", () => {
    const envelope = createSmartReaderCacheEnvelope({
      settings: preferences,
      recentFiles: [recentFile],
      readingProgress: [progress],
      session
    });
    const exported = exportSmartReaderCache(envelope);

    expect(importSmartReaderCache(exported)).toEqual(envelope);

    writeSmartReaderCache(envelope);

    expect(readSmartReaderCache()).toEqual(envelope);

    localStorage.setItem("smartreader.cache.v1", "{not json");

    expect(readSmartReaderCache()).toBeUndefined();
  });
});
