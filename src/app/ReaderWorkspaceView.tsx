import { useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction, type WheelEvent } from 'react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedBookmark, PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import { ReaderLeftPanel } from '../reader/ReaderLeftPanel';
import { ReaderDocumentInfoDrawer } from '../reader/ReaderDocumentInfoDrawer';
import { AnnotationDetail } from '../reader/annotations/AnnotationDetail';
import { ReaderStatusBar } from '../reader/ReaderStatusBar';
import { ReaderToolbar } from '../reader/ReaderToolbar';
import { ReaderWorkspace } from '../reader/ReaderWorkspace';
import { PdfOutlineDrawer } from '../reader/PdfOutlineDrawer';
import type { ViewerActions } from '../viewer/viewerController';
import type {
  ViewerDocumentInfo,
  ViewerSearchState,
} from '../viewer/viewerTypes';
import type { SettingsSection } from '../settings/SettingsWorkspace';

type ReaderWorkspaceViewProps = {
  themeSwitcher?: ReactNode;
  activeAnnotations: ReaderAnnotation[];
  activeBookmarks: PersistedBookmark[];
  activeSession: DocumentSession;
  activeSessionIsFavorite: boolean;
  activeViewerController: ViewerActions;
  availableTags: Tag[];
  pageInput: string;
  searchState: ViewerSearchState;
  documentInfo: ViewerDocumentInfo | null;
  documentRecord: PersistedDocument | null;
  searchInputRef: RefObject<HTMLInputElement>;
  searchText: string;
  selectedAnnotation: ReaderAnnotation | null;
  sidebarOpen: boolean;
  viewerContent: ReactNode;
  addBookmarkForActivePage(): void;
  addPageNote(): void;
  deleteBookmark(bookmark: Bookmark): void | Promise<void>;
  deleteAnnotationForDocument(documentKey: string, annotationId: number): void;
  handleSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  handleToggleActiveFavorite(): void;
  handleToggleAnnotationTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
  handleViewerWheel(event: WheelEvent<HTMLElement>): void;
  importAnnotationsForDocument(documentKey: string, json: string): Promise<void>;
  jumpToActiveDocumentPage(page: number): void;
  jumpToPage(page: number): void;
  openSettingsWorkspace(initialSection?: SettingsSection): void;
  renameBookmark(bookmark: Bookmark, title: string): void | Promise<void>;
  setPageInput(value: string): void;
  setSearchText(value: string): void;
  setSearchComposing(composing: boolean): void;
  setSelectedAnnotationId(annotationId: number | null): void;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
};

export function ReaderWorkspaceView({
  themeSwitcher,
  activeAnnotations,
  activeBookmarks,
  activeSession,
  activeSessionIsFavorite,
  activeViewerController,
  availableTags,
  pageInput,
  searchState,
  documentInfo,
  documentRecord,
  searchInputRef,
  searchText,
  selectedAnnotation,
  sidebarOpen,
  viewerContent,
  addBookmarkForActivePage,
  addPageNote,
  deleteBookmark,
  deleteAnnotationForDocument,
  handleSaveAnnotationNote,
  handleToggleActiveFavorite,
  handleToggleAnnotationTag,
  handleViewerWheel,
  importAnnotationsForDocument,
  jumpToActiveDocumentPage,
  jumpToPage,
  openSettingsWorkspace,
  renameBookmark,
  setPageInput,
  setSearchText,
  setSearchComposing,
  setSelectedAnnotationId,
  setSidebarOpen,
}: ReaderWorkspaceViewProps) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [documentInfoOpen, setDocumentInfoOpen] = useState(false);
  const outlineButton = useRef<HTMLButtonElement>(null);
  const documentInfoButton = useRef<HTMLButtonElement>(null);
  const outlineVisible = outlineOpen && activeSession.status !== 'error';
  const activeDocumentInfo = documentInfo?.sessionId === activeSession.id ? documentInfo : null;
  const goToAdjacentPage = (delta: number) => {
    const nextPage = Math.max(1, activeSession.page + delta);
    const capped =
      activeSession.totalPages != null ? Math.min(activeSession.totalPages, nextPage) : nextPage;
    if (capped !== activeSession.page) jumpToPage(capped);
  };

  return (
    <ReaderWorkspace
      toolbar={
        <ReaderToolbar
          themeSwitcher={themeSwitcher}
          activeSession={activeSession}
          searchText={searchText}
          searchState={searchState}
          searchInputRef={searchInputRef}
          pageInput={pageInput}
          sidebarOpen={sidebarOpen}
          outlineOpen={outlineVisible}
          outlineButtonRef={outlineButton}
          onToggleOutline={() => setOutlineOpen((open) => !open)}
          documentInfoOpen={documentInfoOpen}
          documentInfoButtonRef={documentInfoButton}
          onToggleDocumentInfo={() => setDocumentInfoOpen((open) => !open)}
          onSearchTextChange={setSearchText}
          onPageInputChange={setPageInput}
          onSearchCompositionChange={setSearchComposing}
          onSearchNext={() => activeViewerController.searchNext()}
          onSearchPrevious={() => activeViewerController.searchPrevious()}
          onJumpToPage={() => {
            const page = Number(pageInput);
            if (Number.isSafeInteger(page) && page > 0) jumpToPage(page);
          }}
          onPagePrevious={() => goToAdjacentPage(-1)}
          onPageNext={() => goToAdjacentPage(1)}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onAddBookmark={addBookmarkForActivePage}
          onAddNote={addPageNote}
          isFavorite={activeSessionIsFavorite}
          onToggleFavorite={handleToggleActiveFavorite}
          onOpenPreferences={() => openSettingsWorkspace()}
        />
      }
      outlineDrawer={
        <PdfOutlineDrawer
          key={`outline:${activeSession.id}`}
          open={outlineVisible}
          documentTitle={activeSession.title}
          items={activeDocumentInfo?.outline}
          error={activeDocumentInfo?.outlineError}
          currentPage={activeSession.page}
          onJumpToPage={jumpToActiveDocumentPage}
          onClose={() => { setOutlineOpen(false); outlineButton.current?.focus(); }}
        />
      }
      leftPanel={sidebarOpen ? (
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
        >
          {selectedAnnotation ? (
            <AnnotationDetail
              annotation={selectedAnnotation}
              tags={availableTags}
              onJumpToPage={jumpToActiveDocumentPage}
              onDeleteAnnotation={(id) => deleteAnnotationForDocument(activeSession.documentKey, id)}
              onSaveNote={handleSaveAnnotationNote}
              onToggleTag={handleToggleAnnotationTag}
            />
          ) : null}
        </ReaderLeftPanel>
      ) : null}
      viewer={
        <section className="viewer-surface" aria-label="PDF viewer surface" onWheel={handleViewerWheel}>
          {viewerContent}
        </section>
      }
      documentInfoDrawer={documentInfoOpen ? (
        <ReaderDocumentInfoDrawer
          key={`info:${activeSession.id}`}
          activeSession={activeSession}
          documentInfo={activeDocumentInfo}
          documentRecord={documentRecord}
          isFavorite={activeSessionIsFavorite}
          onJumpToPage={jumpToActiveDocumentPage}
          onToggleFavorite={handleToggleActiveFavorite}
          onClose={() => { setDocumentInfoOpen(false); documentInfoButton.current?.focus(); }}
        />
      ) : null}
      statusBar={<ReaderStatusBar activeSession={activeSession} controller={activeViewerController} />}
    />
  );
}
