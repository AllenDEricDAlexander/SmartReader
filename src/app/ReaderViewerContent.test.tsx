import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../documents/documentModels';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';
import { ReaderViewerContent } from './ReaderViewerContent';

function createSession(overrides: Partial<DocumentSession> = {}): DocumentSession {
  return {
    id: 'session-a',
    documentKey: 'desktop:/tmp/book.pdf',
    title: 'book.pdf',
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    page: 1,
    totalPages: null,
    progress: 0,
    zoom: 1,
    history: { currentPage: 1, backStack: [], forwardStack: [] },
    status: 'ready',
    errorMessage: null,
    restored: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ReaderViewerContent', () => {
  it('renders the empty state when there is no active session', () => {
    render(
      <ReaderViewerContent
        activeSession={null}
        viewerSource={null}
        annotations={[]}
        controller={new ViewerController()}
        onOpenPdf={vi.fn()}
        onRetry={vi.fn()}
        onHighlightSelection={vi.fn()}
        onProgressChange={vi.fn()}
        onLoadError={vi.fn()}
        onSearchStateChange={vi.fn()}
        onDocumentInfo={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
  });

  it('renders retry state for errored desktop sessions', () => {
    render(
      <ReaderViewerContent
        activeSession={createSession({ status: 'error', errorMessage: 'Cannot read file' })}
        viewerSource={null}
        annotations={[]}
        controller={new ViewerController()}
        onOpenPdf={vi.fn()}
        onRetry={vi.fn()}
        onHighlightSelection={vi.fn()}
        onProgressChange={vi.fn()}
        onLoadError={vi.fn()}
        onSearchStateChange={vi.fn()}
        onDocumentInfo={vi.fn()}
      />,
    );

    expect(screen.getByText('book.pdf')).toBeInTheDocument();
    expect(screen.getByText('Cannot read file')).toBeInTheDocument();
  });

  it('renders the supplied PDF renderer for ready sessions', () => {
    const source: ViewerSource = { sessionId: 'session-a', url: 'blob:book' };

    render(
      <ReaderViewerContent
        activeSession={createSession()}
        viewerSource={source}
        annotations={[]}
        controller={new ViewerController()}
        renderer={() => <div>PDF renderer</div>}
        onOpenPdf={vi.fn()}
        onRetry={vi.fn()}
        onHighlightSelection={vi.fn()}
        onProgressChange={vi.fn()}
        onLoadError={vi.fn()}
        onSearchStateChange={vi.fn()}
        onDocumentInfo={vi.fn()}
      />,
    );

    expect(screen.getByText('PDF renderer')).toBeInTheDocument();
  });
});
