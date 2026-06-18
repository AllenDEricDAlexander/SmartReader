import { FileText, Search, Star } from 'lucide-react';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import type { Tag } from '../tags/tagModels';
import { AnnotationDetail } from './annotations/AnnotationDetail';
import { SearchInspector } from './search/SearchInspector';

type ReaderRightPanelProps = {
  activeSession: DocumentSession | null;
  selectedAnnotation: ReaderAnnotation | null;
  tags: Tag[];
  searchText: string;
  lastSearchCommand: string;
  isFavorite: boolean;
  onSearchTextChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
  onClearSearch(): void;
  onSearchNext(): void;
  onSearchPrevious(): void;
  onJumpToPage(page: number): void;
  onFitWidth(): void;
  onFitPage(): void;
  onToggleFavorite(): void | Promise<void>;
  onDeleteAnnotation(annotationId: number): void;
  onSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  onToggleAnnotationTag(
    annotation: ReaderAnnotation,
    tag: Tag,
    selected: boolean,
  ): void | Promise<void>;
};

export function ReaderRightPanel({
  activeSession,
  selectedAnnotation,
  tags,
  searchText,
  lastSearchCommand,
  isFavorite,
  onSearchTextChange,
  onOpenSearch,
  onSearch,
  onClearSearch,
  onSearchNext,
  onSearchPrevious,
  onJumpToPage,
  onFitWidth,
  onFitPage,
  onToggleFavorite,
  onDeleteAnnotation,
  onSaveAnnotationNote,
  onToggleAnnotationTag,
}: ReaderRightPanelProps) {
  return (
    <aside className="reader-right-panel" aria-label="阅读检查器">
      <section className="panel-section">
        <div className="panel-title">
          <FileText size={16} />
          <h2>Document</h2>
        </div>
        {activeSession ? (
          <dl className="document-facts">
            <div>
              <dt>File</dt>
              <dd>{activeSession.title}</dd>
            </div>
            <div>
              <dt>Page</dt>
              <dd>
                {activeSession.page}
                {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''}
              </dd>
            </div>
            <div>
              <dt>Zoom</dt>
              <dd>{Math.round(activeSession.zoom * 100)}%</dd>
            </div>
          </dl>
        ) : (
          <p className="muted-copy">No active document</p>
        )}
        <button
          type="button"
          className={isFavorite ? 'favorite-toggle active' : 'favorite-toggle'}
          onClick={() => void onToggleFavorite()}
          disabled={!activeSession}
          aria-pressed={isFavorite}
        >
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          {isFavorite ? '取消收藏' : '收藏文档'}
        </button>
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <Search size={16} />
          <h3>Find</h3>
        </div>
        <input
          aria-label="Inspector search text"
          className="toolbar-input wide"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          onFocus={onOpenSearch}
        />
        <button type="button" onClick={onSearch}>
          Search document
        </button>
      </section>
      <SearchInspector
        query={searchText}
        lastSearchCommand={lastSearchCommand}
        onPrevious={onSearchPrevious}
        onNext={onSearchNext}
        onJumpToPage={() => onJumpToPage(activeSession?.page ?? 1)}
        onFitWidth={onFitWidth}
        onFitPage={onFitPage}
        onClearSearch={onClearSearch}
      />
      <AnnotationDetail
        annotation={selectedAnnotation}
        tags={tags}
        onJumpToPage={onJumpToPage}
        onDeleteAnnotation={onDeleteAnnotation}
        onSaveNote={onSaveAnnotationNote}
        onToggleTag={onToggleAnnotationTag}
      />
    </aside>
  );
}
