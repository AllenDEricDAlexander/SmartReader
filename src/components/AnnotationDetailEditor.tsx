import { useEffect, useState } from "react";
import {
  annotationColors,
  annotationNoteFontFamilies,
  annotationNoteFontSizes,
  annotationTags,
  annotationThicknesses,
  annotationTypeLabel,
  annotationTypes,
  safeAnnotationNoteFontFamily,
  safeAnnotationNoteFontSize
} from "../reader/annotations";
import type { AnnotationTag, AnnotationType, ReaderAnnotation } from "../types/reader";

export function AnnotationDetailEditor(props: {
  annotation: ReaderAnnotation;
  fallbackTitle: string;
  onChange: (patch: Partial<ReaderAnnotation>) => void;
  onClearSelection: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(props.annotation.name?.trim() || props.fallbackTitle);

  useEffect(() => {
    setName(props.annotation.name?.trim() || props.fallbackTitle);
  }, [props.annotation.id, props.annotation.name, props.fallbackTitle]);

  return (
    <section className="annotation-detail-editor" aria-label="Selected annotation details">
      <label>
        Name
        <input
          aria-label="Annotation name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed) {
              setName(props.annotation.name?.trim() || props.fallbackTitle);
              return;
            }

            props.onChange({ name: trimmed });
            setName(trimmed);
          }}
        />
      </label>
      <label>
        Type
        <select
          aria-label="Selected annotation type"
          value={props.annotation.type}
          onChange={(event) => props.onChange({ type: event.currentTarget.value as AnnotationType })}
        >
          {annotationTypes.map((type) => (
            <option key={type} value={type}>{annotationTypeLabel(type)}</option>
          ))}
        </select>
      </label>
      <label>
        Tag
        <select
          aria-label="Selected annotation tag"
          value={props.annotation.tag}
          onChange={(event) => props.onChange({ tag: event.currentTarget.value as AnnotationTag })}
        >
          {annotationTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </label>
      <label>
        Color
        <select
          aria-label="Selected annotation color"
          value={props.annotation.color}
          onChange={(event) => props.onChange({ color: event.currentTarget.value })}
        >
          {annotationColors.map((color) => (
            <option key={color} value={color}>{color}</option>
          ))}
        </select>
      </label>
      <label>
        Thickness
        <select
          aria-label="Selected annotation thickness"
          value={props.annotation.thickness}
          onChange={(event) => props.onChange({ thickness: Number(event.currentTarget.value) })}
        >
          {annotationThicknesses.map((thickness) => (
            <option key={thickness} value={thickness}>{thickness}px</option>
          ))}
        </select>
      </label>
      <label>
        Note
        <input
          aria-label="Selected annotation note"
          value={props.annotation.note ?? ""}
          onChange={(event) => props.onChange({ note: event.currentTarget.value })}
        />
      </label>
      <label>
        Font
        <select
          aria-label="Selected annotation note font"
          value={safeAnnotationNoteFontFamily(props.annotation.noteFontFamily)}
          onChange={(event) => props.onChange({ noteFontFamily: event.currentTarget.value })}
        >
          {annotationNoteFontFamilies.map((font) => (
            <option key={font} value={font}>{font}</option>
          ))}
        </select>
      </label>
      <label>
        Size
        <select
          aria-label="Selected annotation note font size"
          value={safeAnnotationNoteFontSize(props.annotation.noteFontSize)}
          onChange={(event) => props.onChange({ noteFontSize: Number(event.currentTarget.value) })}
        >
          {annotationNoteFontSizes.map((fontSize) => (
            <option key={fontSize} value={fontSize}>{fontSize}px</option>
          ))}
        </select>
      </label>
      <label className="annotation-detail-check">
        <input
          type="checkbox"
          checked={!props.annotation.hidden}
          onChange={(event) => props.onChange({ hidden: !event.currentTarget.checked })}
        />
        Visible
      </label>
      <button type="button" onClick={props.onClearSelection}>
        Cancel annotation selection
      </button>
      <button type="button" className="danger" onClick={props.onDelete}>
        Delete selected annotation
      </button>
    </section>
  );
}
