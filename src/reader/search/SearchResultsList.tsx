import type { ViewerSearchMatch } from '../../viewer/viewerTypes';
import { groupMatchesByPage } from './searchResultGroups';

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
  const groups = groupMatchesByPage(matches);

  return (
    <div className="search-results-list">
      {groups.map((group) => (
        <section key={group.page} className="search-result-group">
          <header className="search-result-group-head">
            <span>第 {group.page} 页</span>
            <span className="search-result-group-count">匹配 {group.matches.length}</span>
          </header>
          <ul>
            {group.matches.map((match) => (
              <li key={match.index}>
                <button
                  type="button"
                  className={
                    match.index === currentIndex
                      ? 'search-result-card current'
                      : 'search-result-card'
                  }
                  aria-current={match.index === currentIndex}
                  aria-label={`第 ${match.page} 页，第 ${match.index} 处匹配`}
                  onClick={() => onJumpToMatch(match.index)}
                >
                  <span className="search-result-meta">
                    第 {match.index} / {matches.length} 处
                  </span>
                  <small>{match.excerpt}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
