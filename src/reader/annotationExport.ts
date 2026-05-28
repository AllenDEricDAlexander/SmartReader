import { annotationTitle as readerAnnotationTitle, annotationTypeLabel } from "./annotations";
import type { DocumentSession, ReaderAnnotation, ReaderLocation } from "../types/reader";

export function annotationsToMarkdown(session: DocumentSession): string {
  const documentTitle = markdownExportValue(session.title);
  const lines = [
    `# ${documentTitle} annotations`,
    "",
    `- Document: ${documentTitle}`,
    `- Exported at: ${formatAnnotationTime(Date.now())}`,
    `- Count: ${session.annotations.length}`,
    ""
  ];

  session.annotations.forEach((annotation, index) => {
    lines.push(
      `## ${index + 1}. ${markdownExportValue(annotationTitle(annotation))}`,
      "",
      `- Document: ${documentTitle}`,
      `- Location: ${markdownExportValue(locationToStatus(annotation.location, session.pageCount))}`,
      `- Type: ${annotationTypeLabel(annotation.type)}`,
      `- Tag: ${annotation.tag}`,
      `- Color: ${annotation.color}`,
      `- Thickness: ${annotation.thickness}`,
      `- Selected text: ${markdownExportValue(annotation.selectedText?.trim() ?? "")}`,
      `- Note: ${markdownExportValue(annotation.note?.trim() ?? "")}`,
      `- Created: ${formatAnnotationTime(annotation.createdAt)}`,
      `- Updated: ${formatAnnotationTime(annotation.updatedAt)}`,
      ""
    );
  });

  return lines.join("\n");
}

export function downloadSafeName(name: string): string {
  const safeName = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return safeName || "document";
}

function annotationTitle(annotation: ReaderAnnotation): string {
  return readerAnnotationTitle(annotation, locationToStatus(annotation.location));
}

function locationToStatus(location: ReaderLocation, pageCount?: number): string {
  if (location.kind === "page") {
    return pageCount ? `${location.page} / ${pageCount}` : `Page ${location.page}`;
  }

  if (location.kind === "epub") {
    return location.chapterLabel ?? `${Math.round(location.progress * 100)}%`;
  }

  return "";
}

function markdownExportValue(value: string): string {
  return escapeHtml(value.trim().replace(/\r\n?/g, "\n"))
    .replace(/([\\`*_{}\[\]()#+!|>\-])/g, "\\$1")
    .replace(/\n/g, "\\n");
}

function formatAnnotationTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
