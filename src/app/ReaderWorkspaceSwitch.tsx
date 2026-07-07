import type { ChangeEvent, Dispatch, DragEvent, ReactNode, SetStateAction, WheelEvent } from 'react';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { DocumentSession, DocumentState } from '../documents/documentModels';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { HomeDashboard } from '../home/HomeDashboard';
import type { HomeSidebarPage } from '../home/HomeSidebar';
import type {
  CacheStats,
  PersistedAnnotationRecord,
  PersistedBookmark,
  PersistedBookmarkRecord,
  PersistedDocument,
} from '../persistence/persistenceApi';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import { SettingsWorkspace, type SettingsSection } from '../settings/SettingsWorkspace';
import type { Tag } from '../tags/tagModels';
import { TagManager } from '../tags/TagManager';
import type { ViewerActions } from '../viewer/viewerController';
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
  globalSearchBookmarkError: string | null;
  globalSearchBookmarks: PersistedBookmarkRecord[];
  lastSearchCommand: string;
  pageInput: string;
  persistence: Parameters<typeof TagManager>[0]['persistence'];
  readerPreferences: ReaderPreferences;
  recentDocuments: PersistedDocument[];
  searchText: string;
  selectedAnnotation: ReaderAnnotation | null;
  sessionRestoreCount: number;
  settingsInitialSection: SettingsSection;
  settingsSaving: boolean;
  sidebarOpen: boolean;
  viewerContent: ReactNode;
  addBookmarkForActivePage(): void;
  addPageNote(): void;
  canOpenNativePdf(): boolean;
  canOpenRecordPage(documentKey: string, documentPath: string | null, documentMissing: boolean): boolean;
  clearSearch(): void;
  closeActiveTab(): void;
  closeToolWorkspace(): void;
  deleteAnnotationForDocument(documentKey: string, annotationId: number): void;
  handleBrowserFileChange(event: ChangeEvent<HTMLInputElement>): void;
  handleImportBrowserFileChange(event: ChangeEvent<HTMLInputElement>): void;
  handleDrop(event: DragEvent<HTMLElement>): void | Promise<void>;
  handleSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  handleSavePreferences(preferences: ReaderPreferences): Promise<void>;
  handleToggleActiveFavorite(): void;
  handleToggleAnnotationTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
  handleToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  handleViewerWheel(event: WheelEvent<HTMLElement>): void;
  importAnnotationsForDocument(documentKey: string, json: string): Promise<void>;
  jumpToActiveDocumentPage(page: number): void;
  jumpToPage(page: number): void;
  onTagsChange(update: SetStateAction<Tag[]>): void;
  openCompareDocument(document: PersistedDocument): void | Promise<void>;
  openFavoriteDocument(document: FavoriteDocument): void | Promise<void | boolean>;
  openGlobalSearch(): void;
  openHomeSidebarPage(page: HomeSidebarPage): void;
  openImportPdf(): Promise<void>;
  openPdf(): Promise<boolean>;
  openPdfAndIgnoreResult(): void;
  openRecordPage(
    documentKey: string,
    documentPath: string | null,
    page: number,
    documentMissing: boolean,
  ): Promise<void>;
  openSettingsWorkspace(initialSection?: SettingsSection): void;
  openShortcutWorkspace(workspace: AppWorkspace): void;
  reopenRecentDocument(document: PersistedDocument): Promise<boolean>;
  runSearch(keyword: string): void;
  selectReaderSession(sessionId: string): void;
  setPageInput(value: string): void;
  setSearchText(value: string): void;
  setSelectedAnnotationId(annotationId: number | null): void;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceOverride(workspace: AppWorkspace | null): void;
  stepHistoryBack(): void;
  stepHistoryForward(): void;
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
  globalSearchBookmarkError,
  globalSearchBookmarks,
  lastSearchCommand,
  pageInput,
  persistence,
  readerPreferences,
  recentDocuments,
  searchText,
  selectedAnnotation,
  sessionRestoreCount,
  settingsInitialSection,
  settingsSaving,
  sidebarOpen,
  viewerContent,
  addBookmarkForActivePage,
  addPageNote,
  canOpenNativePdf,
  canOpenRecordPage,
  clearSearch,
  closeActiveTab,
  closeToolWorkspace,
  deleteAnnotationForDocument,
  handleBrowserFileChange,
  handleImportBrowserFileChange,
  handleDrop,
  handleSaveAnnotationNote,
  handleSavePreferences,
  handleToggleActiveFavorite,
  handleToggleAnnotationTag,
  handleToggleFavorite,
  handleViewerWheel,
  importAnnotationsForDocument,
  jumpToActiveDocumentPage,
  jumpToPage,
  onTagsChange,
  openCompareDocument,
  openFavoriteDocument,
  openGlobalSearch,
  openHomeSidebarPage,
  openImportPdf,
  openPdf,
  openPdfAndIgnoreResult,
  openRecordPage,
  openSettingsWorkspace,
  openShortcutWorkspace,
  reopenRecentDocument,
  runSearch,
  selectReaderSession,
  setPageInput,
  setSearchText,
  setSelectedAnnotationId,
  setSidebarOpen,
  setWorkspaceOverride,
  stepHistoryBack,
  stepHistoryForward,
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
          onClose={() => setWorkspaceOverride(null)}
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
          bookmarks={globalSearchBookmarks}
          error={globalSearchBookmarkError}
          canOpenBookmark={(bookmark) =>
            canOpenRecordPage(bookmark.documentKey, bookmark.documentPath, bookmark.documentMissing)
          }
          onClose={closeToolWorkspace}
          onOpenBookmark={(bookmark) =>
            void openRecordPage(
              bookmark.documentKey,
              bookmark.documentPath,
              bookmark.page,
              bookmark.documentMissing,
            )
          }
        />
      ) : null}
      {activeWorkspace === 'tags' ? (
        <TagManager
          persistence={persistence}
          onTagsChange={onTagsChange}
          onClose={() => setWorkspaceOverride(null)}
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
          documents={documents}
          lastSearchCommand={lastSearchCommand}
          pageInput={pageInput}
          recentDocuments={recentDocuments}
          searchText={searchText}
          selectedAnnotation={selectedAnnotation}
          sidebarOpen={sidebarOpen}
          viewerContent={viewerContent}
          addBookmarkForActivePage={addBookmarkForActivePage}
          addPageNote={addPageNote}
          clearSearch={clearSearch}
          closeActiveTab={closeActiveTab}
          deleteAnnotationForDocument={deleteAnnotationForDocument}
          handleBrowserFileChange={handleBrowserFileChange}
          handleSaveAnnotationNote={handleSaveAnnotationNote}
          handleToggleActiveFavorite={handleToggleActiveFavorite}
          handleToggleAnnotationTag={handleToggleAnnotationTag}
          handleViewerWheel={handleViewerWheel}
          importAnnotationsForDocument={importAnnotationsForDocument}
          jumpToActiveDocumentPage={jumpToActiveDocumentPage}
          jumpToPage={jumpToPage}
          openPdfAndIgnoreResult={openPdfAndIgnoreResult}
          openSettingsWorkspace={openSettingsWorkspace}
          reopenRecentDocument={reopenRecentDocument}
          runSearch={runSearch}
          selectReaderSession={selectReaderSession}
          setPageInput={setPageInput}
          setSearchText={setSearchText}
          setSelectedAnnotationId={setSelectedAnnotationId}
          setSidebarOpen={setSidebarOpen}
          stepHistoryBack={stepHistoryBack}
          stepHistoryForward={stepHistoryForward}
        />
      ) : null}
      {activeWorkspace === 'home' ? (
        <HomeDashboard
          recentDocuments={recentDocuments}
          favoriteDocuments={favoriteDocuments}
          availableTags={availableTags}
          activeSidebarPage={activeSidebarPage}
          appVersion={appVersion}
          counts={{
            recentFiles: recentDocuments.length,
            favoriteFiles: favoriteDocuments.length,
            restorableSessions: sessionRestoreCount,
          }}
          cacheStats={cacheStats}
          onOpenPdf={openPdf}
          onDropPdf={handleDrop}
          onBrowserFileChange={handleBrowserFileChange}
          onReopenRecentDocument={(document) => void reopenRecentDocument(document)}
          onOpenFavoriteDocument={(document) => openFavoriteDocument(document)}
          onToggleFavorite={handleToggleFavorite}
          canOpenNativePdf={canOpenNativePdf}
          onOpenGlobalSearch={openGlobalSearch}
          onOpenImport={() => openShortcutWorkspace('import')}
          onOpenCompare={() => openShortcutWorkspace('compare')}
          onOpenAnnotations={() => openShortcutWorkspace('annotations')}
          onOpenBookmarks={() => openShortcutWorkspace('bookmarks')}
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
          onOpenTags={() => setWorkspaceOverride('tags')}
        />
      ) : null}
    </>
  );
}
