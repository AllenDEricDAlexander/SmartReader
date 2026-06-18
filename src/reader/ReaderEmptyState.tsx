import { FileDown } from 'lucide-react';

type ReaderEmptyStateProps = {
  onOpenPdf(): void | Promise<void>;
};

export function ReaderEmptyState({ onOpenPdf }: ReaderEmptyStateProps) {
  return (
    <section className="reader-empty" aria-label="SmartReader empty reader">
      <FileDown size={28} />
      <h2>Open a PDF to start reading</h2>
      <p>Use the dashboard, drag in a PDF, or open one from the desktop menu.</p>
      <button type="button" onClick={onOpenPdf}>
        打开本地 PDF
      </button>
    </section>
  );
}
