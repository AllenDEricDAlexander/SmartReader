import type { ViewerSearchMatch } from '../../viewer/viewerTypes';

type SearchResultsListProps = {
  matches: ViewerSearchMatch[];
  currentIndex: number;
  onJumpToMatch(index: number): void;
};

export function SearchResultsList({
  matches,
  currentIndex,
  onJumpToMatch,
}: SearchResultsListProps) {
  return (
    <ul className="search-results-list">
      {matches.map((match) => (
        <li key={match.index}>
          <button
            type="button"
            className={
              match.index === currentIndex ? 'search-result-card current' : 'search-result-card'
            }
            aria-current={match.index === currentIndex}
            onClick={() => onJumpToMatch(match.index)}
          >
            <span className="search-result-meta">
              第 {match.page} 页 · 第 {match.index} 处
            </span>
            <small>{match.excerpt}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}
