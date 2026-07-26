import type { ReaderAnnotation } from '../../annotations/annotationModels';

type AnnotationListProps = {
  annotations: ReaderAnnotation[];
  selectedAnnotationId: number | null;
  onSelectAnnotation(annotation: ReaderAnnotation): void;
  onJumpToPage(page: number): void;
  onDeleteAnnotation(annotationId: number): void;
};

const typeLabels: Record<ReaderAnnotation['type'], string> = {
  note: '笔记',
  highlight: '高亮',
  underline: '下划线',
};

function getAnnotationPreview(annotation: ReaderAnnotation): string {
  return annotation.text ?? annotation.quote ?? typeLabels[annotation.type];
}

export function AnnotationList({
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onJumpToPage,
  onDeleteAnnotation,
}: AnnotationListProps) {
  if (annotations.length === 0) {
    return <p className="muted-copy">暂无批注。可选中 PDF 文本添加高亮，或新增页面笔记。</p>;
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
                  第 {annotation.page} 页 · {typeLabels[annotation.type]}
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
                删除
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
