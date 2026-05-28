import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEpubAnchor,
  createDesktopSession,
  desktopOpenPayloadToPath,
  getPdfKitAnnotationCapabilities,
  readDesktopFile,
  readEpubChapter,
  rebindEpubAnchor,
  resolveEpubAnchor,
  syncPdfKitAnnotations
} from "./tauriBridge";

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: coreMocks.invoke
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: fsMocks.readFile
}));

describe("tauriBridge", () => {
  beforeEach(() => {
    coreMocks.invoke.mockReset();
    fsMocks.readFile.mockReset();
  });

  it("converts supported file URL open events to desktop paths", () => {
    expect(desktopOpenPayloadToPath("file:///Users/mario/Books/Guide.pdf")).toBe("/Users/mario/Books/Guide.pdf");
    expect(desktopOpenPayloadToPath("/Users/mario/Books/Story.epub")).toBe("/Users/mario/Books/Story.epub");
  });

  it("rejects unsafe or unsupported desktop open event payloads", () => {
    expect(desktopOpenPayloadToPath("smartreader://open-file")).toBeUndefined();
    expect(desktopOpenPayloadToPath("file:///Users/mario/Books/notes.txt")).toBeUndefined();
    expect(desktopOpenPayloadToPath("https://example.com/Guide.pdf")).toBeUndefined();
  });

  it("creates desktop PDF sessions through metadata validation instead of reading full bytes", async () => {
    coreMocks.invoke.mockResolvedValueOnce({
      id: "/Users/mario/Books/Guide.pdf",
      pageCount: 5,
      outline: []
    });

    const session = await createDesktopSession("/Users/mario/Books/Guide.pdf");

    expect(coreMocks.invoke).toHaveBeenCalledWith("open_pdf_document", {
      path: "/Users/mario/Books/Guide.pdf"
    });
    expect(coreMocks.invoke).not.toHaveBeenCalledWith("read_document", expect.anything());
    expect(session.status).toBe("ready");
    expect(session.format).toBe("pdf");
  });

  it("reads desktop documents with the Tauri fs plugin", async () => {
    fsMocks.readFile.mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70]));

    const data = await readDesktopFile("/Users/mario/Books/Guide.pdf");

    expect(fsMocks.readFile).toHaveBeenCalledWith("/Users/mario/Books/Guide.pdf");
    expect(coreMocks.invoke).not.toHaveBeenCalledWith("read_document", expect.anything());
    expect([...data]).toEqual([37, 80, 68, 70]);
  });

  it("falls back to the validated Rust read command when the Tauri fs plugin scope rejects a path", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("path is not allowed by the fs scope"));
    coreMocks.invoke.mockResolvedValueOnce([37, 80, 68, 70]);

    const data = await readDesktopFile("/Volumes/Research/Guide.pdf");

    expect(fsMocks.readFile).toHaveBeenCalledWith("/Volumes/Research/Guide.pdf");
    expect(coreMocks.invoke).toHaveBeenCalledWith("read_document", {
      path: "/Volumes/Research/Guide.pdf"
    });
    expect([...data]).toEqual([37, 80, 68, 70]);
  });

  it("reads the PDFKit annotation capability matrix through the Tauri bridge", async () => {
    coreMocks.invoke.mockResolvedValueOnce({
      supported: true,
      status: "available",
      writeModes: ["copy"],
      annotations: [
        { kind: "area", supported: true, multiRect: false },
        { kind: "note", supported: true, multiRect: false },
        { kind: "highlight", supported: true, multiRect: true },
        { kind: "wavy", supported: false, multiRect: false, reason: "unsupported-native-mapping" }
      ]
    });

    const capabilities = await getPdfKitAnnotationCapabilities();

    expect(coreMocks.invoke).toHaveBeenCalledWith("get_pdfkit_annotation_capabilities");
    expect(capabilities.annotations.find((item) => item.kind === "wavy")?.reason).toBe(
      "unsupported-native-mapping"
    );
  });

  it("sends idempotent PDFKit annotation sync payloads through the Tauri bridge", async () => {
    coreMocks.invoke.mockResolvedValueOnce({
      supported: true,
      status: "synced",
      sourcePath: "/Users/mario/Books/Guide.pdf",
      managedCopyPath: "/Users/mario/Library/Application Support/SmartReader/Guide.annotated.pdf",
      annotations: [
        {
          id: "annotation-1",
          status: "upserted",
          page: 2,
          kind: "highlight",
          nativeId: "smartreader:annotation-1"
        }
      ]
    });

    const result = await syncPdfKitAnnotations({
      path: "/Users/mario/Books/Guide.pdf",
      managedCopyPath: "/Users/mario/Library/Application Support/SmartReader/Guide.annotated.pdf",
      writeMode: "copy",
      annotations: [
        {
          id: "annotation-1",
          operation: "upsert",
          page: 2,
          kind: "highlight",
          color: "#ffcc00",
          thickness: 2,
          note: "Review",
          rects: [
            { x: 10, y: 20, width: 160, height: 20 },
            { x: 10, y: 50, width: 120, height: 20 }
          ]
        }
      ]
    });

    expect(coreMocks.invoke).toHaveBeenCalledWith("sync_pdfkit_annotations", {
      path: "/Users/mario/Books/Guide.pdf",
      managedCopyPath: "/Users/mario/Library/Application Support/SmartReader/Guide.annotated.pdf",
      writeMode: "copy",
      annotations: [
        {
          id: "annotation-1",
          operation: "upsert",
          page: 2,
          kind: "highlight",
          color: "#ffcc00",
          thickness: 2,
          note: "Review",
          rects: [
            { x: 10, y: 20, width: 160, height: 20 },
            { x: 10, y: 50, width: 120, height: 20 }
          ]
        }
      ]
    });
    expect(result.annotations[0].nativeId).toBe("smartreader:annotation-1");
  });

  it("returns real EPUB chapter DTO resources from the Tauri bridge", async () => {
    coreMocks.invoke.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>Chapter body</p>",
      text: "Chapter body",
      resources: [
        {
          id: "cover",
          href: "OPS/images/cover.png",
          mediaType: "image/png",
          rewrittenUrl: "asset://localhost/cover.png"
        }
      ]
    });

    const chapter = await readEpubChapter("/Users/mario/Books/Story.epub", "OPS/chapter-1.xhtml");

    expect(coreMocks.invoke).toHaveBeenCalledWith("read_epub_chapter", {
      path: "/Users/mario/Books/Story.epub",
      href: "OPS/chapter-1.xhtml"
    });
    expect(chapter.resources).toEqual([
      {
        id: "cover",
        href: "OPS/images/cover.png",
        mediaType: "image/png",
        rewrittenUrl: "asset://localhost/cover.png"
      }
    ]);
  });

  it("sends precise EPUB anchor commands through the Tauri bridge", async () => {
    const anchor = {
      chapterHref: "OPS/chapter-one.xhtml",
      selectedText: "repeat",
      occurrenceIndex: 1,
      startOffset: 20,
      endOffset: 26,
      prefix: "Alpha repeat beta ",
      suffix: " gamma repeat delta",
      textHash: "fnv1a64:text",
      anchorHash: "fnv1a64:anchor",
      cfiHint: "epubcfi(/legacy)"
    };
    coreMocks.invoke
      .mockResolvedValueOnce(anchor)
      .mockResolvedValueOnce({ status: "resolved", anchor, selectedText: "repeat", occurrenceIndex: 1, startOffset: 20, endOffset: 26 })
      .mockResolvedValueOnce({ status: "rebound", anchor: { ...anchor, occurrenceIndex: 2 }, selectedText: "repeat", occurrenceIndex: 2, startOffset: 42, endOffset: 48 });

    await expect(
      createEpubAnchor({
        path: "/Users/mario/Books/Story.epub",
        chapterHref: "OPS/chapter-one.xhtml",
        selectedText: "repeat",
        occurrenceIndex: 1,
        cfiHint: "epubcfi(/legacy)"
      })
    ).resolves.toEqual(anchor);
    await expect(resolveEpubAnchor("/Users/mario/Books/Story.epub", anchor)).resolves.toMatchObject({
      status: "resolved"
    });
    await expect(rebindEpubAnchor("/Users/mario/Books/Story.epub", anchor)).resolves.toMatchObject({
      status: "rebound",
      occurrenceIndex: 2
    });

    expect(coreMocks.invoke).toHaveBeenNthCalledWith(1, "create_epub_anchor", {
      path: "/Users/mario/Books/Story.epub",
      chapterHref: "OPS/chapter-one.xhtml",
      selectedText: "repeat",
      occurrenceIndex: 1,
      cfiHint: "epubcfi(/legacy)"
    });
    expect(coreMocks.invoke).toHaveBeenNthCalledWith(2, "resolve_epub_anchor", {
      path: "/Users/mario/Books/Story.epub",
      anchor
    });
    expect(coreMocks.invoke).toHaveBeenNthCalledWith(3, "rebind_epub_anchor", {
      path: "/Users/mario/Books/Story.epub",
      anchor
    });
  });
});
