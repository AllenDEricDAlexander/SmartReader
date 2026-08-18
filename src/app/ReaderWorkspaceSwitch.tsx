import type {
  ChangeEvent,
  Dispatch,
  DragEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  WheelEvent,
} from 'react';
import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession, DocumentState } from '../documents/documentModels';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { HomeDashboard } from '../home/HomeDashboard';
import type { HomeSidebarPage } from '../home/HomeSidebar';
import type {
  BookmarkDeleteResult,
  BookmarkManagementRecord,
  BookmarkUpdateInput,
} from '../home/bookmarkManagementUtils';
import type {
  BookmarkDashboard,
  CacheStats,
  PersistedAnnotationRecord,
  PersistedBookmark,
  PersistedDocument,
} from '../persistence/persistenceApi';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { SettingsWorkspace, type SettingsSection } from '../settings/SettingsWorkspace';
import type { Tag } from '../tags/tagModels';
import { TagManager } from '../tags/TagManager';
import type { ViewerActions } from '../viewer/viewerController';
import type {
  ViewerDocumentInfo,
  ViewerSearchOptions,
  ViewerSearchState,
} from '../viewer/viewerTypes';
import { AnnotationManagerWorkspace } from '../workspaces/AnnotationManagerWorkspace';
import { BookmarkManagerWorkspace } from '../workspaces/BookmarkManagerWorkspace';
import { CompareWorkspace } from '../workspaces/CompareWorkspace';
import { ImportWorkspace } from '../workspaces/ImportWorkspace';
import type { AppWorkspace } from './appTypes';
import { ReaderWorkspaceView } from './ReaderWorkspaceView';

type AppVersion = {
  version: string;
  build: string | null;
};

type ReaderWorkspaceSwitchProps = {
  activeAnnotations: ReaderAnnotation[];
  activeBookmarks: PersistedBookmark[];
  activeSession: DocumentSession | null;
  activeSessionIsFavorite: boolean;
  activeSidebarPage: HomeSidebarPage;
  activeViewerController: ViewerActions;
  activeWorkspace: AppWorkspace;
  appVersion: AppVersion;
  availableTags: Tag[];
  cacheStats: CacheStats;
  commandRegistry: Parameters<typeof SettingsWorkspace>[0]['commandRegistry'];
  documents: DocumentState;
  favoriteDocuments: FavoriteDocument[];
  globalSearchAnnotationError: string | null;
  globalSearchAnnotations: PersistedAnnotationRecord[];
  bookmarkDashboard: BookmarkDashboard | null;
  bookmarkDashboardError: string | null;
  bookmarkDashboardLoading: boolean;
  lastSearchCommand: string;
  pageInput: string;
  persistence: Parameters<typeof TagManager>[0]['persistence'];
  readerPreferences: ReaderPreferences;
  recentDocuments: PersistedDocument[];
  searchState: ViewerSearchState;
  searchOptions: ViewerSearchOptions;
  documentInfo: ViewerDocumentInfo | null;
  searchInputRef: RefObject<HTMLInputElement>;
  searchText: string;
  selectedAnnotation: ReaderAnnotation | null;
  sessionRestoreCount: number;
  settingsInitialSection: SettingsSection;
  settingsSaving: boolean;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  viewerContent: ReactNode;
  addBookmarkForActivePage(): void;
  addPageNote(): void;
  canOpenNativePdf(): boolean;
  canOpenRecordPage(documentKey: string, documentPath: string | null, documentMissing: boolean): boolean;
  clearSearch(): void;
  closeToolWorkspace(): void;
  deleteBookmark(bookmark: Bookmark): void | Promise<void>;
  deleteManagedBookmarks(
    bookmarks: BookmarkManagementRecord[],
  ): Promise<BookmarkDeleteResult>;
  deleteAnnotationForDocument(documentKey: string, annotationId: number): void;
  handleBrowserFileChange(event: ChangeEvent<HTMLInputElement>): void;
  handleImportBrowserFileChange(event: ChangeEvent<HTMLInputElement>): void;
  handleDrop(event: DragEvent<HTMLElement>): void | Promise<void>;
  handleSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  handleSavePreferences(preferences: ReaderPreferences): Promise<void>;
  handleToggleActiveFavorite(): void;
  handleToggleAnnotationTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
  handleToggleDocumentTag(document: PersistedDocument, tag: Tag, selected: boolean): void | Promise<void>;
  handleToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  handleRemoveRecentDocuments(documents: PersistedDocument[]): void | Promise<void>;
  handleClearRecentDocuments(): void | Promise<void>;
  handleViewerWheel(event: WheelEvent<HTMLElement>): void;
  importAnnotationsForDocument(documentKey: string, json: string): Promise<void>;
  jumpToActiveDocumentPage(page: number): void;
  jumpToPage(page: number): void;
  jumpToSearchMatch(index: number): void;
  setSearchOptions(options: ViewerSearchOptions): void;
  onTagsChange(update: SetStateAction<Tag[]>): void;
  openCompareDocument(document: PersistedDocument): void | Promise<void>;
  openFavoriteDocument(document: FavoriteDocument): void | Promise<void | boolean>;
  openGlobalSearch(): void;
  openHomeSidebarPage(page: HomeSidebarPage): void;
  openImportPdf(): Promise<void>;
  openPdf(): Promise<boolean>;
  openRecordPage(
    documentKey: string,
    documentPath: string | null,
    page: number,
    documentMissing: boolean,
  ): Promise<void>;
  openSettingsWorkspace(initialSection?: SettingsSection): void;
  openShortcutWorkspace(workspace: AppWorkspace): void;
  renameBookmark(bookmark: Bookmark, title: string): void | Promise<void>;
  refreshBookmarkDashboard(): void | Promise<void>;
  reopenRecentDocument(document: PersistedDocument): Promise<boolean>;
  runSearch(keyword: string): void;
  setPageInput(value: string): void;
  setSearchText(value: string): void;
  setSelectedAnnotationId(annotationId: number | null): void;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  stepHistoryBack(): void;
  stepHistoryForward(): void;
  updateManagedBookmark(
    bookmark: BookmarkManagementRecord,
    updates: BookmarkUpdateInput,
  ): Promise<void>;
};

