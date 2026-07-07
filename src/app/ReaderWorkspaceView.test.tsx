import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession, DocumentState } from '../documents/documentModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { ViewerController } from '../viewer/viewerController';
import { ReaderWorkspaceView } from './ReaderWorkspaceView';

function createSession(): DocumentSession {
  return {
    id: 'session-a',
    documentKey: 'desktop:/tmp/book.pdf',
    title: 'book.pdf',
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    page: 2,
    totalPages: 10,
    progress: 20,
    zoom: 1,
    history: { currentPage: 2, backStack: [1], forwardStack: [] },
    status: 'ready',
    errorMessage: null,
    restored: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('ReaderWorkspaceView', () => {
  it('renders the active reader workspace shell', () => {
    const activeSession = createSession();
    const documents: DocumentState = {
      sessions: [activeSession],
      activeSessionId: activeSession.id,
      sidebarOpen: true,
    };
    const recentDocuments: PersistedDocument[] = [];
    const annotations: ReaderAnnotation[] = [];

    render(
      <ReaderWorkspaceView
        activeAnnotations={annotations}
        activeBookmarks={[]}
        activeSession={activeSession}
        activeSessionIsFavorite={false}
        activeViewerController={new ViewerController()}
        availableTags={[]}
        documents={documents}
        lastSearchCommand=""
        pageInput="2"
        recentDocuments={recentDocuments}
        searchText=""
        selectedAnnotation={null}
        sidebarOpen={true}
        viewerContent={<div>Viewer content</div>}
        addBookmarkForActivePage={vi.fn()}
        addPageNote={vi.fn()}
        clearSearch={vi.fn()}
        closeActiveTab={vi.fn()}
        deleteAnnotationForDocument={vi.fn()}
        handleBrowserFileChange={vi.fn()}
        handleSaveAnnotationNote={vi.fn()}
        handleToggleActiveFavorite={vi.fn()}
        handleToggleAnnotationTag={vi.fn()}
        handleViewerWheel={vi.fn()}
        importAnnotationsForDocument={vi.fn()}
        jumpToActiveDocumentPage={vi.fn()}
        jumpToPage={vi.fn()}
        openPdfAndIgnoreResult={vi.fn()}
        openSettingsWorkspace={vi.fn()}
        reopenRecentDocument={vi.fn()}
        runSearch={vi.fn()}
        selectReaderSession={vi.fn()}
        setPageInput={vi.fn()}
        setSearchText={vi.fn()}
        setSelectedAnnotationId={vi.fn()}
        setSidebarOpen={vi.fn()}
        stepHistoryBack={vi.fn()}
        stepHistoryForward={vi.fn()}
      />,
    );

    expect(screen.getByText('Viewer content')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /book\.pdf/ })).toBeInTheDocument();
  });
});
