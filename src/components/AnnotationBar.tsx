import { useRef } from "react";
import type { AnnotationTag, AnnotationType } from "../types/reader";
import {
  annotationColors,
  annotationTags,
  annotationThicknesses,
  annotationTypeLabel,
  annotationTypes
} from "../reader/annotations";

export interface AnnotationDraft {
  type: AnnotationType;
  tag: AnnotationTag;
  color: string;
  thickness: number;
  note: string;
}

export function AnnotationBar(props: {
  draft: AnnotationDraft;
  onChange: (draft: AnnotationDraft) => void;
  onAdd: () => void;
  onExportNativePdfAnnotations?: () => void;
  onImportNativePdfAnnotations?: (content: string) => void | Promise<void>;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const showNativePdfAnnotationActions = Boolean(
    props.onExportNativePdfAnnotations &&
    props.onImportNativePdfAnnotations
  );

  return (
    <form
      className="annotation-bar"
      onSubmit={(event) => {
        event.preventDefault();
        props.onAdd();
      }}
    >
      <select
        aria-label="Annotation type"
        value={props.draft.type}
        onChange={(event) => props.onChange({ ...props.draft, type: event.currentTarget.value as AnnotationType })}
      >
        {annotationTypes.map((type) => (
          <option key={type} value={type}>{annotationTypeLabel(type)}</option>
        ))}
      </select>
      <select
        aria-label="Annotation tag"
        value={props.draft.tag}
        onChange={(event) => props.onChange({ ...props.draft, tag: event.currentTarget.value as AnnotationTag })}
      >
        {annotationTags.map((tag) => (
          <option key={tag} value={tag}>{tag}</option>
        ))}
      </select>
      <select
        aria-label="Annotation color"
        value={props.draft.color}
        onChange={(event) => props.onChange({ ...props.draft, color: event.currentTarget.value })}
      >
        {annotationColors.map((color) => (
          <option key={color} value={color}>{color}</option>
        ))}
      </select>
      <select
        aria-label="Annotation thickness"
        value={props.draft.thickness}
        onChange={(event) => props.onChange({ ...props.draft, thickness: Number(event.currentTarget.value) })}
      >
        {annotationThicknesses.map((thickness) => (
          <option key={thickness} value={thickness}>{thickness}px</option>
        ))}
      </select>
      <input
        aria-label="Annotation note"
        placeholder="Note"
        value={props.draft.note}
        onChange={(event) => props.onChange({ ...props.draft, note: event.currentTarget.value })}
      />
      <button type="submit" onMouseDown={(event) => event.preventDefault()}>Add annotation</button>
      {showNativePdfAnnotationActions ? (
        <>
          <button
            type="button"
            onClick={props.onExportNativePdfAnnotations}
          >
            Export PDF annotations
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
          >
            Import PDF annotations
          </button>
          <input
            ref={importInputRef}
            aria-label="Import PDF annotations file"
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file || !props.onImportNativePdfAnnotations) {
                return;
              }

              void readAnnotationImportFile(file).then(props.onImportNativePdfAnnotations).catch(() => undefined);
            }}
          />
        </>
      ) : null}
    </form>
  );
}

function readAnnotationImportFile(file: File): Promise<string> {
  const textReader = (file as File & { text?: () => Promise<string> }).text;
  if (typeof textReader === "function") {
    return textReader.call(file);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
