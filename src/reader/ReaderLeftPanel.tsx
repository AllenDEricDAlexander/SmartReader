import { BookMarked } from 'lucide-react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import { AnnotationPanel } from './annotations/AnnotationPanel';

type ReaderLeftPanelProps = {
  activeSession: DocumentSession | null;
  bookmarks: Bookmark[];
  annotations: ReaderAnnotation[];
  selectedAnnotationId: number | null;
  onJumpToPage(page: number): void;
  onAddBookmark(): void | Promise<void>;
  onDeleteBookmark(bookmark: Bookmark): void | Promise<void>;
  onRenameBookmark(bookmark: Bookmark, title: string): void | Promise<void>;
  onAddNote(): void | Promise<void>;
  onSelectAnnotation(annotation: ReaderAnnotation): void;
  onDeleteAnnotation(annotationId: number): void;
  onImportAnnotations(json: string): void;
};

export function ReaderLeftPanel({
  activeSession,
  bookmarks,
  annotations,
  selectedAnnotationId,
  onJumpToPage,
  onAddBookmark,
  onDeleteBookmark,
  onRenameBookmark,
  onAddNote,
  onSelectAnnotation,
  onDeleteAnnotation,
  onImportAnnotations,
}: ReaderLeftPanelProps) {
  const progressPercent = Math.round((activeSession?.progress ?? 0) * 100);

  return (
    <aside className="reader-left-panel" aria-label="阅读侧栏">
      <section className="panel-section reader-progress-card">
        <div className="panel-title">
          <BookMarked size={16} />
          <h2>当前阅读</h2>
        </div>
        {activeSession ? (
          <>
            <p className="reader-progress-title" title={activeSession.title}>
              {activeSession.title}
            </p>
            <div
              className="reader-progress-track"
              role="progressbar"
              aria-label="阅读进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="reader-progress-meta">
              <span>
                第 {activeSession.page}
                {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''} 页
              </span>
              <strong>{progressPercent}%</strong>
            </div>
          </>
        ) : (
          <p className="muted-copy">未打开文档</p>
        )}
      </section>

      <AnnotationPanel
        bookmarks={bookmarks}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        onSelectAnnotation={onSelectAnnotation}
        onJumpToPage={onJumpToPage}
        onAddBookmark={onAddBookmark}
        onDeleteBookmark={onDeleteBookmark}
        onRenameBookmark={onRenameBookmark}
        onAddNote={onAddNote}
        onDeleteAnnotation={onDeleteAnnotation}
        onImportAnnotations={onImportAnnotations}
      />
    </aside>
  );
}
