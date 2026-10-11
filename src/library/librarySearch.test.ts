import { describe, expect, it } from 'vitest';
import { emptyMetadata, type Paper } from './libraryModels';
import { LibrarySearchIndex } from './librarySearch';

function paper(id: string, title: string, texts: string[]): Paper {
  return {
    id,
    fileName: `${id}.pdf`,
    fileSize: 120,
    addedAt: '2026-10-11T00:00:00Z',
    updatedAt: '2026-10-11T00:00:00Z',
    metadata: emptyMetadata(title),
    manualFields: [],
    pages: texts.map((text, index) => ({ page: index + 1, text })),
    pageCount: texts.length,
    indexStatus: 'ready',
    indexError: null,
    aiStatus: 'idle',
    aiError: null,
    favorite: false,
    pinned: false,
    readingSeconds: 0,
    lastReadAt: null,
    lastPage: 1,
    zoom: 1,
    recentHidden: false,
    annotations: [],
    bookmarks: [],
    tagIds: [],
  };
}

describe('library search index', () => {
  it('returns a matching page and a snippet around the evidence across imported papers', () => {
    const index = new LibrarySearchIndex();
    index.rebuild([
      paper('cognitive', 'A psychology study', ['Introduction', `${'Background material. '.repeat(30)}A distinctive memory consolidation finding.`]),
      paper('education', 'Education', ['Different evidence about classrooms.']),
    ]);
    const hits = index.search('memory consolidation');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ paperId: 'cognitive', page: 2 });
    expect(hits[0].snippet).toContain('memory consolidation');
    expect(hits[0].snippet.length).toBeLessThanOrEqual(202);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('normalizes Latin case and Unicode width and requires all query terms', () => {
    const index = new LibrarySearchIndex();
    index.rebuild([
      paper('both', 'Methods', ['Neural NETWORK models']),
      paper('one', 'Other methods', ['A neural mechanism']),
    ]);
    expect(index.search('ＮＥＵＲＡＬ network').map((hit) => hit.paperId)).toEqual(['both']);
    expect(index.search('network absent')).toEqual([]);
  });

  it('retrieves Chinese multi-character and single-character queries without whitespace token boundaries', () => {
    const index = new LibrarySearchIndex();
    index.rebuild([
      paper('chinese', '教育研究', ['认知神经科学的实验方法和记忆研究。']),
      paper('unrelated', '其他研究', ['神经系统与计算科学分别讨论。']),
    ]);
    expect(index.search('神经科学').map((hit) => hit.paperId)).toEqual(['chinese']);
    expect(index.search('忆')[0]).toMatchObject({ paperId: 'chinese', page: 1 });
  });

  it('weights title and keyword matches above incidental body mentions without duplicating metadata-only hits', () => {
    const index = new LibrarySearchIndex();
    const titled = paper('title', 'Cognition and attention', ['First page', 'Second page', 'Third page']);
    const keyword = paper('keyword', 'A related study', ['Methods']);
    keyword.metadata.keywords = ['cognition'];
    index.rebuild([paper('body', 'An unrelated title', ['A short mention of cognition.']), keyword, titled]);
    expect(index.search('cognition').map((hit) => hit.paperId)).toEqual(['title', 'keyword', 'body']);
    expect(index.search('cognition').filter((hit) => hit.paperId === 'title')).toHaveLength(1);
  });

  it('combines paper metadata with page content and supports metadata-only scanned papers', () => {
    const index = new LibrarySearchIndex();
    const study = paper('author', 'A study', ['Introduction', 'Bayesian evidence is discussed here.']);
    study.metadata.authors = ['Ada Researcher'];
    const scan = paper('scan', 'An archival manuscript', []);
    scan.metadata.doi = '10.1234/archive';
    index.rebuild([study, scan]);
    expect(index.search('Ada Bayesian')[0]).toMatchObject({ paperId: 'author', page: 2 });
    expect(index.search('10.1234/archive')[0]).toMatchObject({ paperId: 'scan', page: 1 });
  });

  it('applies caller scope and limits and discards all old postings on rebuild after deletion or locking', () => {
    const index = new LibrarySearchIndex();
    const first = paper('first', 'Cognition', ['Evidence']);
    const second = paper('second', 'Cognition', ['More evidence']);
    index.rebuild([first, second]);
    expect(index.search('cognition', { paperIds: ['second'] }).map((hit) => hit.paperId)).toEqual(['second']);
    expect(index.search('cognition', { paperIds: [] })).toEqual([]);
    expect(index.search('cognition', { limit: 1 })).toHaveLength(1);
    expect(index.search('cognition', { limit: 0 })).toEqual([]);
    index.rebuild([second]);
    expect(index.search('cognition').map((hit) => hit.paperId)).toEqual(['second']);
    index.rebuild([]);
    expect(index.search('cognition')).toEqual([]);
  });

  it('returns no results for blank or punctuation-only input', () => {
    const index = new LibrarySearchIndex();
    index.rebuild([paper('one', 'Some title', ['Some text'])]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('!?--')).toEqual([]);
  });
});
