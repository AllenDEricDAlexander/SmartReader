import { BookMarked, Clock3, FileSearch, Images, StickyNote } from 'lucide-react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import { exportAnnotations } from '../annotations/annotationStore';
import type { DocumentSession } from '../documents/documentModels';
import { mapDocumentsToRecentFiles } from '../library/recentFiles';
import type { PersistedDocument } from '../persistence/persistenceApi';

type ReaderLeftPanelProps = {
  activeSession: DocumentSession | null;
  recentDocuments: PersistedDocument[];
  bookmarks: Bookmark[];
  annotations: ReaderAnnotation[];
  onJumpToPage(page: number): void;
  onReopenRecentDocument(document: PersistedDocument): void | Promise<void>;
  onAddBookmark(): void | Promise<void>;
  onDeleteAnnotation(annotationId: number): void;
  onImportAnnotations(json: string): void;
};

export function ReaderLeftPanel({
  activeSession,
  recentDocuments,
  bookmarks,
  annotations,
  onJumpToPage,
  onReopenRecentDocument,
  onAddBookmark,
  onDeleteAnnotation,
  onImportAnnotations,
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
      <section className="panel-section">
        <div className="panel-title">
          <FileSearch size={16} />
          <h3>Search</h3>
        </div>
        <button type="button" className="ghost-row" disabled aria-disabled="true">
          搜索结果
        </button>
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <BookMarked size={16} />
          <h3>Bookmarks</h3>
        </div>
        {bookmarks.length > 0 ? (
          bookmarks.map((bookmark) => (
            <button
              key={bookmark.id ?? `${bookmark.page}-${bookmark.title}`}
              type="button"
              className="side-list-item"
              onClick={() => onJumpToPage(bookmark.page)}
            >
              {bookmark.title}
            </button>
          ))
        ) : (
          <p className="muted-copy">No bookmarks yet</p>
        )}
        <button type="button" onClick={() => void onAddBookmark()}>
          Add bookmark
        </button>
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <StickyNote size={16} />
          <h3>Annotations</h3>
        </div>
        <div className="annotation-actions">
          <button
            type="button"
            onClick={() => {
              const json = exportAnnotations(annotations);
              void navigator.clipboard?.writeText(json);
            }}
          >
            Export annotations
          </button>
        </div>
        {annotations.length > 0 ? (
          annotations.map((annotation) => (
            <div
              key={annotation.id ?? `${annotation.page}-${annotation.createdAt}`}
              className="side-list-row"
            >
              <button
                type="button"
                className="side-list-item"
                onClick={() => onJumpToPage(annotation.page)}
              >
                Page {annotation.page}: {annotation.quote ?? annotation.text ?? annotation.type}
              </button>
              {annotation.id ? (
                <button
                  type="button"
                  aria-label="Delete annotation"
                  onClick={() => onDeleteAnnotation(annotation.id!)}
                >
                  Delete
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="muted-copy">No annotations yet</p>
        )}
        <textarea
          aria-label="Annotation import JSON"
          className="annotation-import"
          onBlur={(event) => {
            if (event.target.value.trim()) {
              onImportAnnotations(event.target.value);
            }
          }}
        />
      </section>
    </aside>
  );
}
