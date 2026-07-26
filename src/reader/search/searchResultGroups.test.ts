import { describe, expect, it } from 'vitest';
import type { ViewerSearchMatch } from '../../viewer/viewerTypes';
import { groupMatchesByPage, summariseMatches } from './searchResultGroups';

function match(index: number, page: number): ViewerSearchMatch {
  return { index, page, excerpt: `hit ${index}` };
}

describe('groupMatchesByPage', () => {
  it('collects consecutive matches on the same page', () => {
    const groups = groupMatchesByPage([match(1, 22), match(2, 22), match(3, 45)]);

    expect(groups).toEqual([
      { page: 22, matches: [match(1, 22), match(2, 22)] },
      { page: 45, matches: [match(3, 45)] },
    ]);
  });

  it('preserves document order', () => {
    const groups = groupMatchesByPage([match(1, 22), match(2, 45), match(3, 46)]);

    expect(groups.map((group) => group.page)).toEqual([22, 45, 46]);
  });

  it('returns nothing for no matches', () => {
    expect(groupMatchesByPage([])).toEqual([]);
  });
});

describe('summariseMatches', () => {
  it('reports totals across pages', () => {
    expect(summariseMatches([match(1, 22), match(2, 22), match(3, 45)])).toBe('共 3 个结果 · 2 页');
  });

  it('says so when nothing matched', () => {
    expect(summariseMatches([])).toBe('没有找到匹配内容');
  });
});
