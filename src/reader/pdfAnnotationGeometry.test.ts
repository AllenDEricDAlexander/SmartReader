import { describe, expect, it } from "vitest";
import {
  nativePdfKitAnnotationSyncKind,
  pdfKitAnnotationRectFromArea
} from "./pdfAnnotationGeometry";
import type { ReaderAnnotation } from "../types/reader";

describe("PDF annotation geometry helpers", () => {
  it("converts viewport annotation area into PDFKit point coordinates", () => {
    expect(
      pdfKitAnnotationRectFromArea({
        page: 1,
        left: 24,
        top: 24,
        width: 180,
        height: 48,
        viewportHeight: 900,
        viewportScale: 1.1
      })
    ).toEqual({
      x: 21.82,
      y: 752.73,
      width: 163.64,
      height: 43.64
    });
  });

  it("rejects areas that do not have positive viewport metadata", () => {
    expect(
      pdfKitAnnotationRectFromArea({
        page: 1,
        left: 24,
        top: 24,
        width: 180,
        height: 48
      })
    ).toBeUndefined();
  });

  it("keeps the current native PDFKit annotation sync kind contract", () => {
    const baseAnnotation: ReaderAnnotation = {
      id: "annotation-1",
      type: "highlight",
      tag: "重点",
      color: "#ffe28a",
      thickness: 2,
      location: { kind: "page", page: 1 },
      createdAt: 1,
      updatedAt: 1
    };

    expect(nativePdfKitAnnotationSyncKind(baseAnnotation)).toBe("highlight");
    expect(nativePdfKitAnnotationSyncKind({ ...baseAnnotation, type: "area" })).toBe("area");
    expect(nativePdfKitAnnotationSyncKind({ ...baseAnnotation, type: "note" })).toBe("note");
    expect(nativePdfKitAnnotationSyncKind({ ...baseAnnotation, type: "wavy" })).toBeUndefined();
  });
});
