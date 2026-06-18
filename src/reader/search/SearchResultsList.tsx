export type SearchResult = {
  id: string;
  page: number;
  matchCount: number;
  excerpt: string;
};

type SearchResultsListProps = {
  results: SearchResult[];
  onJumpToPage(page: number): void;
};

export function SearchResultsList({ results, onJumpToPage }: SearchResultsListProps) {
  if (results.length === 0) {
    return <p className="muted-copy">Viewer match details are not available yet.</p>;
  }

  return (
    <div className="search-results-list" role="list">
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          className="search-result-card"
          onClick={() => onJumpToPage(result.page)}
          role="listitem"
        >
          <span>Page {result.page}</span>
          <strong>{result.matchCount} match</strong>
          <small>{result.excerpt}</small>
        </button>
      ))}
    </div>
  );
}
