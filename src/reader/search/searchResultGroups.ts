import type { ViewerSearchMatch } from '../../viewer/viewerTypes';

export type SearchResultGroup = {
  page: number;
  matches: ViewerSearchMatch[];
};

/**
 * Groups matches by the page they appear on, preserving document order.
 *
 * Matches arrive as a flat, document-ordered list. Readers scan results by
 * location, so the panel presents "page 45, 3 matches" rather than a long
 * undifferentiated list.
 */
export function groupMatchesByPage(matches: ViewerSearchMatch[]): SearchResultGroup[] {
  const groups: SearchResultGroup[] = [];

  for (const match of matches) {
    const current = groups.at(-1);

    if (current && current.page === match.page) {
      current.matches.push(match);
      continue;
    }

    groups.push({ page: match.page, matches: [match] });
  }

  return groups;
}

/** Human-readable summary of a search, e.g. "共 18 个结果 · 5 页". */
export function summariseMatches(matches: ViewerSearchMatch[]): string {
  if (matches.length === 0) {
    return '没有找到匹配内容';
  }

  const pageCount = groupMatchesByPage(matches).length;
  return `共 ${matches.length} 个结果 · ${pageCount} 页`;
}
