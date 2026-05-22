import { describe, expect, it, vi } from "vitest";
import {
  createEmptySession,
  createSessionFromFile,
  detectDocumentFormat,
  updateSessionLocation,
  updateSessionZoom
} from "./documentSessions";

describe("document session state", () => {
  it("creates PDF and EPUB sessions behind a stable reader boundary", () => {
    const pdf = createSessionFromFile({
      path: "/Users/mario/Documents/spec.pdf",
      name: "spec.pdf",
      size: 1024,
      lastModified: 100
    });
    const epub = createSessionFromFile({
      path: "/Users/mario/Books/novel.epub",
      name: "novel.epub",
      size: 2048,
      lastModified: 200
    });

    expect(pdf.format).toBe("pdf");
    expect(pdf.location.kind).toBe("page");
    expect(pdf.zoom).toBe(1);
    expect(epub.format).toBe("epub");
    expect(epub.location.kind).toBe("epub");
    expect(epub.epubSettings.fontSize).toBe(18);
  });

  it("keeps desktop path source data separate from browser File objects", () => {
    const session = createSessionFromFile({
      kind: "desktop-path",
      path: "/Users/mario/Documents/spec.pdf",
      name: "spec.pdf",
      size: 0,
      lastModified: 0
    });

    expect(session.fileSource.kind).toBe("desktop-path");
    expect(session.filePath).toBe("/Users/mario/Documents/spec.pdf");
    expect(session.source).toBeUndefined();
    expect(session.objectUrl).toBeUndefined();
  });

  it("keeps unsupported files in a tab-level error state", () => {
    const session = createSessionFromFile({
      path: "/Users/mario/Books/archive.mobi",
      name: "archive.mobi",
      size: 4096,
      lastModified: 300
    });

    expect(session.status).toBe("error");
    expect(session.error?.kind).toBe("unsupported-format");
    expect(detectDocumentFormat("archive.mobi")).toBe("unsupported");
  });

  it("updates location and zoom without mutating the previous session", () => {
    const session = createSessionFromFile({
      path: "/Users/mario/Documents/spec.pdf",
      name: "spec.pdf",
      size: 1024,
      lastModified: 100
    });

    const moved = updateSessionLocation(session, { kind: "page", page: 12 });
    const zoomed = updateSessionZoom(moved, 1.25);

    expect(session.location).toEqual({ kind: "page", page: 1 });
    expect(moved.location).toEqual({ kind: "page", page: 12 });
    expect(zoomed.zoom).toBe(1.25);
  });

  it("creates empty tabs for command-driven opening", () => {
    const session = createEmptySession();

    expect(session.status).toBe("empty");
    expect(session.title).toBe("Empty Tab");
    expect(session.format).toBe("empty");
  });
});
