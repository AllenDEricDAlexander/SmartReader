import { describe, expect, it } from 'vitest';
import { getPdfPathsFromArgs } from './pathFilters';

describe('pathFilters', () => {
  it('extracts PDF paths from Open With args', () => {
    expect(getPdfPathsFromArgs(['SmartReader', '/tmp/a.pdf', '--flag', '/tmp/b.txt'])).toEqual([
      '/tmp/a.pdf',
    ]);
  });
});
