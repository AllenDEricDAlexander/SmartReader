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
        <h3>Search</h3>
      </div>
      <div className="search-panel-controls">
        <input
          aria-label="Panel search text"
          className="toolbar-input wide"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          onFocus={onOpenSearch}
        />
        <button type="button" onClick={onSearch}>
          Run
        </button>
      </div>
      <div className="search-panel-meta">
        <span>{searchText.trim() ? `Query: ${searchText.trim()}` : 'No query entered'}</span>
        <span>{lastSearchCommand || 'No search command run'}</span>
      </div>
      <SearchResultsList results={[]} onJumpToPage={() => undefined} />
    </section>
  );
}
