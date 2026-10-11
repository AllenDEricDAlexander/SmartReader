import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import { PdfByteCache } from '../../cache/pdfByteCache';
import type { DocumentState } from '../../documents/documentModels';
import {
  addDocumentSession,
  markSessionError,
  updateSessionProgress,
} from '../../documents/documentSessionStore';
import { fileToBrowserSource } from '../../platform/browserFilePicker';
import { getPdfFilesFromDrop } from '../../platform/dropZone';
import { getDocumentKey, getFileSourceName, type FileSource } from '../../platform/fileSource';
import { listenForOpenWith } from '../../platform/openWithEvents';
import type {
  PersistedDocument,
  PersistenceApi,
} from '../../persistence/persistenceApi';
import type { TauriBridge } from '../../platform/tauriBridge';
import type { ViewerSource } from '../../viewer/viewerTypes';
import type { LibraryService } from '../../library/libraryService';
import { errorMessage } from '../../library/libraryService';
import { pushHardNavigation } from '../../documents/readingHistory';

type UseDocumentOpeningInput = {
  blobUrlCache: BlobUrlCache;
  bridge: TauriBridge;
  documents: DocumentState;
  loadDocumentDecorations(documentKey: string): Promise<void>;
  onDocumentOpened(document: PersistedDocument): void;
  onDocumentSessionActivated(documentKey: string): void;
  pdfByteCache: PdfByteCache;
  persistence: PersistenceApi;
  library?: LibraryService;
  onError?(message: string): void;
  setDocuments: Dispatch<SetStateAction<DocumentState>>;
  setRecentDocuments: Dispatch<SetStateAction<PersistedDocument[]>>;
  setViewerSource: Dispatch<SetStateAction<ViewerSource | null>>;
};

type OpenMetadata = {
  fileSize?: number | null;
  modifiedAt?: string | null;
  page?: number;
  zoom?: number;
  pageCount?: number;
  accessToken?: number;
  navigate?: boolean;
  tagIds?: number[];
};

