import type { ReaderAnnotation } from '../../annotations/annotationModels';

type AnnotationListProps = {
  annotations: ReaderAnnotation[];
  selectedAnnotationId: number | null;
  onSelectAnnotation(annotation: ReaderAnnotation): void;
  onJumpToPage(page: number): void;
  onDeleteAnnotation(annotationId: number): void;
};

function getAnnotationPreview(annotation: ReaderAnnotation): string {
  return annotation.text ?? annotation.quote ?? annotation.type;
}

export function AnnotationList({
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onJumpToPage,
  onDeleteAnnotation,
}: AnnotationListProps) {
  if (annotations.length === 0) {
    return <p className="muted-copy">No annotations yet</p>;
  }

  return (
    <div className="annotation-list" role="list">
      {annotations.map((annotation) => {
        const selected = annotation.id !== null && annotation.id === selectedAnnotationId;
        const preview = getAnnotationPreview(annotation);

        return (
          <article
            key={annotation.id ?? `${annotation.page}-${annotation.createdAt}`}
            className={selected ? 'annotation-card selected' : 'annotation-card'}
            role="listitem"
          >
            <button
              type="button"
              className="annotation-card-main"
              onClick={() => {
                onSelectAnnotation(annotation);
                onJumpToPage(annotation.page);
              }}
            >
              <span className="color-dot" style={{ backgroundColor: annotation.color }} />
              <span className="annotation-card-copy">
                <strong>
                  Page {annotation.page} · {annotation.type}
                </strong>
                <span>{preview}</span>
              </span>
            </button>
            {annotation.id ? (
              <button
                type="button"
                className="compact-danger"
                aria-label="Delete annotation"
                onClick={() => onDeleteAnnotation(annotation.id!)}
              >
                Delete
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
