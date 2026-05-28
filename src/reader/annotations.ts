import type { AnnotationTag, AnnotationType, ReaderAnnotation } from "../types/reader";

export const annotationTypes: AnnotationType[] = [
  "highlight",
  "underline",
  "strike",
  "wavy",
  "red-text",
  "note",
  "area"
];

export const annotationTags: AnnotationTag[] = [
  "重点",
  "疑问",
  "引用备注",
  "创新点",
  "实验数据",
  "缺陷",
  "个人思考"
];

export const annotationColors = ["#ffe28a", "#9ed7ff", "#b9e88f", "#f4a7a7", "#d7b6ff"];
export const annotationThicknesses = [1, 2, 3, 4];
export const annotationNoteFontFamilies = ["System", "Serif", "Mono"];
export const annotationNoteFontSizes = [12, 14, 16, 18, 20, 24];

export function annotationTypeLabel(type: AnnotationType): string {
  return {
    highlight: "Highlight",
    underline: "Underline",
    strike: "Strike",
    wavy: "Wavy",
    "red-text": "Red text",
    note: "Note",
    area: "Area"
  }[type];
}

export function annotationTitle(annotation: ReaderAnnotation, fallback: string): string {
  return (
    annotation.name?.trim() ||
    annotation.note?.trim() ||
    annotation.selectedText?.trim() ||
    (annotation.type === "area" ? "Area annotation" : fallback)
  );
}

export function safeAnnotationColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : annotationColors[0];
}

export function safeAnnotationThickness(thickness: number): number {
  return annotationThicknesses.includes(thickness) ? thickness : 2;
}

export function safeAnnotationNoteFontSize(fontSize: number | undefined): number {
  return annotationNoteFontSizes.includes(fontSize ?? 0) ? fontSize ?? 14 : 14;
}

export function safeAnnotationNoteFontFamily(fontFamily: string | undefined): string {
  return annotationNoteFontFamilies.includes(fontFamily ?? "") ? fontFamily ?? "System" : "System";
}
