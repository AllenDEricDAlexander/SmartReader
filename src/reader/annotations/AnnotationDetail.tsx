import { Copy, LocateFixed, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReaderAnnotation } from '../../annotations/annotationModels';
import { TagPicker } from '../../tags/TagPicker';
import type { Tag } from '../../tags/tagModels';

type AnnotationDetailProps = {
  annotation: ReaderAnnotation | null;
  tags: Tag[];
  onJumpToPage(page: number): void;
  onDeleteAnnotation(annotationId: number): void;
  onSaveNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  onToggleTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
};

function getAnnotationText(annotation: ReaderAnnotation): string {
  return annotation.text ?? annotation.quote ?? '';
}

export function AnnotationDetail({
  annotation,
  tags,
  onJumpToPage,
  onDeleteAnnotation,
  onSaveNote,
  onToggleTag,
}: AnnotationDetailProps) {
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    setNoteText(annotation?.text ?? '');
  }, [annotation?.id, annotation?.text]);

  if (!annotation) {
    return (
      <section className="panel-section">
        <div className="panel-title">
          <h3>Annotation detail</h3>
        </div>
        <p className="muted-copy">Select an annotation to inspect it.</p>
      </section>
    );
  }

  const annotationText = getAnnotationText(annotation);
  const persisted = annotation.id !== null;
  const noteEditable = persisted && annotation.type === 'note';
  const noteChanged = noteText !== (annotation.text ?? '');

  return (
    <section className="panel-section">
      <div className="panel-title">
        <h3>Annotation detail</h3>
      </div>
      <dl className="document-facts">
        <div>
          <dt>Type</dt>
          <dd>{annotation.type}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>Page {annotation.page}</dd>
        </div>
        <div>
          <dt>Color</dt>
          <dd>
            <span className="color-dot inline" style={{ backgroundColor: annotation.color }} />
            {annotation.color}
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{new Date(annotation.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
      {annotation.quote ? (
        <blockquote className="annotation-quote">{annotation.quote}</blockquote>
      ) : null}
      <label className="annotation-note-field">
        Note
        <input
          aria-label="Annotation note"
          value={noteText}
          disabled={!noteEditable}
          onChange={(event) => setNoteText(event.target.value)}
        />
      </label>
      <TagPicker
        tags={tags}
        selectedTagIds={annotation.tagIds ?? []}
        disabled={!persisted}
        onToggleTag={(tag, selected) => onToggleTag(annotation, tag, selected)}
      />
      <div className="control-grid two">
        <button type="button" onClick={() => onJumpToPage(annotation.page)}>
          <LocateFixed size={14} />
          Jump
        </button>
        <button
          type="button"
          onClick={() => void onSaveNote(annotation, noteText)}
          disabled={!noteEditable || !noteChanged}
        >
          Save note
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(annotationText)}
          disabled={!annotationText}
        >
          <Copy size={14} />
          Copy text
        </button>
        {persisted ? (
          <button
            type="button"
            className="danger-action"
            onClick={() => onDeleteAnnotation(annotation.id!)}
          >
            <Trash2 size={14} />
            Delete
          </button>
        ) : null}
      </div>
    </section>
  );
}
