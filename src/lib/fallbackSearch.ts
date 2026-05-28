import type { SearchResult } from "../types/reader";

export interface SearchableEpubChapter {
  id: string;
  href: string;
  label: string;
  text: string;
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
