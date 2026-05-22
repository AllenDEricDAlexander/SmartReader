import { describe, expect, it, vi } from "vitest";
import { outlineFromPdf } from "./pdfOutline";

describe("outlineFromPdf", () => {
  it("resolves direct and named PDF destinations to page locations", async () => {
    const pageOneRef = { num: 10, gen: 0 };
    const pageThreeRef = { num: 30, gen: 0 };
    const pdf = {
      getOutline: vi.fn().mockResolvedValue([
        { title: "Start", dest: [pageOneRef], items: [] },
        { title: "Details", dest: "details", items: [] }
      ]),
      getDestination: vi.fn().mockResolvedValue([pageThreeRef]),
      getPageIndex: vi.fn(async (ref: unknown) => (ref === pageOneRef ? 0 : 2))
    };

    const outline = await outlineFromPdf(pdf);

    expect(outline).toEqual([
      { id: "outline-0", title: "Start", location: { kind: "page", page: 1 }, level: 0 },
      { id: "outline-1", title: "Details", location: { kind: "page", page: 3 }, level: 0 }
    ]);
  });

  it("keeps nested outline levels and skips unresolved destinations", async () => {
    const pageTwoRef = { num: 20, gen: 0 };
    const pdf = {
      getOutline: vi.fn().mockResolvedValue([
        {
          title: "Parent",
          dest: null,
          items: [{ title: "Child", dest: [pageTwoRef], items: [] }]
        }
      ]),
      getDestination: vi.fn(),
      getPageIndex: vi.fn().mockResolvedValue(1)
    };

    const outline = await outlineFromPdf(pdf);

    expect(outline).toEqual([
      { id: "outline-0-0", title: "Child", location: { kind: "page", page: 2 }, level: 1 }
    ]);
  });

  it("skips malformed outline entries whose page index lookup rejects", async () => {
    const goodRef = { num: 10, gen: 0 };
    const badRef = { num: 99, gen: 0 };
    const pdf = {
      getOutline: vi.fn().mockResolvedValue([
        { title: "Broken", dest: [badRef], items: [] },
        { title: "Good", dest: [goodRef], items: [] }
      ]),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(async (ref: unknown) => {
        if (ref === badRef) {
          throw new Error("bad destination");
        }
        return 0;
      })
    };

    await expect(outlineFromPdf(pdf)).resolves.toEqual([
      { id: "outline-1", title: "Good", location: { kind: "page", page: 1 }, level: 0 }
    ]);
  });

  it("skips malformed named destinations whose lookup rejects", async () => {
    const pageRef = { num: 10, gen: 0 };
    const pdf = {
      getOutline: vi.fn().mockResolvedValue([
        { title: "Broken Name", dest: "broken", items: [] },
        { title: "Good Name", dest: "good", items: [] }
      ]),
      getDestination: vi.fn(async (name: string) => {
        if (name === "broken") {
          throw new Error("missing destination");
        }
        return [pageRef];
      }),
      getPageIndex: vi.fn().mockResolvedValue(4)
    };

    await expect(outlineFromPdf(pdf)).resolves.toEqual([
      { id: "outline-1", title: "Good Name", location: { kind: "page", page: 5 }, level: 0 }
    ]);
  });

  it("keeps all resolved outline entries instead of truncating long documents", async () => {
    const pageRefs = Array.from({ length: 120 }, (_, index) => ({ num: index + 1, gen: 0 }));
    const pdf = {
      getOutline: vi.fn().mockResolvedValue(
        pageRefs.map((ref, index) => ({
          title: `Section ${index + 1}`,
          dest: [ref],
          items: []
        }))
      ),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(async (ref: unknown) => pageRefs.indexOf(ref as (typeof pageRefs)[number]))
    };

    const outline = await outlineFromPdf(pdf);

    expect(outline).toHaveLength(120);
    expect(outline.at(-1)).toEqual({
      id: "outline-119",
      title: "Section 120",
      location: { kind: "page", page: 120 },
      level: 0
    });
  });
});