export function useDocumentOpening({
  blobUrlCache,
  bridge,
  documents,
  loadDocumentDecorations,
  onDocumentOpened,
  onDocumentSessionActivated,
  pdfByteCache,
  persistence,
  library,
  onError,
  setDocuments,
  setRecentDocuments,
  setViewerSource,
}: UseDocumentOpeningInput) {
  const sessionsRef = useRef(documents.sessions);
  sessionsRef.current = documents.sessions;
  const activateBytes = useCallback(
    (source: FileSource, bytes: Uint8Array, metadata: OpenMetadata = {}) => {
      if (source.kind === 'library' && !library?.canAccess(source.paperId, metadata.accessToken ?? -1)) return;
      if (source.kind === 'desktop-path' || source.kind === 'library') {
        onDocumentOpened({
          documentKey: getDocumentKey(source),
          path: source.kind === 'desktop-path' ? source.path : null,
          displayName: getFileSourceName(source),
          fileSize: metadata.fileSize ?? null,
          modifiedAt: metadata.modifiedAt ?? null,
          pageCount: metadata.pageCount ?? null,
          lastPage: metadata.page ?? 1,
          progress: 0,
          missing: false,
          lastOpenedAt: null,
          tagIds: metadata.tagIds ?? [],
        });
      }

      setDocuments((current) => {
        if (source.kind === 'library' && !library?.canAccess(source.paperId, metadata.accessToken ?? -1)) return current;
        const wasOpen = current.sessions.some((session) => session.documentKey === getDocumentKey(source));
        let next = addDocumentSession(current, source);
        const documentKey = getDocumentKey(source);
        let session = next.sessions.find((candidate) => candidate.documentKey === documentKey);

        if (session && metadata.page !== undefined) {
          session = { ...session, page: metadata.page, zoom: metadata.zoom ?? session.zoom,
            totalPages: metadata.pageCount ?? session.totalPages,
            history: metadata.navigate && wasOpen ? pushHardNavigation(session.history, metadata.page)
              : { ...session.history, currentPage: metadata.page } };
          next = { ...next, sessions: next.sessions.map((item) => item.documentKey === documentKey ? session! : item) };
        }

        if (session) {
          pdfByteCache.set(documentKey, bytes);
          const url = blobUrlCache.createForSession(session.id, bytes);
          // Re-opening a document that is already in a tab keeps its position;
          // a genuinely new session simply carries page 1.
          const viewer = {
            sessionId: session.id,
            url,
            restore: { page: session.page, zoom: session.zoom },
          };
          setViewerSource((previous) => source.kind !== 'library' || library?.canAccess(source.paperId, metadata.accessToken ?? -1) ? viewer : previous);

          void loadDocumentDecorations(documentKey).catch((error) => onError?.(errorMessage(error)));
          onDocumentSessionActivated(documentKey);
        }

        return next;
      });
    },
    [
      blobUrlCache,
      library,
      onError,
      loadDocumentDecorations,
      onDocumentOpened,
      onDocumentSessionActivated,
      pdfByteCache,
      setDocuments,
      setViewerSource,
    ],
  );

  const openLibraryPaper = useCallback(async (id: string, page?: number) => {
    if (!library) throw new Error('文献库仅在桌面客户端可用。');
    await library.initialize();
    const paper = library.getPaper(id);
    if (!paper) throw new Error('请先解锁文献所在的文件夹。');
    const token = library.captureAccess();
    const bytes = await library.readPdf(id);
    if (!library.canAccess(id, token)) throw new Error('文献已锁定，请重新打开。');
    const existing = sessionsRef.current.find((session) => session.documentKey === `paper:${id}`);
    const targetPage = Math.max(1, Math.min(page ?? existing?.page ?? paper.lastPage, paper.pageCount || Infinity));
    await library.recordReading(id, 0, targetPage, existing?.zoom ?? paper.zoom);
    if (!library.canAccess(id, token)) throw new Error('文献已锁定，请重新打开。');
    activateBytes({ kind: 'library', paperId: id, name: paper.fileName }, bytes, {
      fileSize: paper.fileSize, page: targetPage, zoom: existing?.zoom ?? paper.zoom,
      pageCount: paper.pageCount, accessToken: token, navigate: page !== undefined,
    });
  }, [activateBytes, library]);

  const openBytes = useCallback(async (source: FileSource, bytes: Uint8Array, metadata: OpenMetadata = {}) => {
    if (library && source.kind !== 'library') {
      if (source.kind === 'desktop-path') {
        const key = getDocumentKey(source);
        const existing = persistence.getDocument ? await persistence.getDocument(key)
          : (await persistence.listRecentDocuments()).find((document) => document.documentKey === key);
        if (existing) {
          activateBytes(source, bytes, { ...metadata, page: existing.lastPage, pageCount: existing.pageCount ?? undefined, tagIds: existing.tagIds });
          return;
        }
      }
      const paper = await library.importPdf(bytes, getFileSourceName(source));
      await openLibraryPaper(paper.id);
    } else {
      activateBytes(source, bytes, metadata);
    }
  }, [activateBytes, library, openLibraryPaper, persistence]);

  const openDesktopPath = useCallback(
    async (path: string) => {
      const opened = await bridge.readDesktopPdf(path);
      await openBytes(opened.source, opened.bytes, {
        fileSize: opened.fileSize,
        modifiedAt: opened.modifiedAt,
      });
    },
    [bridge, openBytes],
  );

  const openPdf = useCallback(async () => {
    try {
      const opened = await bridge.openNativePdf();

      if (!opened) {
        return false;
      }

      await openBytes(opened.source, opened.bytes, {
        fileSize: opened.fileSize,
        modifiedAt: opened.modifiedAt,
      });
      return true;
    } catch (error) {
      if (!library) throw error;
      onError?.(errorMessage(error));
      return false;
    }
  }, [bridge, openBytes, onError, library]);

  const reopenDesktopSession = useCallback(
    async (sessionId: string) => {
      const session = documents.sessions.find((candidate) => candidate.id === sessionId);

      if (session?.source.kind === 'library') {
        try { await openLibraryPaper(session.source.paperId); } catch (error) { onError?.(errorMessage(error)); }
        return;
      }
      if (!session || session.source.kind !== 'desktop-path') {
        return;
      }

      try {
        const opened = await bridge.readDesktopPdf(session.source.path);
        pdfByteCache.set(session.documentKey, opened.bytes);
        const url = blobUrlCache.createForSession(session.id, opened.bytes);
        setViewerSource({
          sessionId: session.id,
          url,
          restore: { page: session.page, zoom: session.zoom },
        });
        setDocuments((current) =>
          updateSessionProgress(current, session.id, {
            page: session.page,
            totalPages: session.totalPages,
            zoom: session.zoom,
          }),
        );
      } catch (error) {
        setDocuments((current) =>
          markSessionError(
            current,
            session.id,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    },
    [blobUrlCache, bridge, documents.sessions, openLibraryPaper, onError, pdfByteCache, setDocuments, setViewerSource],
  );

  const reopenRecentDocument = useCallback(
    async (document: PersistedDocument) => {
      if (document.documentKey.startsWith('paper:')) {
        try { await openLibraryPaper(document.documentKey.slice('paper:'.length)); return true; }
        catch (error) { onError?.(errorMessage(error)); return false; }
      }
      if (!document.path) {
        return false;
      }

      try {
        await openDesktopPath(document.path);
        return true;
      } catch (error) {
        setRecentDocuments((current) =>
          current.map((item) =>
            item.documentKey === document.documentKey ? { ...item, missing: true } : item,
          ),
        );
        return false;
      }
    },
    [openDesktopPath, openLibraryPaper, onError, setRecentDocuments],
  );

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | null = null;

    listenForOpenWith((paths) => {
      void (async () => {
        for (const path of paths) {
          try { await openDesktopPath(path); } catch (error) { onError?.(errorMessage(error)); }
        }
      })();
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [openDesktopPath, onError]);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      for (const file of getPdfFilesFromDrop(event.dataTransfer.files)) {
        try {
          await openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()), {
            fileSize: file.size, modifiedAt: new Date(file.lastModified).toISOString(),
          });
        } catch (error) { onError?.(errorMessage(error)); }
      }
    },
    [openBytes, onError],
  );

  const handleBrowserFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      for (const file of files) {
        try {
          await openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()), {
            fileSize: file.size, modifiedAt: new Date(file.lastModified).toISOString(),
          });
        } catch (error) { onError?.(errorMessage(error)); }
      }
    },
    [openBytes, onError],
  );

  return {
    handleBrowserFileChange,
    handleDrop,
    openBytes,
    openLibraryPaper,
    openDesktopPath,
    openPdf,
    reopenDesktopSession,
    reopenRecentDocument,
  };
}
