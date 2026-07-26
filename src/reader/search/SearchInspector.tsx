import { Search } from 'lucide-react';
import type { ViewerSearchOptions, ViewerSearchState } from '../../viewer/viewerTypes';
import { SearchResultsList } from './SearchResultsList';
import { summariseMatches } from './searchResultGroups';

type SearchInspectorProps = {
  query: string;
  lastSearchCommand: string;
  searchState: ViewerSearchState;
  searchOptions: ViewerSearchOptions;
  onQueryChange(value: string): void;
  onSearch(): void;
  onOptionsChange(options: ViewerSearchOptions): void;
  onPrevious(): void;
  onNext(): void;
  onJumpToMatch(index: number): void;
  onJumpToPage(): void;
  onFitWidth(): void;
  onFitPage(): void;
  onClearSearch(): void;
};

export function SearchInspector({
  query,
  lastSearchCommand,
  searchState,
  searchOptions,
  onQueryChange,
  onSearch,
  onOptionsChange,
  onPrevious,
  onNext,
  onJumpToMatch,
  onJumpToPage,
  onFitWidth,
  onFitPage,
  onClearSearch,
}: SearchInspectorProps) {
  const hasMatches = searchState.matches.length > 0;
  const hasSearched = Boolean(searchState.keyword);

  return (
    <section className="panel-section">
      <div className="panel-title">
        <Search size={16} />
        <h3>文档搜索</h3>
      </div>
      <div className="search-panel-controls">
        <input
          aria-label="Inspector search text"
          className="toolbar-input wide"
          value={query}
          placeholder="输入关键词…"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) {
                onPrevious();
              } else {
                onSearch();
              }
            }
          }}
        />
        <button type="button" onClick={onSearch} aria-label="Search document">
          搜索
        </button>
      </div>

      {hasSearched ? (
        <div className="search-current-match" aria-live="polite">
          <span>当前匹配</span>
          <strong>
            {searchState.currentIndex} / {searchState.matches.length}
          </strong>
        </div>
      ) : null}

      <div className="search-match-strip" aria-live="polite">
        <strong>{query.trim() ? query.trim() : '未输入关键词'}</strong>
        <span>
          {hasSearched ? summariseMatches(searchState.matches) : lastSearchCommand || '尚未执行搜索'}
        </span>
      </div>

      <div className="control-grid two">
        <button type="button" onClick={onPrevious} disabled={!hasMatches}>
          上一处 (⇧↑)
        </button>
        <button type="button" onClick={onNext} disabled={!hasMatches}>
          下一处 (⇧↓)
        </button>
      </div>

      {hasMatches ? (
        <SearchResultsList
          matches={searchState.matches}
          currentIndex={searchState.currentIndex}
          onJumpToMatch={onJumpToMatch}
        />
      ) : null}

      <fieldset className="search-options">
        <legend>搜索选项</legend>
        <label>
          <input
            type="checkbox"
            checked={searchOptions.matchCase}
            onChange={(event) =>
              onOptionsChange({ ...searchOptions, matchCase: event.target.checked })
            }
          />
          <span>区分大小写</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={searchOptions.wholeWords}
            onChange={(event) =>
              onOptionsChange({ ...searchOptions, wholeWords: event.target.checked })
            }
          />
          <span>全字匹配</span>
        </label>
      </fieldset>

      <div className="control-grid two">
        <button type="button" onClick={onJumpToPage}>
          定位当前页
        </button>
        <button type="button" onClick={onFitWidth} aria-label="Fit width">
          适合宽度
        </button>
        <button type="button" onClick={onFitPage} aria-label="Fit page">
          适合整页
        </button>
        <button type="button" onClick={onClearSearch} aria-label="Clear search">
          清除搜索
        </button>
      </div>
    </section>
  );
}
