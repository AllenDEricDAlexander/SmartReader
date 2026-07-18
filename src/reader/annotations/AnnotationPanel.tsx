import { BookMarked, StickyNote } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Bookmark, ReaderAnnotation } from '../../annotations/annotationModels';
import { AnnotationList } from './AnnotationList';
import { AnnotationToolbar } from './AnnotationToolbar';
import { BookmarkActions } from './BookmarkActions';

type AnnotationPanelProps = {
  bookmarks: Bookmark[];
  annotations: ReaderAnnotation[];
  selectedAnnotationId: number | null;
  onSelectAnnotation(annotation: ReaderAnnotation): void;
  onJumpToPage(page: number): void;
  onAddBookmark(): void | Promise<void>;
  onDeleteBookmark(bookmark: Bookmark): void | Promise<void>;
  onRenameBookmark(bookmark: Bookmark, title: string): void | Promise<void>;
  onAddNote(): void | Promise<void>;
  onDeleteAnnotation(annotationId: number): void;
  onImportAnnotations(json: string): void;
};

export function AnnotationPanel({
  bookmarks,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onJumpToPage,
  onAddBookmark,
  onDeleteBookmark,
  onRenameBookmark,
  onAddNote,
  onDeleteAnnotation,
  onImportAnnotations,
}: AnnotationPanelProps) {
  const [activeTab, setActiveTab] = useState<'bookmarks' | 'annotations'>('annotations');
  const [filter, setFilter] = useState('all');
  const filteredAnnotations = useMemo(
    () =>
      filter === 'all'
        ? annotations
        : annotations.filter((annotation) => annotation.type === filter),
    [annotations, filter],
  );

  return (
    <section className="panel-section annotation-panel">
      <div className="panel-title">
        <StickyNote size={16} />
        <h3>Annotations</h3>
      </div>
      <div className="segmented-control" role="tablist" aria-label="Annotation panel tabs">
        <button
          type="button"
          className={activeTab === 'bookmarks' ? 'active' : ''}
          role="tab"
          aria-selected={activeTab === 'bookmarks'}
          onClick={() => setActiveTab('bookmarks')}
        >
          Bookmarks
        </button>
        <button
          type="button"
          className={activeTab === 'annotations' ? 'active' : ''}
          role="tab"
          aria-selected={activeTab === 'annotations'}
          onClick={() => setActiveTab('annotations')}
        >
          Annotations
        </button>
      </div>
      <AnnotationToolbar
        annotations={annotations}
        filter={filter}
        onFilterChange={setFilter}
        onAddBookmark={onAddBookmark}
        onAddNote={onAddNote}
        onImportAnnotations={onImportAnnotations}
      />
      {activeTab === 'bookmarks' ? (
        <div className="bookmark-list" role="list">
          {bookmarks.length > 0 ? (
            bookmarks.map((bookmark) => (
              <article
                key={bookmark.id ?? `${bookmark.page}-${bookmark.title}`}
                className="bookmark-card"
                role="listitem"
              >
                <button
                  type="button"
                  className="side-list-item bookmark-row"
                  onClick={() => onJumpToPage(bookmark.page)}
                >
                  <BookMarked size={14} />
                  {bookmark.title}
                </button>
                <BookmarkActions
                  bookmark={bookmark}
                  onDelete={onDeleteBookmark}
                  onRename={onRenameBookmark}
                />
              </article>
            ))
          ) : (
            <p className="muted-copy">No bookmarks yet</p>
          )}
        </div>
      ) : (
        <AnnotationList
          annotations={filteredAnnotations}
          selectedAnnotationId={selectedAnnotationId}
          onSelectAnnotation={onSelectAnnotation}
          onJumpToPage={onJumpToPage}
          onDeleteAnnotation={onDeleteAnnotation}
        />
      )}
    </section>
  );
}
