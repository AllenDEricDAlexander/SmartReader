import type { AnnotationType, ReaderAnnotation, ReaderLocation } from "../types/reader";

export interface AnnotationSelectionContext {
  selectedText?: string;
  location: ReaderLocation;
  menuLeft: number;
  menuTop: number;
  area?: ReaderAnnotation["area"];
  rects?: ReaderAnnotation["rects"];
}

export function AnnotationQuickMenu(props: {
  context: AnnotationSelectionContext;
  onCreate: (type: AnnotationType) => void;
}) {
  return (
    <div
      className="annotation-quick-menu"
      style={{ left: props.context.menuLeft, top: props.context.menuTop }}
      role="toolbar"
      aria-label="Selection annotation quick menu"
    >
      <button type="button" aria-label="Quick highlight annotation" onClick={() => props.onCreate("highlight")}>
        Highlight
      </button>
      <button type="button" aria-label="Quick underline annotation" onClick={() => props.onCreate("underline")}>
        Underline
      </button>
      <button type="button" aria-label="Quick note annotation" onClick={() => props.onCreate("note")}>
        Note
      </button>
      <details>
        <summary>More</summary>
        <button type="button" onClick={() => props.onCreate("strike")}>Strike</button>
        <button type="button" onClick={() => props.onCreate("wavy")}>Wavy</button>
        <button type="button" onClick={() => props.onCreate("red-text")}>Red text</button>
        <button type="button" onClick={() => props.onCreate("area")}>Area</button>
      </details>
    </div>
  );
}
