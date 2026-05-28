import {
  safeAnnotationColor,
  safeAnnotationNoteFontFamily,
  safeAnnotationNoteFontSize,
  safeAnnotationThickness
} from "./annotations";
import type { ReaderAnnotation, ReaderLocation } from "../types/reader";

export function renderEpubHtml(
  html: string,
  annotations: ReaderAnnotation[],
  searchTarget: { query: string; occurrenceIndex: number } | undefined,
  selectedAnnotationId: string,
  annotationTitle: (annotation: ReaderAnnotation) => string
): string {
  const hasTextAnnotations = annotations.some((annotation) => Boolean(annotation.selectedText?.trim()));
  const query = searchTarget?.query.trim() ?? "";

  if (!hasTextAnnotations && !query) {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");

  if (hasTextAnnotations) {
    annotations.forEach((annotation) => {
      const selectedText = annotation.selectedText?.trim();
      if (selectedText) {
        applyAnnotationToDocument(document, annotation, selectedText, selectedAnnotationId, annotationTitle);
      }
    });
  }

  if (query) {
    applySearchHighlightToDocument(document, query, searchTarget?.occurrenceIndex ?? 0);
  }

  return document.body.innerHTML;
}

export function highlightCurrentSearchMatch(html: string, query: string, occurrenceIndex = 0): string {
  if (!query) {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  applySearchHighlightToDocument(document, query, occurrenceIndex);

  return document.body.innerHTML;
}

export function createEpubSelectionCfi(selection: Selection, location: ReaderLocation): string {
  const selectedText = selection.toString().trim();
  const chapterHref = location.kind === "epub" ? location.chapterHref ?? "chapter" : "chapter";
  const offset = Math.max(0, selection.anchorOffset);
  return `epubcfi(${encodeURIComponent(chapterHref)}:${offset}:${encodeURIComponent(selectedText.slice(0, 40))})`;
}

export function createEpubLocationCfi(location: ReaderLocation): string {
  const chapterHref = location.kind === "epub" ? location.chapterHref ?? "chapter" : "chapter";
  const scrollTop = location.kind === "epub" ? Math.max(0, Math.round(location.scrollTop ?? 0)) : 0;
  return `epubcfi(${encodeURIComponent(chapterHref)}:${scrollTop})`;
}

function applyAnnotationToDocument(
  document: Document,
  annotation: ReaderAnnotation,
  selectedText: string,
  selectedAnnotationId: string,
  annotationTitle: (annotation: ReaderAnnotation) => string
) {
  if (annotation.location.kind === "epub" && annotation.location.anchor) {
    const anchored = applyAnchoredAnnotationToDocument(
      document,
      annotation,
      selectedAnnotationId,
      annotationTitle
    );

    if (anchored) {
      return;
    }
  }

  const matcher = new RegExp(selectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const text = textNode.nodeValue ?? "";
    const match = matcher.exec(text);

    if (!match) {
      node = walker.nextNode();
      continue;
    }

    const fragment = document.createDocumentFragment();
    if (match.index > 0) {
      fragment.append(document.createTextNode(text.slice(0, match.index)));
    }

    const span = document.createElement("span");
    span.className = `reader-annotation ${annotation.type}${selectedAnnotationId === annotation.id ? " selected" : ""}`;
    span.setAttribute("data-annotation-id", annotation.id);
    span.setAttribute("title", annotationTitle(annotation));
    span.setAttribute("style", annotationInlineStyle(annotation));
    span.textContent = match[0];
    fragment.append(span);

    const cursor = match.index + match[0].length;
    if (cursor < text.length) {
      fragment.append(document.createTextNode(text.slice(cursor)));
    }

    textNode.replaceWith(fragment);
    break;
  }
}

function applyAnchoredAnnotationToDocument(
  document: Document,
  annotation: ReaderAnnotation,
  selectedAnnotationId: string,
  annotationTitle: (annotation: ReaderAnnotation) => string
): boolean {
  if (annotation.location.kind !== "epub" || !annotation.location.anchor) {
    return false;
  }

  const anchor = annotation.location.anchor;
  const startOffset = Math.max(0, anchor.startOffset);
  const endOffset = Math.max(startOffset, anchor.endOffset);

  if (endOffset === startOffset) {
    return false;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let cursor = 0;

  while (node) {
    const textNode = node as Text;
    const text = textNode.nodeValue ?? "";
    const nextCursor = cursor + text.length;

    if (startOffset >= cursor && endOffset <= nextCursor) {
      const localStart = startOffset - cursor;
      const localEnd = endOffset - cursor;
      const anchoredText = text.slice(localStart, localEnd);

      if (anchoredText !== anchor.selectedText) {
        return false;
      }

      const fragment = document.createDocumentFragment();
      if (localStart > 0) {
        fragment.append(document.createTextNode(text.slice(0, localStart)));
      }

      const span = document.createElement("span");
      span.className = `reader-annotation ${annotation.type}${selectedAnnotationId === annotation.id ? " selected" : ""}`;
      span.setAttribute("data-annotation-id", annotation.id);
      span.setAttribute("title", annotationTitle(annotation));
      span.setAttribute("style", annotationInlineStyle(annotation));
      span.textContent = anchoredText;
      fragment.append(span);

      if (localEnd < text.length) {
        fragment.append(document.createTextNode(text.slice(localEnd)));
      }

      textNode.replaceWith(fragment);
      return true;
    }

    cursor = nextCursor;
    node = walker.nextNode();
  }

  return false;
}

function annotationInlineStyle(annotation: ReaderAnnotation): string {
  const color = safeAnnotationColor(annotation.color);
  const thickness = safeAnnotationThickness(annotation.thickness);

  if (annotation.type === "underline") {
    return `text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: ${thickness}px;`;
  }

  if (annotation.type === "strike") {
    return `text-decoration: line-through; text-decoration-color: ${color}; text-decoration-thickness: ${thickness}px;`;
  }

  if (annotation.type === "wavy") {
    return `text-decoration: underline wavy; text-decoration-color: ${color}; text-decoration-thickness: ${thickness}px;`;
  }

  if (annotation.type === "red-text") {
    return "color: #b42318;";
  }

  if (annotation.type === "note") {
    return `border-bottom: ${thickness}px solid ${color}; font-size: ${safeAnnotationNoteFontSize(annotation.noteFontSize)}px; font-family: ${annotationNoteCssFontFamily(annotation.noteFontFamily)};`;
  }

  return `background: ${color};`;
}

function applySearchHighlightToDocument(document: Document, query: string, occurrenceIndex = 0) {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escapedQuery, "i");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remainingOccurrences = Math.max(0, occurrenceIndex);

  while (node) {
    const textNode = node as Text;
    const text = textNode.nodeValue ?? "";
    let match = matcher.exec(text);

    if (!match) {
      node = walker.nextNode();
      continue;
    }

    while (match && remainingOccurrences > 0) {
      remainingOccurrences -= 1;
      matcher.lastIndex = 0;
      const nextStart = match.index + match[0].length;
      match = matcher.exec(text.slice(nextStart));
      if (match) {
        match.index += nextStart;
      }
    }

    if (!match) {
      node = walker.nextNode();
      continue;
    }

    const fragment = document.createDocumentFragment();
    if (match.index > 0) {
      fragment.append(document.createTextNode(text.slice(0, match.index)));
    }

    const mark = document.createElement("mark");
    mark.className = "search-highlight current";
    mark.textContent = match[0];
    fragment.append(mark);
    const cursor = match.index + match[0].length;
    if (cursor < text.length) {
      fragment.append(document.createTextNode(text.slice(cursor)));
    }

    textNode.replaceWith(fragment);
    break;
  }
}

function annotationNoteCssFontFamily(fontFamily: string | undefined): string {
  const cssFonts: Record<string, string> = {
    System: "var(--font-ui)",
    Serif: "var(--font-serif)",
    Mono: "var(--font-mono)"
  };

  return cssFonts[safeAnnotationNoteFontFamily(fontFamily)] ?? cssFonts.System;
}
