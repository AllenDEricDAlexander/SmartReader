import type { SearchResult } from "../types/reader";

export interface SearchableEpubChapter {
  id: string;
  href: string;
  label: string;
  text: string;
}

export interface SearchablePdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getTextContent: () => Promise<{
      items: unknown[];
    }>;
  }>;
}

export async function searchEpubChapters(
  chapters: SearchableEpubChapter[],
  query: string
): Promise<SearchResult[]> {
  const normalizedQuery = query.toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return chapters.flatMap((chapter, index) =>
    findAllTextMatches(chapter.text, normalizedQuery).map((matchOffset, matchIndex) => ({
      id: `epub-search-${chapter.id}-${matchOffset}`,
      label: chapter.label,
      snippet: snippetFor(chapter.text, matchOffset, query.length),
      location: {
        kind: "epub" as const,
        chapterHref: chapter.href,
        chapterLabel: chapter.label,
        progress: chapters.length > 1 ? index / (chapters.length - 1) : 0
      },
      matchIndex,
      matchOffset
    }))
  );
}

export async function searchPdfDocumentText(
  pdf: SearchablePdfDocument,
  query: string
): Promise<SearchResult[]> {
  const normalizedQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  if (!normalizedQuery) {
    return results;
  }

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(textItemString).join(" ");

    findAllTextMatches(text, normalizedQuery).forEach((index) => {
      results.push({
        id: `search-${pageNumber}-${index}`,
        label: `Page ${pageNumber}`,
        snippet: snippetFor(text, index, query.length),
        location: { kind: "page", page: pageNumber }
      });
    });
  }

  return results;
}

function findAllTextMatches(text: string, normalizedQuery: string): number[] {
  const normalizedText = text.toLowerCase();
  const matches: number[] = [];
  let index = normalizedText.indexOf(normalizedQuery);

  while (index >= 0) {
    matches.push(index);
    index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length);
  }

  return matches;
}

function snippetFor(text: string, index: number, queryLength: number): string {
  return text.slice(Math.max(0, index - 40), index + queryLength + 60);
}

function textItemString(item: unknown): string {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string"
    ? item.str
    : "";
}
