import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ViewerSearchMatch } from '../../viewer/viewerTypes';
import { SearchResultsList } from './SearchResultsList';

const matches: ViewerSearchMatch[] = [
  { index: 1, page: 2, excerpt: '…first hit in context…' },
  { index: 2, page: 5, excerpt: '…second hit in context…' },
];

describe('SearchResultsList', () => {
  it('lists every match with its page and excerpt', () => {
    render(
      <SearchResultsList matches={matches} currentIndex={1} onJumpToMatch={vi.fn()} />,
    );

    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 2 处')).toBeInTheDocument();
    expect(screen.getByText('…second hit in context…')).toBeInTheDocument();
  });

  it('marks the focused match as current', () => {
    render(
      <SearchResultsList matches={matches} currentIndex={2} onJumpToMatch={vi.fn()} />,
    );

    const [first, second] = screen.getAllByRole('button');

    expect(first).toHaveAttribute('aria-current', 'false');
    expect(second).toHaveAttribute('aria-current', 'true');
  });

  it('jumps to the clicked match by its global index', () => {
    const onJumpToMatch = vi.fn();

    render(
      <SearchResultsList matches={matches} currentIndex={1} onJumpToMatch={onJumpToMatch} />,
    );

    fireEvent.click(screen.getByText('…second hit in context…'));

    expect(onJumpToMatch).toHaveBeenCalledWith(2);
  });
});
