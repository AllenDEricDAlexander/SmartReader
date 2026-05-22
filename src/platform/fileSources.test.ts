import { describe, expect, it } from "vitest";
import {
  createAccessErrorSession,
  createDesktopPathFile,
  fileNameFromPath,
  isDesktopFileSource,
  isTauriRuntime
} from "./fileSources";

describe("fileSources", () => {
  it("creates desktop path-backed file metadata without requiring a browser File", () => {
    const source = createDesktopPathFile("/Users/mario/Documents/Guide.PDF");

    expect(source).toMatchObject({
      kind: "desktop-path",
      path: "/Users/mario/Documents/Guide.PDF",
      name: "Guide.PDF"
    });
    expect(isDesktopFileSource(source)).toBe(true);
  });

  it("creates an access error session for missing or inaccessible recent paths", () => {
    const session = createAccessErrorSession("/Users/mario/Documents/Missing.epub");

    expect(session.status).toBe("error");
    expect(session.error).toMatchObject({
      kind: "access-denied",
      title: "File access needed",
      message: "SmartReader cannot access this file path. Choose the file again to reopen it."
    });
  });

  it("detects the Tauri runtime without leaking Tauri imports into shared tests", () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });

  it("extracts filenames from Unix and browser-style paths", () => {
    expect(fileNameFromPath("/Users/mario/Books/story.epub")).toBe("story.epub");
    expect(fileNameFromPath("sample.pdf")).toBe("sample.pdf");
  });
});
