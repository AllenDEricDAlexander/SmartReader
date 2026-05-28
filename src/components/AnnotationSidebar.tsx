import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  annotationTags,
  annotationTypeLabel,
  annotationTypes
} from "../reader/annotations";
import { visibleRowRange } from "../reader/virtualRows";
import type { AnnotationTag, AnnotationType, DocumentSession, ReaderAnnotation, ReaderLocation } from "../types/reader";
import { AnnotationDetailEditor } from "./AnnotationDetailEditor";

const ANNOTATION_ROW_HEIGHT = 82;
const ANNOTATION_OVERSCAN_ROWS = 6;
const ANNOTATION_FALLBACK_VIEWPORT_HEIGHT = 420;

const annotationWindowStyle: CSSProperties = {
  position: "relative"
};

export function AnnotationSidebar(props: {
  session: DocumentSession;
  selectedAnnotationId: string;
  getAnnotationTitle: (annotation: ReaderAnnotation) => string;
  onJump: (location: ReaderLocation) => void;
  onSelectAnnotation: (id: string) => void;
  onClearSelectedAnnotation: () => void;
  onUpdateAnnotation: (id: string, patch: Partial<ReaderAnnotation>) => void;
  onToggleAnnotationHidden: (id: string) => void;
  onToggleAllAnnotationsHidden: () => void;
  onExportAnnotations: (session: DocumentSession) => void;
  onDeleteAnnotation: (id: string) => void;
  scrollTop: number;
  viewportHeight: number;
}) {
  const [annotationTypeFilter, setAnnotationTypeFilter] = useState<AnnotationType | "all">("all");
  const [annotationTagFilter, setAnnotationTagFilter] = useState<AnnotationTag | "all">("all");
  const [showHiddenAnnotations, setShowHiddenAnnotations] = useState(true);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState("");
  const annotationWindowRef = useRef<HTMLDivElement>(null);
  const [annotationWindowOffsetTop, setAnnotationWindowOffsetTop] = useState(0);

  useEffect(() => {
    setConfirmingDeleteId("");
  }, [props.session.id]);

  useEffect(() => {
    const offsetTop = annotationWindowRef.current?.offsetTop ?? 0;
    setAnnotationWindowOffsetTop((current) => (current === offsetTop ? current : offsetTop));
  }, [
    annotationTagFilter,
    annotationTypeFilter,
    props.session.annotations.length,
    props.session.id,
    showHiddenAnnotations
  ]);

  const hasAnnotations = props.session.annotations.length > 0;
  const hasVisibleAnnotations = props.session.annotations.some((annotation) => !annotation.hidden);
  const annotations = props.session.annotations.filter((annotation) => {
    if (!showHiddenAnnotations && annotation.hidden) {
      return false;
    }

    return (
      (annotationTypeFilter === "all" || annotation.type === annotationTypeFilter) &&
      (annotationTagFilter === "all" || annotation.tag === annotationTagFilter)
    );
  });
  const range = visibleRowRange(
    annotations.length,
    ANNOTATION_ROW_HEIGHT,
    Math.max(0, props.scrollTop - annotationWindowOffsetTop),
    props.viewportHeight || ANNOTATION_FALLBACK_VIEWPORT_HEIGHT,
    ANNOTATION_OVERSCAN_ROWS
  );
  const visibleAnnotations = annotations.slice(range.start, range.end);
  const selectedAnnotation = props.session.annotations.find((annotation) => annotation.id === props.selectedAnnotationId);

  return (
    <div className="annotation-sidebar">
      <div className="annotation-filters">
        <select
          aria-label="Annotation type filter"
          value={annotationTypeFilter}
          onChange={(event) => setAnnotationTypeFilter(event.currentTarget.value as AnnotationType | "all")}
        >
          <option value="all">All types</option>
          {annotationTypes.map((type) => (
            <option key={type} value={type}>{annotationTypeLabel(type)}</option>
          ))}
        </select>
        <select
          aria-label="Annotation tag filter"
          value={annotationTagFilter}
          onChange={(event) => setAnnotationTagFilter(event.currentTarget.value as AnnotationTag | "all")}
        >
          <option value="all">All tags</option>
          {annotationTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={showHiddenAnnotations}
            onChange={(event) => setShowHiddenAnnotations(event.currentTarget.checked)}
          />
          Show hidden
        </label>
      </div>
      <div className="annotation-bulk-actions">
        <button
          type="button"
          disabled={!hasAnnotations}
          onClick={() => props.onExportAnnotations(props.session)}
        >
          Export annotations
        </button>
        <button
          type="button"
          disabled={!hasAnnotations}
          onClick={props.onToggleAllAnnotationsHidden}
        >
          {hasVisibleAnnotations ? "Hide all annotations" : "Show all annotations"}
        </button>
      </div>
      {annotations.length === 0 ? (
        <p className="empty-note">No annotations match these filters.</p>
      ) : (
        <div
          ref={annotationWindowRef}
          className="annotation-window"
          style={{
            ...annotationWindowStyle,
            height: `${annotations.length * ANNOTATION_ROW_HEIGHT}px`
          }}
        >
          {visibleAnnotations.map((annotation, offset) => {
            const index = range.start + offset;
            const title = props.getAnnotationTitle(annotation);
            const confirmingDelete = confirmingDeleteId === annotation.id;

            return (
              <div
                key={annotation.id}
                className={`annotation-row ${annotation.hidden ? "hidden" : ""} ${props.selectedAnnotationId === annotation.id ? "active" : ""}`}
                style={{
                  position: "absolute",
                  top: `${index * ANNOTATION_ROW_HEIGHT}px`,
                  left: 0,
                  right: 0,
                  height: `${ANNOTATION_ROW_HEIGHT}px`,
                  boxSizing: "border-box"
                }}
              >
                <button
                  className="annotation-row-main"
                  type="button"
                  onClick={() => {
                    props.onSelectAnnotation(annotation.id);
                    props.onJump(annotation.location);
                  }}
                >
                  <span>
                    <strong>{title}</strong>
                    <small>{annotationTypeLabel(annotation.type)} · {annotation.tag}</small>
                    {annotation.nativePdfKit?.status ? (
                      <small>Native PDFKit: {annotation.nativePdfKit.status}</small>
                    ) : null}
                    {annotation.nativeEpub?.status ? (
                      <small>Native EPUB: {annotation.nativeEpub.status}</small>
                    ) : null}
                  </span>
                </button>
                <div className="annotation-row-actions">
                  <button
                    type="button"
                    aria-label={`${annotation.hidden ? "Show" : "Hide"} annotation ${title}`}
                    onClick={() => props.onToggleAnnotationHidden(annotation.id)}
                  >
                    {annotation.hidden ? "Show" : "Hide"}
                  </button>
                  <button
                    type="button"
                    className={confirmingDelete ? "danger" : ""}
                    aria-label={`${confirmingDelete ? "Confirm delete" : "Delete"} annotation ${title}`}
                    onClick={() => {
                      if (confirmingDelete) {
                        props.onDeleteAnnotation(annotation.id);
                        setConfirmingDeleteId("");
                        return;
                      }

                      setConfirmingDeleteId(annotation.id);
                    }}
                  >
                    {confirmingDelete ? "Confirm" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {selectedAnnotation ? (
        <AnnotationDetailEditor
          annotation={selectedAnnotation}
          fallbackTitle={props.getAnnotationTitle(selectedAnnotation)}
          onChange={(patch) => props.onUpdateAnnotation(selectedAnnotation.id, patch)}
          onClearSelection={props.onClearSelectedAnnotation}
          onDelete={() => props.onDeleteAnnotation(selectedAnnotation.id)}
        />
      ) : null}
    </div>
  );
}
