import type { ReaderAnnotation } from '../annotations/annotationModels';
import type {
  ViewerSearchOptions,
  ViewerSearchState,
} from '../viewer/viewerTypes';
import type { DocumentSession } from '../documents/documentModels';
import type { Tag } from '../tags/tagModels';
import { AnnotationDetail } from './annotations/AnnotationDetail';
import { SearchInspector } from './search/SearchInspector';

type ReaderRightPanelProps = {
  activeSession: DocumentSession | null;
  selectedAnnotation: ReaderAnnotation | null;
  tags: Tag[];
  searchText: string;
  searchState: ViewerSearchState;
  searchOptions: ViewerSearchOptions;
  lastSearchCommand: string;
  onSearchTextChange(value: string): void;
  onSearch(): void;
  onClearSearch(): void;
  onSearchNext(): void;
  onSearchPrevious(): void;
  onJumpToMatch(index: number): void;
  onSearchOptionsChange(options: ViewerSearchOptions): void;
  onJumpToPage(page: number): void;
  onFitWidth(): void;
  onFitPage(): void;
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
  searchState,
  searchOptions,
  lastSearchCommand,
  onSearchTextChange,
  onSearch,
  onClearSearch,
  onSearchNext,
  onSearchPrevious,
  onJumpToMatch,
  onSearchOptionsChange,
  onJumpToPage,
  onFitWidth,
  onFitPage,
  onDeleteAnnotation,
  onSaveAnnotationNote,
  onToggleAnnotationTag,
}: ReaderRightPanelProps) {
  return (
    <aside id="reader-inspector" className="reader-right-panel" aria-label="阅读检查器">
      <SearchInspector
        query={searchText}
        lastSearchCommand={lastSearchCommand}
        searchState={searchState}
        searchOptions={searchOptions}
        onQueryChange={onSearchTextChange}
        onSearch={onSearch}
        onPrevious={onSearchPrevious}
        onNext={onSearchNext}
        onJumpToMatch={onJumpToMatch}
        onOptionsChange={onSearchOptionsChange}
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
