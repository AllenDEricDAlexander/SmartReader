import { describe, expect, it } from "vitest";
import { createSessionFromFile } from "./documentSessions";
import { clearRecentFiles, recordRecentFile } from "./recentFiles";

describe("recent file store", () => {
  it("records supported files with resume metadata first", () => {
    const first = createSessionFromFile({
      path: "/Users/mario/Documents/guide.pdf",
      name: "guide.pdf",
      size: 1024,
      lastModified: 100
    });
    const second = createSessionFromFile({
      path: "/Users/mario/Books/story.epub",
      name: "story.epub",
      size: 2048,
      lastModified: 200
    });

    const recent = recordRecentFile(recordRecentFile([], first), second);

    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({
      title: "story.epub",
      format: "epub",
      parentPath: "/Users/mario/Books"
    });
    expect(recent[1].resumeLabel).toBe("Page 1");
  });

  it("records PDF progress, page total, and content labels for recent cards", () => {
    const session = {
      ...createSessionFromFile({
        path: "/Users/mario/Documents/guide.pdf",
        name: "guide.pdf",
        size: 1024,
        lastModified: 100
      }),
      location: { kind: "page" as const, page: 9 },
      pageCount: 12
    };

    const recent = recordRecentFile([], session);

    expect(recent[0].readingProgress).toEqual({
      progressLabel: "75% read",
      positionLabel: "Page 9 of 12",
      contentLabel: "PDF content"
    });
  });

  it("records EPUB progress, chapter position, and current content labels for recent cards", () => {
    const session = {
      ...createSessionFromFile({
        path: "/Users/mario/Books/story.epub",
        name: "story.epub",
        size: 2048,
        lastModified: 200
      }),
      location: {
        kind: "epub" as const,
        chapterHref: "OPS/chapter-2.xhtml",
        chapterLabel: "Results",
        progress: 0.5
      },
      outline: [
        { id: "chapter-1", title: "Intro", location: { kind: "epub" as const, chapterHref: "OPS/chapter-1.xhtml", progress: 0 }, level: 0 },
        { id: "chapter-2", title: "Results", location: { kind: "epub" as const, chapterHref: "OPS/chapter-2.xhtml", chapterLabel: "Results", progress: 0.5 }, level: 0 }
      ]
    };

    const recent = recordRecentFile([], session);

    expect(recent[0].readingProgress).toEqual({
      progressLabel: "50% read",
      positionLabel: "Chapter 2 of 2",
      contentLabel: "Results"
    });
  });

  it("falls back to an explicit unknown progress label when totals are unavailable", () => {
    const session = {
      ...createSessionFromFile({
        path: "/Users/mario/Documents/guide.pdf",
        name: "guide.pdf",
        size: 1024,
        lastModified: 100
      }),
      location: { kind: "page" as const, page: 9 }
    };

    const recent = recordRecentFile([], session);

    expect(recent[0].readingProgress).toEqual({
      progressLabel: "Progress unknown",
      positionLabel: "Page 9",
      contentLabel: "PDF content"
    });
  });

  it("deduplicates by path and respects retention", () => {
    const session = createSessionFromFile({
      path: "/Users/mario/Documents/guide.pdf",
      name: "guide.pdf",
      size: 1024,
      lastModified: 100
    });

    const recent = recordRecentFile(recordRecentFile([], session), session, 1);

    expect(recent).toHaveLength(1);
    expect(clearRecentFiles()).toEqual([]);
  });

  it("records desktop path access metadata for reopen attempts", () => {
    const session = createSessionFromFile({
      kind: "desktop-path",
      path: "/Users/mario/Documents/guide.pdf",
      name: "guide.pdf",
      size: 0,
      lastModified: 0
    });

    const recent = recordRecentFile([], session);

    expect(recent[0]).toMatchObject({
      path: "/Users/mario/Documents/guide.pdf",
      access: "desktop-path"
    });
  });
});
