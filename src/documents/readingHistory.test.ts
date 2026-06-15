import { describe, expect, it } from 'vitest';
import {
  createReadingHistory,
  pushHardNavigation,
  recordProgressOnly,
  stepBack,
  stepForward,
} from './readingHistory';

describe('readingHistory', () => {
  it('records hard navigations in the back stack', () => {
    const history = createReadingHistory(1);
    const next = pushHardNavigation(history, 8);

    expect(next.currentPage).toBe(8);
    expect(next.backStack).toEqual([1]);
    expect(next.forwardStack).toEqual([]);
  });

  it('does not create history for ordinary progress updates', () => {
    const history = pushHardNavigation(createReadingHistory(1), 4);
    const next = recordProgressOnly(history, 5);

    expect(next.currentPage).toBe(5);
    expect(next.backStack).toEqual([1]);
  });

  it('steps back and forward through hard navigations', () => {
    const history = pushHardNavigation(pushHardNavigation(createReadingHistory(1), 5), 9);

    const back = stepBack(history);
    const forward = stepForward(back);

    expect(back.currentPage).toBe(5);
    expect(back.backStack).toEqual([1]);
    expect(back.forwardStack).toEqual([9]);
    expect(forward.currentPage).toBe(9);
  });
});
