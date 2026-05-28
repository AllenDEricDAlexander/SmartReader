import { useRef } from "react";

export function PdfAnnotationActions(props: {
  onExport: () => void;
  onImport: (content: string) => void | Promise<void>;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);

  return (
    <span className="pdf-annotation-actions">
      <button
        className="toolbar-text-button"
        type="button"
        onClick={props.onExport}
      >
        Export PDF annotations
      </button>
      <button
        className="toolbar-text-button"
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
          if (!file) {
            return;
          }

          void readPdfAnnotationImportFile(file).then(props.onImport).catch(() => undefined);
        }}
      />
    </span>
  );
}

function readPdfAnnotationImportFile(file: File): Promise<string> {
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
