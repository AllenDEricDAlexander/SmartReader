import { describe, expect, it, vi } from "vitest";
import {
  createDesktopSession,
  desktopOpenPayloadToPath,
  readEpubChapter,
  renderPdfPageImage
} from "./tauriBridge";

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: coreMocks.invoke
}));

describe("tauriBridge", () => {
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

  it("sends typed PDFKit page render payloads through the Tauri bridge", async () => {
    coreMocks.invoke.mockResolvedValueOnce({
      supported: true,
      status: "rendered",
      page: 2,
      width: 1200,
      height: 1600,
      scale: 1.5,
      mimeType: "image/png",
      byteCount: 3,
      bytes: [97, 98, 99]
    });

    const image = await renderPdfPageImage("/Users/mario/Books/Guide.pdf", 2, 1.5);

    expect(coreMocks.invoke).toHaveBeenCalledWith("render_pdf_page_pdfkit", {
      path: "/Users/mario/Books/Guide.pdf",
      page: 2,
      scale: 1.5,
      output: "bytes"
    });
    expect(image.dataUrl).toBe("data:image/png;base64,YWJj");
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
});
