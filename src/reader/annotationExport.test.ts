import { describe, expect, it, vi } from "vitest";
import { annotationsToMarkdown } from "./annotationExport";
import type { DocumentSession } from "../types/reader";

describe("annotation Markdown export", () => {
  it("escapes Markdown-sensitive annotation fields", () => {
    vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"));

    const session: DocumentSession = {
      id: "session-1",
      title: "Report\n# Injected <script>",
      fileSource: { kind: "empty" },
      format: "epub",
      status: "ready",
      location: { kind: "epub", progress: 0.25 },
      lastLocation: { kind: "epub", progress: 0.25 },
      zoom: 1,
      fitMode: "continuous",
      sidebarMode: "annotations",
      outline: [],
      searchResults: [],
      bookmarks: [],
      annotations: [
        {
          id: "annotation-markdown",
          type: "note",
          tag: "引用备注",
          color: "#ffe28a",
          thickness: 2,
          location: {
            kind: "epub",
            chapterHref: "OPS/chapter.xhtml#intro",
            chapterLabel: "Chapter\n# forged location <i>raw</i>",
            progress: 0.25
          },
          selectedText: "Quote\n- forged item <b>raw</b>",
          note: "Note\n## forged heading <img src=x>",
          hidden: false,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      epubSettings: {
        fontSize: 18,
        theme: "system"
      },
      openedAt: 1,
      updatedAt: 1
    };

    const markdown = annotationsToMarkdown(session);

    expect(markdown).toContain("# Report\\n\\# Injected &lt;script&gt; annotations");
    expect(markdown).toContain("## 1. Note\\n\\#\\# forged heading &lt;img src=x&gt;");
    expect(markdown).toContain("- Location: Chapter\\n\\# forged location &lt;i&gt;raw&lt;/i&gt;");
    expect(markdown).toContain("- Selected text: Quote\\n\\- forged item &lt;b&gt;raw&lt;/b&gt;");
    expect(markdown).toContain("- Note: Note\\n\\#\\# forged heading &lt;img src=x&gt;");
    expect(markdown).toContain("- Exported at: 2026-05-26T00:00:00.000Z");
    expect(markdown).not.toContain("\n# Injected <script>");
    expect(markdown).not.toContain("\n# forged location <i>raw</i>");
    expect(markdown).not.toContain("\n## forged heading <img src=x>");
  });
});
