import { Search } from 'lucide-react';
import { SearchResultsList } from './SearchResultsList';

type SearchPanelProps = {
  searchText: string;
  lastSearchCommand: string;
  onSearchTextChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
};

export function SearchPanel({
  searchText,
  lastSearchCommand,
  onSearchTextChange,
  onOpenSearch,
  onSearch,
}: SearchPanelProps) {
  return (
    <section className="panel-section">
      <div className="panel-title">
        <Search size={16} />
        <h3>搜索</h3>
      </div>
      <div className="search-panel-controls">
        <input
          aria-label="Panel search text"
          className="toolbar-input wide"
          value={searchText}
          placeholder="输入关键词…"
          onChange={(event) => onSearchTextChange(event.target.value)}
          onFocus={onOpenSearch}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSearch();
            }
          }}
        />
        <button type="button" onClick={onSearch}>
          查找
        </button>
      </div>
      <div className="search-panel-meta">
        <span>{searchText.trim() ? `关键词：${searchText.trim()}` : '尚未输入关键词'}</span>
        <span>{lastSearchCommand || '尚未执行搜索'}</span>
      </div>
      <SearchResultsList results={[]} onJumpToPage={() => undefined} />
    </section>
  );
}
