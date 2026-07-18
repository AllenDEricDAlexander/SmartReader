import type { Dispatch, ReactNode, SetStateAction, WheelEvent } from 'react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession, DocumentState } from '../documents/documentModels';
import type { PersistedBookmark, PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import { ReaderLeftPanel } from '../reader/ReaderLeftPanel';
import { ReaderRightPanel } from '../reader/ReaderRightPanel';
import { ReaderStatusBar } from '../reader/ReaderStatusBar';
import { ReaderTabs } from '../reader/ReaderTabs';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { ReaderWorkspace } from '../reader/ReaderWorkspace';
import type { ViewerActions } from '../viewer/viewerController';
import type { SettingsSection } from '../settings/SettingsWorkspace';

type ReaderWorkspaceViewProps = {
  activeAnnotations: ReaderAnnotation[];
  activeBookmarks: PersistedBookmark[];
  activeSession: DocumentSession;
  activeSessionIsFavorite: boolean;
  activeViewerController: ViewerActions;
  availableTags: Tag[];
  documents: DocumentState;
  lastSearchCommand: string;
  pageInput: string;
  recentDocuments: PersistedDocument[];
  searchText: string;
  selectedAnnotation: ReaderAnnotation | null;
  sidebarOpen: boolean;
  viewerContent: ReactNode;
  addBookmarkForActivePage(): void;
  addPageNote(): void;
  clearSearch(): void;
  closeActiveTab(): void;
  deleteBookmark(bookmark: Bookmark): void | Promise<void>;
  deleteAnnotationForDocument(documentKey: string, annotationId: number): void;
  handleBrowserFileChange(event: React.ChangeEvent<HTMLInputElement>): void;
  handleSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  handleToggleActiveFavorite(): void;
  handleToggleAnnotationTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
  handleViewerWheel(event: WheelEvent<HTMLElement>): void;
  importAnnotationsForDocument(documentKey: string, json: string): Promise<void>;
  jumpToActiveDocumentPage(page: number): void;
  jumpToPage(page: number): void;
  openPdfAndIgnoreResult(): void;
  openSettingsWorkspace(initialSection?: SettingsSection): void;
  renameBookmark(bookmark: Bookmark, title: string): void | Promise<void>;
  reopenRecentDocument(document: PersistedDocument): Promise<boolean>;
  runSearch(keyword: string): void;
  selectReaderSession(sessionId: string): void;
  setPageInput(value: string): void;
  setSearchText(value: string): void;
  setSelectedAnnotationId(annotationId: number | null): void;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  stepHistoryBack(): void;
  stepHistoryForward(): void;
};

export function ReaderWorkspaceView({
  activeAnnotations,
  activeBookmarks,
  activeSession,
  activeSessionIsFavorite,
  activeViewerController,
  availableTags,
  documents,
  lastSearchCommand,
  pageInput,
  recentDocuments,
  searchText,
  selectedAnnotation,
  sidebarOpen,
  viewerContent,
  addBookmarkForActivePage,
  addPageNote,
  clearSearch,
  closeActiveTab,
  deleteBookmark,
  deleteAnnotationForDocument,
  handleBrowserFileChange,
  handleSaveAnnotationNote,
  handleToggleActiveFavorite,
  handleToggleAnnotationTag,
  handleViewerWheel,
  importAnnotationsForDocument,
  jumpToActiveDocumentPage,
  jumpToPage,
  openPdfAndIgnoreResult,
  openSettingsWorkspace,
  renameBookmark,
  reopenRecentDocument,
  runSearch,
  selectReaderSession,
  setPageInput,
  setSearchText,
  setSelectedAnnotationId,
  setSidebarOpen,
  stepHistoryBack,
  stepHistoryForward,
}: ReaderWorkspaceViewProps) {
  return (
    <ReaderWorkspace
      sidebarOpen={sidebarOpen}
      tabs={
        <ReaderTabs
          sessions={documents.sessions}
          activeSessionId={documents.activeSessionId}
          onSelectSession={selectReaderSession}
        />
      }
      toolbar={
        <ReaderToolbar
          activeSession={activeSession}
          searchText={searchText}
          pageInput={pageInput}
          onOpenPdf={openPdfAndIgnoreResult}
          onBrowserFileChange={handleBrowserFileChange}
          onSearchTextChange={setSearchText}
          onPageInputChange={setPageInput}
          onOpenSearch={() => activeViewerController.openSearch()}
          onSearch={() => runSearch(searchText)}
          onJumpToPage={() => jumpToPage(Number(pageInput))}
          onFitWidth={() => activeViewerController.fitWidth()}
          onFitPage={() => activeViewerController.fitPage()}
          onZoomIn={() => activeViewerController.zoomIn()}
          onZoomOut={() => activeViewerController.zoomOut()}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onCloseActiveTab={closeActiveTab}
          onHistoryBack={stepHistoryBack}
          onHistoryForward={stepHistoryForward}
          onAddBookmark={addBookmarkForActivePage}
          onAddNote={addPageNote}
          isFavorite={activeSessionIsFavorite}
          onToggleFavorite={handleToggleActiveFavorite}
          onOpenPreferences={() => openSettingsWorkspace()}
        />
      }
      leftPanel={
        <ReaderLeftPanel
          activeSession={activeSession}
          recentDocuments={recentDocuments}
          bookmarks={activeBookmarks}
          annotations={activeAnnotations}
          selectedAnnotationId={selectedAnnotation?.id ?? null}
          searchText={searchText}
          lastSearchCommand={lastSearchCommand}
          onJumpToPage={jumpToActiveDocumentPage}
          onReopenRecentDocument={(document) => void reopenRecentDocument(document)}
          onAddBookmark={addBookmarkForActivePage}
          onDeleteBookmark={deleteBookmark}
          onRenameBookmark={renameBookmark}
          onAddNote={addPageNote}
          onSelectAnnotation={(annotation) => setSelectedAnnotationId(annotation.id)}
          onDeleteAnnotation={(annotationId) =>
            deleteAnnotationForDocument(activeSession.documentKey, annotationId)
          }
          onImportAnnotations={(json) => importAnnotationsForDocument(activeSession.documentKey, json)}
          onSearchTextChange={setSearchText}
          onOpenSearch={() => activeViewerController.openSearch()}
          onSearch={() => runSearch(searchText)}
        />
      }
      viewer={
        <section className="viewer-surface" aria-label="PDF viewer surface" onWheel={handleViewerWheel}>
          {viewerContent}
        </section>
      }
      rightPanel={
        <ReaderRightPanel
          activeSession={activeSession}
          selectedAnnotation={selectedAnnotation}
          tags={availableTags}
          searchText={searchText}
          lastSearchCommand={lastSearchCommand}
          isFavorite={activeSessionIsFavorite}
          onSearchTextChange={setSearchText}
          onOpenSearch={() => activeViewerController.openSearch()}
          onSearch={() => runSearch(searchText)}
          onClearSearch={clearSearch}
          onSearchNext={() => activeViewerController.searchNext()}
          onSearchPrevious={() => activeViewerController.searchPrevious()}
          onJumpToPage={jumpToActiveDocumentPage}
          onFitWidth={() => activeViewerController.fitWidth()}
          onFitPage={() => activeViewerController.fitPage()}
          onToggleFavorite={handleToggleActiveFavorite}
          onDeleteAnnotation={(annotationId) =>
            deleteAnnotationForDocument(activeSession.documentKey, annotationId)
          }
          onSaveAnnotationNote={handleSaveAnnotationNote}
          onToggleAnnotationTag={handleToggleAnnotationTag}
        />
      }
      statusBar={<ReaderStatusBar activeSession={activeSession} />}
    />
  );
}
