import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/renderApp';
import { CacheSettings } from './CacheSettings';

describe('CacheSettings', () => {
  it('shows the cache capacity, usage and file count moved from home', () => {
    renderApp(<CacheSettings openSessionCount={2} recentDocumentCount={3}
      cacheStats={{ usedBytes: 1.24 * 1024 ** 3, totalBytes: 5 * 1024 ** 3, fileCount: 42 }} />);
    expect(screen.getByText('1.24 GB / 5 GB')).toBeInTheDocument();
    expect(screen.getByText('已缓存 42 个文件')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '本地缓存使用量' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('2 个活动阅读会话')).toBeInTheDocument();
    expect(screen.getByText('3 条记录')).toBeInTheDocument();
  });

  it.each([
    [8 * 1024 ** 3, 5 * 1024 ** 3, '100'],
    [0, 0, '0'],
    [Number.NaN, 5 * 1024 ** 3, '0'],
  ])('keeps usage within bounds for %s used bytes and %s total bytes', (usedBytes, totalBytes, expected) => {
    renderApp(<CacheSettings openSessionCount={0} recentDocumentCount={0}
      cacheStats={{ usedBytes, totalBytes, fileCount: 0 }} />);
    expect(screen.getByRole('progressbar', { name: '本地缓存使用量' })).toHaveAttribute('aria-valuenow', expected);
  });
});
