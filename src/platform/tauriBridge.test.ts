import { describe, expect, it } from "vitest";
import { desktopOpenPayloadToPath } from "./tauriBridge";

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
});
