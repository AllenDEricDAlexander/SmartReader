import type {
  DesktopPdfKitAnnotationRect,
  DesktopPdfKitSyncAnnotationKind
} from "../platform/tauriBridge";
import type { ReaderAnnotation } from "../types/reader";

export function pdfKitAnnotationRectFromArea(
  area: NonNullable<ReaderAnnotation["area"]>
): DesktopPdfKitAnnotationRect | undefined {
  const viewportHeight = area.viewportHeight;
  const viewportScale = area.viewportScale;

  if (!isPositiveFiniteNumber(viewportHeight) || !isPositiveFiniteNumber(viewportScale)) {
    return;
  }

  const height = Math.max(0.01, area.height / viewportScale);

  return {
    x: roundPdfPoint(Math.max(0, area.left / viewportScale)),
    y: roundPdfPoint(Math.max(0, (viewportHeight - area.top - area.height) / viewportScale)),
    width: roundPdfPoint(Math.max(0.01, area.width / viewportScale)),
    height: roundPdfPoint(height)
  };
}

export function pdfKitAnnotationRectsFromAnnotation(annotation: ReaderAnnotation): DesktopPdfKitAnnotationRect[] {
  const sourceRects = annotation.rects?.length ? annotation.rects : annotation.area ? [annotation.area] : [];

  return sourceRects.flatMap((area) => {
    const rect = pdfKitAnnotationRectFromArea(area);
    return rect ? [rect] : [];
  });
}

export function nativePdfKitAnnotationSyncKind(annotation: ReaderAnnotation): DesktopPdfKitSyncAnnotationKind | undefined {
  if (
    annotation.type === "area" ||
    annotation.type === "note" ||
    annotation.type === "highlight" ||
    annotation.type === "underline" ||
    annotation.type === "strike"
  ) {
    return annotation.type;
  }

  return undefined;
}

export function nativePdfKitUnsupportedReason(annotation: ReaderAnnotation): string | undefined {
  return annotation.type === "wavy" || annotation.type === "red-text"
    ? "unsupported-native-mapping"
    : undefined;
}

function roundPdfPoint(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
