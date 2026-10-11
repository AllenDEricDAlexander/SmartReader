import type { Paper } from './libraryModels';

export type PaperSearchHit = {
  paperId: string;
  page: number;
  snippet: string;
  score: number;
};

type SearchEntry = {
  paperId: string;
  page: number;
  text: string;
  metadataText: string;
  title: string;
  bodyTokens: Set<string>;
};

export class LibrarySearchIndex {
  private readonly entries = new Map<number, SearchEntry>();
  private readonly postings = new Map<string, Map<number, number>>();

  rebuild(papers: Paper[]): void {
    this.entries.clear();
    this.postings.clear();
    for (const paper of papers) {
      const metadataFields: Array<[string, number]> = [
        [paper.metadata.title, 8],
        [paper.fileName, 2],
        [paper.metadata.authors.join(' '), 4],
        [paper.metadata.doi, 8],
        [paper.metadata.keywords.join(' '), 6],
        [paper.metadata.researchTopics.join(' '), 6],
        [paper.metadata.researchFields.join(' '), 4],
        [paper.metadata.disciplines.join(' '), 4],
        [paper.metadata.journal, 2],
        [paper.metadata.journalType, 2],
        [paper.metadata.year, 2],
        [paper.metadata.abstract, 2],
      ];
      const metadataWeights = new Map<string, number>();
      for (const [value, weight] of metadataFields) {
        for (const token of new Set(tokenize(value))) {
          metadataWeights.set(token, (metadataWeights.get(token) ?? 0) + weight);
        }
      }
      const pages = paper.pages.length > 0 ? paper.pages : [{ page: 1, text: '' }];
      for (const page of pages) {
        const id = this.entries.size;
        const bodyCounts = new Map<string, number>();
        for (const token of tokenize(page.text)) {
          bodyCounts.set(token, (bodyCounts.get(token) ?? 0) + 1);
        }
        const weights = new Map(metadataWeights);
        for (const [token, count] of bodyCounts) {
          weights.set(token, (weights.get(token) ?? 0) + 1 + Math.log(count));
        }
        this.entries.set(id, {
          paperId: paper.id,
          page: page.page,
          text: displayText(page.text),
          metadataText: displayText(metadataFields.map(([value]) => value).filter(Boolean).join(' · ')),
          title: normalize(paper.metadata.title),
          bodyTokens: new Set(bodyCounts.keys()),
        });
        for (const [token, weight] of weights) {
          let posting = this.postings.get(token);
          if (!posting) {
            posting = new Map();
            this.postings.set(token, posting);
          }
          posting.set(id, weight);
        }
      }
    }
  }

  search(query: string, options: { limit?: number; paperIds?: string[] } = {}): PaperSearchHit[] {
    const tokens = [...new Set(tokenize(query, true))];
    const limit = Math.max(0, Math.floor(options.limit ?? 40));
    if (tokens.length === 0 || limit === 0) {
      return [];
    }
    const postings = tokens.map((token) => this.postings.get(token));
    if (postings.some((posting) => !posting)) {
      return [];
    }
    const smallest = postings.reduce((left, right) => left!.size <= right!.size ? left : right)!;
    const allowedIds = options.paperIds === undefined ? null : new Set(options.paperIds);
    const phrase = normalize(query);
    const hits: PaperSearchHit[] = [];
    for (const id of smallest.keys()) {
      const entry = this.entries.get(id)!;
      if ((allowedIds && !allowedIds.has(entry.paperId)) || postings.some((posting) => !posting!.has(id))) {
        continue;
      }
      const hasBodyMatch = tokens.some((token) => entry.bodyTokens.has(token));
      if (!hasBodyMatch && entry.page !== 1) {
        continue;
      }
      let score = postings.reduce((total, posting) =>
        total + posting!.get(id)! * (1 + Math.log((this.entries.size + 1) / (posting!.size + 1))), 0);
      if (entry.title.includes(phrase)) {
        score += 12;
      }
      if (normalize(entry.text).includes(phrase)) {
        score += tokens.length > 1 ? 5 : 1;
      }
      hits.push({
        paperId: entry.paperId,
        page: entry.page,
        snippet: snippet(hasBodyMatch ? entry.text : entry.metadataText, phrase, tokens),
        score,
      });
    }
    return hits
      .sort((left, right) => right.score - left.score || left.paperId.localeCompare(right.paperId) || left.page - right.page)
      .slice(0, limit);
  }
}

function displayText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  return displayText(text).toLowerCase();
}

function tokenize(text: string, query = false): string[] {
  const tokens: string[] = [];
  for (const word of normalize(text).match(/[\p{L}\p{N}]+/gu) ?? []) {
    for (const part of word.match(/[\p{Script=Han}]+|[^\p{Script=Han}]+/gu) ?? []) {
      if (/\p{Script=Han}/u.test(part)) {
        const characters = Array.from(part);
        if (!query || characters.length === 1) {
          tokens.push(...characters);
        }
        for (let index = 0; index < characters.length - 1; index += 1) {
          tokens.push(characters[index] + characters[index + 1]);
        }
      } else {
        tokens.push(part);
      }
    }
  }
  return tokens;
}

function snippet(text: string, phrase: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  const phrasePosition = lower.indexOf(phrase);
  const positions = tokens.map((token) => lower.indexOf(token)).filter((position) => position >= 0);
  const match = phrasePosition >= 0 ? phrasePosition : positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, match - 60);
  const end = Math.min(text.length, start + 200);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
