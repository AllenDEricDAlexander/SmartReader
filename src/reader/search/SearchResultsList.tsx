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
    return (
      <p className="muted-copy">
        暂无匹配列表。请使用工具栏「查找 / 上一处 / 下一处」在页面内导航。
      </p>
    );
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
          <span>第 {result.page} 页</span>
          <strong>{result.matchCount} 处匹配</strong>
          <small>{result.excerpt}</small>
        </button>
      ))}
    </div>
  );
}
