import { BookMarked, Clock3, Images } from 'lucide-react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import { mapDocumentsToRecentFiles } from '../library/recentFiles';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { AnnotationPanel } from './annotations/AnnotationPanel';
import { SearchPanel } from './search/SearchPanel';

type ReaderLeftPanelProps = {
  activeSession: DocumentSession | null;
  recentDocuments: PersistedDocument[];
  bookmarks: Bookmark[];
  annotations: ReaderAnnotation[];
  selectedAnnotationId: number | null;
  searchText: string;
  lastSearchCommand: string;
  onJumpToPage(page: number): void;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
  onAddBookmark(): void | Promise<void>;
  onAddNote(): void | Promise<void>;
  onSelectAnnotation(annotation: ReaderAnnotation): void;
  onDeleteAnnotation(annotationId: number): void;
  onImportAnnotations(json: string): void;
  onSearchTextChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
};

export function ReaderLeftPanel({
  activeSession,
  recentDocuments,
  bookmarks,
  annotations,
  selectedAnnotationId,
  searchText,
  lastSearchCommand,
  onJumpToPage,
  onReopenRecentDocument,
  onAddBookmark,
  onAddNote,
  onSelectAnnotation,
  onDeleteAnnotation,
  onImportAnnotations,
  onSearchTextChange,
  onOpenSearch,
  onSearch,
}: ReaderLeftPanelProps) {
  const recentFiles = mapDocumentsToRecentFiles(recentDocuments).slice(0, 4);

  return (
    <aside className="reader-left-panel" aria-label="阅读侧栏">
      <div className="panel-section">
        <div className="panel-title">
          <BookMarked size={16} />
          <h2>Reading</h2>
        </div>
        {activeSession ? (
          <p>{Math.round(activeSession.progress * 100)}% complete</p>
        ) : (
          <p>No document selected</p>
        )}
      </div>
      <section className="panel-section">
        <div className="panel-title">
          <Clock3 size={16} />
          <h3>Recent</h3>
        </div>
        {recentFiles.length > 0 ? (
          recentFiles.map((file) => {
            const document = recentDocuments.find(
              (candidate) => candidate.documentKey === file.documentKey,
            );

            return (
              <button
                key={file.documentKey}
                type="button"
                className="side-list-item"
                aria-label={`Open recent ${file.title}`}
                onClick={() => {
                  if (document) {
                    void onReopenRecentDocument(document);
                  }
                }}
              >
                {file.title}
              </button>
            );
          })
        ) : (
          <p className="muted-copy">No recent files</p>
        )}
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <Images size={16} />
          <h3>Thumbnails</h3>
        </div>
        <button type="button" className="ghost-row" disabled aria-disabled="true">
          页面缩略图
        </button>
      </section>
      <SearchPanel
        searchText={searchText}
        lastSearchCommand={lastSearchCommand}
        onSearchTextChange={onSearchTextChange}
        onOpenSearch={onOpenSearch}
        onSearch={onSearch}
      />
      <AnnotationPanel
        bookmarks={bookmarks}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        onSelectAnnotation={onSelectAnnotation}
        onJumpToPage={onJumpToPage}
        onAddBookmark={onAddBookmark}
        onAddNote={onAddNote}
        onDeleteAnnotation={onDeleteAnnotation}
        onImportAnnotations={onImportAnnotations}
      />
    </aside>
  );
}
