import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import { ReaderEmptyState } from '../reader/ReaderEmptyState';
import { ReaderErrorState } from '../reader/ReaderErrorState';
import { PdfViewerBridge, type PdfRenderer } from '../viewer/PdfViewerBridge';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';

type ReaderViewerContentProps = {
  activeSession: DocumentSession | null;
  annotations: ReaderAnnotation[];
  controller: ViewerController;
  renderer?: PdfRenderer;
  viewerSource: ViewerSource | null;
  onHighlightSelection: Parameters<typeof PdfViewerBridge>[0]['onHighlightSelection'];
  onLoadError: Parameters<typeof PdfViewerBridge>[0]['onLoadError'];
  onOpenPdf(): void;
  onProgressChange: Parameters<typeof PdfViewerBridge>[0]['onProgressChange'];
  onRetry(sessionId: string): void;
  onSearchStateChange: Parameters<typeof PdfViewerBridge>[0]['onSearchStateChange'];
  onDocumentInfo: Parameters<typeof PdfViewerBridge>[0]['onDocumentInfo'];
};

export function ReaderViewerContent({
  activeSession,
  annotations,
  controller,
  renderer,
  viewerSource,
  onHighlightSelection,
  onLoadError,
  onOpenPdf,
  onProgressChange,
  onRetry,
  onSearchStateChange,
  onDocumentInfo,
}: ReaderViewerContentProps) {
  if (!activeSession) {
    return <ReaderEmptyState onOpenPdf={onOpenPdf} />;
  }

  if (activeSession.status === 'error') {
    return (
      <ReaderErrorState
        title={activeSession.title}
        message={activeSession.errorMessage}
        canRetry={activeSession.source.kind === 'desktop-path'}
        onRetry={() => onRetry(activeSession.id)}
      />
    );
  }

  return (
    <PdfViewerBridge
      source={viewerSource}
      annotations={annotations}
      controller={controller}
      renderer={renderer}
      onHighlightSelection={onHighlightSelection}
      onProgressChange={onProgressChange}
      onLoadError={onLoadError}
      onSearchStateChange={onSearchStateChange}
      onDocumentInfo={onDocumentInfo}
    />
  );
}