export function ReaderWorkspaceSwitch({
  activeAnnotations,
  activeBookmarks,
  activeSession,
  activeSessionIsFavorite,
  activeSidebarPage,
  activeViewerController,
  activeWorkspace,
  appVersion,
  availableTags,
  cacheStats,
  commandRegistry,
  documents,
  favoriteDocuments,
  globalSearchAnnotationError,
  globalSearchAnnotations,
  bookmarkDashboard,
  bookmarkDashboardError,
  bookmarkDashboardLoading,
  lastSearchCommand,
  pageInput,
  persistence,
  readerPreferences,
  recentDocuments,
  searchState,
  searchOptions,
  documentInfo,
  searchInputRef,
  searchText,
  selectedAnnotation,
  sessionRestoreCount,
  settingsInitialSection,
  settingsSaving,
  sidebarOpen,
  rightPanelOpen,
  viewerContent,
  addBookmarkForActivePage,
  addPageNote,
  canOpenNativePdf,
  canOpenRecordPage,
  clearSearch,
  closeToolWorkspace,
  deleteBookmark,
  deleteManagedBookmarks,
  deleteAnnotationForDocument,
  handleBrowserFileChange,
  handleImportBrowserFileChange,
  handleDrop,
  handleSaveAnnotationNote,
  handleSavePreferences,
  handleToggleActiveFavorite,
  handleToggleAnnotationTag,
  handleToggleDocumentTag,
  handleToggleFavorite,
  handleRemoveRecentDocuments,
  handleClearRecentDocuments,
  handleViewerWheel,
  importAnnotationsForDocument,
  jumpToActiveDocumentPage,
  jumpToPage,
  jumpToSearchMatch,
  setSearchOptions,
  onTagsChange,
  openCompareDocument,
  openFavoriteDocument,
  openGlobalSearch,
  openHomeSidebarPage,
  openImportPdf,
  openPdf,
  openRecordPage,
  openSettingsWorkspace,
  openShortcutWorkspace,
  renameBookmark,
  refreshBookmarkDashboard,
  reopenRecentDocument,
  runSearch,
  setPageInput,
  setSearchText,
  setSelectedAnnotationId,
  setSidebarOpen,
  setRightPanelOpen,
  stepHistoryBack,
  stepHistoryForward,
  updateManagedBookmark,
}: ReaderWorkspaceSwitchProps) {
  return (
    <>
      {activeWorkspace === 'settings' ? (
        <SettingsWorkspace
          commandRegistry={commandRegistry}
          preferences={readerPreferences}
          openSessionCount={documents.sessions.length}
          recentDocumentCount={recentDocuments.length}
          initialSection={settingsInitialSection}
          saving={settingsSaving}
          onClose={closeToolWorkspace}
          onSave={handleSavePreferences}
        />
      ) : null}
      {activeWorkspace === 'import' ? (
        <ImportWorkspace
          onOpenPdf={openImportPdf}
          onBrowserFileChange={handleImportBrowserFileChange}
          canOpenNativePdf={canOpenNativePdf}
          onClose={closeToolWorkspace}
        />
      ) : null}
      {activeWorkspace === 'compare' ? (
        <CompareWorkspace
          recentDocuments={recentDocuments}
          onOpenDocument={openCompareDocument}
          onClose={closeToolWorkspace}
        />
      ) : null}
      {activeWorkspace === 'annotations' ? (
        <AnnotationManagerWorkspace
          annotations={globalSearchAnnotations}
          error={globalSearchAnnotationError}
          canOpenAnnotation={(annotation) =>
            canOpenRecordPage(
              annotation.documentKey,
              annotation.documentPath,
              annotation.documentMissing,
            )
          }
          onClose={closeToolWorkspace}
          onOpenAnnotation={(annotation) =>
            void openRecordPage(
              annotation.documentKey,
              annotation.documentPath,
              annotation.page,
              annotation.documentMissing,
            )
          }
        />
      ) : null}
      {activeWorkspace === 'bookmarks' ? (
        <BookmarkManagerWorkspace
          dashboard={bookmarkDashboard}
          loading={bookmarkDashboardLoading}
          error={bookmarkDashboardError}
          canOpenBookmark={(bookmark) =>
            canOpenRecordPage(bookmark.documentKey, bookmark.documentPath, bookmark.documentMissing)
          }
          onClose={closeToolWorkspace}
          onOpenPdf={openPdf}
          onOpenBookmark={(bookmark) =>
            void openRecordPage(
              bookmark.documentKey,
              bookmark.documentPath,
              bookmark.page,
              bookmark.documentMissing,
            )
          }
          onUpdateBookmark={updateManagedBookmark}
          onDeleteBookmarks={deleteManagedBookmarks}
          onRefresh={refreshBookmarkDashboard}
        />
      ) : null}
      {activeWorkspace === 'tags' ? (
        <TagManager
          persistence={persistence}
          onTagsChange={onTagsChange}
          onCloseDetail={() => undefined}
          onOpenDocument={(documentKey, documentPath, page, missing) =>
            void openRecordPage(documentKey, documentPath, page, missing)
          }
        />
      ) : null}
      {activeWorkspace === 'reader' && activeSession ? (
        <ReaderWorkspaceView
          activeAnnotations={activeAnnotations}
          activeBookmarks={activeBookmarks}
          activeSession={activeSession}
          activeSessionIsFavorite={activeSessionIsFavorite}
          activeViewerController={activeViewerController}
          availableTags={availableTags}
          lastSearchCommand={lastSearchCommand}
          pageInput={pageInput}
          searchState={searchState}
          searchOptions={searchOptions}
          documentInfo={documentInfo}
          documentRecord={
            recentDocuments.find(
              (document) => document.documentKey === activeSession.documentKey,
            ) ?? null
          }
          searchInputRef={searchInputRef}
          searchText={searchText}
          selectedAnnotation={selectedAnnotation}
          sidebarOpen={sidebarOpen}
          rightPanelOpen={rightPanelOpen}
          viewerContent={viewerContent}
          addBookmarkForActivePage={addBookmarkForActivePage}
          addPageNote={addPageNote}
          clearSearch={clearSearch}
          deleteBookmark={deleteBookmark}
          deleteAnnotationForDocument={deleteAnnotationForDocument}
          handleSaveAnnotationNote={handleSaveAnnotationNote}
          handleToggleActiveFavorite={handleToggleActiveFavorite}
          handleToggleAnnotationTag={handleToggleAnnotationTag}
          handleViewerWheel={handleViewerWheel}
          importAnnotationsForDocument={importAnnotationsForDocument}
          jumpToActiveDocumentPage={jumpToActiveDocumentPage}
          jumpToPage={jumpToPage}
          jumpToSearchMatch={jumpToSearchMatch}
          setSearchOptions={setSearchOptions}
          openSettingsWorkspace={openSettingsWorkspace}
          renameBookmark={renameBookmark}
          runSearch={runSearch}
          setPageInput={setPageInput}
          setSearchText={setSearchText}
          setSelectedAnnotationId={setSelectedAnnotationId}
          setSidebarOpen={setSidebarOpen}
          setRightPanelOpen={setRightPanelOpen}
          stepHistoryBack={stepHistoryBack}
          stepHistoryForward={stepHistoryForward}
        />
      ) : null}
      {activeWorkspace === 'home' ? (
        <HomeDashboard
          recentDocuments={recentDocuments}
          favoriteDocuments={favoriteDocuments}
          bookmarkDashboard={bookmarkDashboard}
          bookmarkDashboardLoading={bookmarkDashboardLoading}
          bookmarkDashboardError={bookmarkDashboardError}
          availableTags={availableTags}
          activeSidebarPage={activeSidebarPage}
          appVersion={appVersion}
          counts={{
            recentFiles: recentDocuments.length,
            favoriteFiles: favoriteDocuments.length,
            restorableSessions: sessionRestoreCount,
          }}
          cacheStats={cacheStats}
          tagPersistence={persistence}
          onTagsChange={onTagsChange}
          onOpenTagDocument={(documentKey, documentPath, page, documentMissing) =>
            void openRecordPage(documentKey, documentPath, page, documentMissing)
          }
          onOpenPdf={openPdf}
          onDropPdf={handleDrop}
          onBrowserFileChange={handleBrowserFileChange}
          onReopenRecentDocument={(document) => void reopenRecentDocument(document)}
          onOpenFavoriteDocument={(document) => openFavoriteDocument(document)}
          canOpenBookmark={(bookmark) =>
            canOpenRecordPage(bookmark.documentKey, bookmark.documentPath, bookmark.documentMissing)
          }
          onOpenBookmark={(bookmark) =>
            void openRecordPage(
              bookmark.documentKey,
              bookmark.documentPath,
              bookmark.page,
              bookmark.documentMissing,
            )
          }
          onUpdateBookmark={updateManagedBookmark}
          onDeleteBookmarks={deleteManagedBookmarks}
          onRefreshBookmarks={refreshBookmarkDashboard}
          onToggleFavorite={handleToggleFavorite}
          onToggleDocumentTag={handleToggleDocumentTag}
          onRemoveRecentDocuments={handleRemoveRecentDocuments}
          onClearRecentDocuments={handleClearRecentDocuments}
          canOpenNativePdf={canOpenNativePdf}
          onOpenGlobalSearch={openGlobalSearch}
          onOpenImport={() => openShortcutWorkspace('import')}
          onOpenCompare={() => openShortcutWorkspace('compare')}
          onOpenAnnotations={() => openShortcutWorkspace('annotations')}
          onOpenBookmarks={() => {
            openHomeSidebarPage('bookmarks');
            void refreshBookmarkDashboard();
          }}
          onOpenHome={() => openHomeSidebarPage('home')}
          onOpenRecentFiles={() => openHomeSidebarPage('recentFiles')}
          onOpenFavoriteFiles={() => openHomeSidebarPage('favoriteFiles')}
          onOpenSessionRestore={() => openHomeSidebarPage('sessionRestore')}
          onOpenMyDocuments={() => openHomeSidebarPage('myDocuments')}
          onOpenFolders={() => openHomeSidebarPage('folders')}
          onOpenNotes={() => openHomeSidebarPage('notes')}
          onOpenFullTextSearch={openGlobalSearch}
          onOpenCacheManagement={() => openSettingsWorkspace('cache')}
          onOpenShortcutSettings={() => openSettingsWorkspace('shortcuts')}
          onOpenSettings={() => openSettingsWorkspace()}
          onOpenTags={() => openHomeSidebarPage('tags')}
        />
      ) : null}
    </>
  );
}
