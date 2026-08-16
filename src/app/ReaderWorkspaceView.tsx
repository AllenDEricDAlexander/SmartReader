import type { Dispatch, ReactNode, RefObject, SetStateAction, WheelEvent } from 'react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedBookmark, PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import { ReaderLeftPanel } from '../reader/ReaderLeftPanel';
import { ReaderRightPanel } from '../reader/ReaderRightPanel';
import { ReaderStatusBar } from '../reader/ReaderStatusBar';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { ReaderWorkspace } from '../reader/ReaderWorkspace';
import type { ViewerActions } from '../viewer/viewerController';
import type {
  ViewerDocumentInfo,
  ViewerSearchOptions,
  ViewerSearchState,
} from '../viewer/viewerTypes';
import type { SettingsSection } from '../settings/SettingsWorkspace';

type ReaderWorkspaceViewProps = {
  activeAnnotations: ReaderAnnotation[];
  activeBookmarks: PersistedBookmark[];
  activeSession: DocumentSession;
  activeSessionIsFavorite: boolean;
  activeViewerController: ViewerActions;
  availableTags: Tag[];
  lastSearchCommand: string;
  pageInput: string;
  searchState: ViewerSearchState;
  searchOptions: ViewerSearchOptions;
  documentInfo: ViewerDocumentInfo | null;
  documentRecord: PersistedDocument | null;
  searchInputRef: RefObject<HTMLInputElement>;
  searchText: string;
  selectedAnnotation: ReaderAnnotation | null;
  sidebarOpen: boolean;
  viewerContent: ReactNode;
  addBookmarkForActivePage(): void;
  addPageNote(): void;
  clearSearch(): void;
  deleteBookmark(bookmark: Bookmark): void | Promise<void>;
  deleteAnnotationForDocument(documentKey: string, annotationId: number): void;
  handleSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  handleToggleActiveFavorite(): void;
  handleToggleAnnotationTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
  handleViewerWheel(event: WheelEvent<HTMLElement>): void;
  importAnnotationsForDocument(documentKey: string, json: string): Promise<void>;
  jumpToActiveDocumentPage(page: number): void;
  jumpToPage(page: number): void;
  jumpToSearchMatch(index: number): void;
  setSearchOptions(options: ViewerSearchOptions): void;
  openSettingsWorkspace(initialSection?: SettingsSection): void;
  renameBookmark(bookmark: Bookmark, title: string): void | Promise<void>;
  runSearch(keyword: string): void;
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
  lastSearchCommand,
  pageInput,
  searchState,
  searchOptions,
  documentInfo,
  documentRecord,
  searchInputRef,
  searchText,
  selectedAnnotation,
  sidebarOpen,
  viewerContent,
  addBookmarkForActivePage,
  addPageNote,
  clearSearch,
  deleteBookmark,
  deleteAnnotationForDocument,
  handleSaveAnnotationNote,
  handleToggleActiveFavorite,
  handleToggleAnnotationTag,
  handleViewerWheel,
  importAnnotationsForDocument,
  jumpToActiveDocumentPage,
  jumpToPage,
  jumpToSearchMatch,
  setSearchOptions,
  openSettingsWorkspace,
  renameBookmark,
  runSearch,
  setPageInput,
  setSearchText,
  setSelectedAnnotationId,
  setSidebarOpen,
  stepHistoryBack,
  stepHistoryForward,
}: ReaderWorkspaceViewProps) {
  const goToAdjacentPage = (delta: number) => {
    const nextPage = Math.max(1, activeSession.page + delta);
    const capped =
      activeSession.totalPages != null ? Math.min(activeSession.totalPages, nextPage) : nextPage;
    jumpToPage(capped);
  };

  return (
    <ReaderWorkspace
      sidebarOpen={sidebarOpen}
      toolbar={
        <ReaderToolbar
          activeSession={activeSession}
          searchText={searchText}
          searchState={searchState}
          searchInputRef={searchInputRef}
          pageInput={pageInput}
          sidebarOpen={sidebarOpen}
          onSearchTextChange={setSearchText}
          onPageInputChange={setPageInput}
          onSearch={() => runSearch(searchText)}
          onSearchNext={() => activeViewerController.searchNext()}
          onSearchPrevious={() => activeViewerController.searchPrevious()}
          onJumpToPage={() => jumpToPage(Number(pageInput))}
          onPagePrevious={() => goToAdjacentPage(-1)}
          onPageNext={() => goToAdjacentPage(1)}
          onFitWidth={() => activeViewerController.fitWidth()}
          onFitPage={() => activeViewerController.fitPage()}
          onZoomIn={() => activeViewerController.zoomIn()}
          onZoomOut={() => activeViewerController.zoomOut()}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
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
          bookmarks={activeBookmarks}
          annotations={activeAnnotations}
          selectedAnnotationId={selectedAnnotation?.id ?? null}
          onJumpToPage={jumpToActiveDocumentPage}
          onAddBookmark={addBookmarkForActivePage}
          onDeleteBookmark={deleteBookmark}
          onRenameBookmark={renameBookmark}
          onAddNote={addPageNote}
          onSelectAnnotation={(annotation) => setSelectedAnnotationId(annotation.id)}
          onDeleteAnnotation={(annotationId) =>
            deleteAnnotationForDocument(activeSession.documentKey, annotationId)
          }
          onImportAnnotations={(json) => importAnnotationsForDocument(activeSession.documentKey, json)}
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
          searchState={searchState}
          searchOptions={searchOptions}
          documentInfo={documentInfo}
          documentRecord={documentRecord}
          lastSearchCommand={lastSearchCommand}
          isFavorite={activeSessionIsFavorite}
          onSearchTextChange={setSearchText}
          onSearch={() => runSearch(searchText)}
          onClearSearch={clearSearch}
          onSearchNext={() => activeViewerController.searchNext()}
          onSearchPrevious={() => activeViewerController.searchPrevious()}
          onJumpToMatch={jumpToSearchMatch}
          onSearchOptionsChange={setSearchOptions}
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
