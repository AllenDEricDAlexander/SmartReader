import { describe, expect, it, vi } from "vitest";
import { createDesktopSession, desktopOpenPayloadToPath } from "./tauriBridge";

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
});
