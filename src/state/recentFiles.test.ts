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
