import { Search } from 'lucide-react';
import type { ViewerSearchState } from '../../viewer/viewerTypes';
import { SearchResultsList } from './SearchResultsList';

type SearchInspectorProps = {
  query: string;
  lastSearchCommand: string;
  searchState: ViewerSearchState;
  onQueryChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
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
  onQueryChange,
  onOpenSearch,
  onSearch,
  onPrevious,
  onNext,
  onJumpToMatch,
  onJumpToPage,
  onFitWidth,
  onFitPage,
  onClearSearch,
}: SearchInspectorProps) {
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
          onFocus={onOpenSearch}
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
      <div className="search-match-strip" aria-live="polite">
        <strong>{query.trim() ? query.trim() : '未输入关键词'}</strong>
        <span>
          {searchState.keyword
            ? searchState.matches.length > 0
              ? `第 ${searchState.currentIndex} / ${searchState.matches.length} 处匹配`
              : '没有找到匹配内容'
            : lastSearchCommand || '尚未执行搜索'}
        </span>
      </div>
      {searchState.matches.length > 0 ? (
        <SearchResultsList
          matches={searchState.matches}
          currentIndex={searchState.currentIndex}
          onJumpToMatch={onJumpToMatch}
        />
      ) : null}
      <div className="control-grid two">
        <button type="button" onClick={onPrevious}>
          上一处
        </button>
        <button type="button" onClick={onNext}>
          下一处
        </button>
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
