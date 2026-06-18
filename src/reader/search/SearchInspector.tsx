type SearchInspectorProps = {
  query: string;
  lastSearchCommand: string;
  onPrevious(): void;
  onNext(): void;
  onJumpToPage(): void;
  onFitWidth(): void;
  onFitPage(): void;
  onClearSearch(): void;
};

export function SearchInspector({
  query,
  lastSearchCommand,
  onPrevious,
  onNext,
  onJumpToPage,
  onFitWidth,
  onFitPage,
  onClearSearch,
}: SearchInspectorProps) {
  return (
    <section className="panel-section">
      <div className="panel-title">
        <h3>Search inspector</h3>
      </div>
      <div className="search-match-strip" aria-live="polite">
        <strong>{query ? query : 'No query'}</strong>
        <span>{lastSearchCommand || 'No search command run'}</span>
      </div>
      <p className="muted-copy">Match counts and advanced search options require viewer support.</p>
      <div className="control-grid two">
        <button type="button" onClick={onPrevious}>
          Previous
        </button>
        <button type="button" onClick={onNext}>
          Next
        </button>
        <button type="button" onClick={onJumpToPage}>
          Jump page
        </button>
        <button type="button" onClick={onFitWidth}>
          Fit width
        </button>
        <button type="button" onClick={onFitPage}>
          Fit page
        </button>
        <button type="button" onClick={onClearSearch}>
          Clear search
        </button>
      </div>
    </section>
  );
}
