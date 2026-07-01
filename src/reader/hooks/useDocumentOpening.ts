import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
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
import { getDocumentKey, type FileSource } from '../../platform/fileSource';
import { listenForOpenWith } from '../../platform/openWithEvents';
import type {
  PersistedDocument,
  PersistenceApi,
} from '../../persistence/persistenceApi';
import type { TauriBridge } from '../../platform/tauriBridge';
import type { ViewerSource } from '../../viewer/viewerTypes';

type UseDocumentOpeningInput = {
  blobUrlCache: BlobUrlCache;
  bridge: TauriBridge;
  documents: DocumentState;
  loadDocumentDecorations(documentKey: string): Promise<void>;
  pdfByteCache: PdfByteCache;
  persistence: PersistenceApi;
  setDocuments: Dispatch<SetStateAction<DocumentState>>;
  setRecentDocuments: Dispatch<SetStateAction<PersistedDocument[]>>;
  setViewerSource: Dispatch<SetStateAction<ViewerSource | null>>;
};

type OpenMetadata = {
  fileSize?: number | null;
  modifiedAt?: string | null;
};

export function useDocumentOpening({
  blobUrlCache,
  bridge,
  documents,
  loadDocumentDecorations,
  pdfByteCache,
  persistence,
  setDocuments,
  setRecentDocuments,
  setViewerSource,
}: UseDocumentOpeningInput) {
  const openBytes = useCallback(
    (source: FileSource, bytes: Uint8Array, metadata: OpenMetadata = {}) => {
      setDocuments((current) => {
        const next = addDocumentSession(current, source);
        const documentKey = getDocumentKey(source);
        const session = next.sessions.find((candidate) => candidate.documentKey === documentKey);

        if (session) {
          pdfByteCache.set(documentKey, bytes);
          const url = blobUrlCache.createForSession(session.id, bytes);
          setViewerSource({ sessionId: session.id, url });

          if (source.kind === 'desktop-path') {
            void persistence.saveDocument({
              documentKey,
              path: source.path,
              displayName: session.title,
              fileSize: metadata.fileSize ?? null,
              modifiedAt: metadata.modifiedAt ?? null,
              pageCount: session.totalPages,
              lastPage: session.page,
              progress: session.progress,
              missing: false,
            });
          }

          void loadDocumentDecorations(documentKey);
        }

        return next;
      });
    },
    [
      blobUrlCache,
      loadDocumentDecorations,
      pdfByteCache,
      persistence,
      setDocuments,
      setViewerSource,
    ],
  );

  const openDesktopPath = useCallback(
    async (path: string) => {
      const opened = await bridge.readDesktopPdf(path);
      openBytes(opened.source, opened.bytes, {
        fileSize: opened.fileSize,
        modifiedAt: opened.modifiedAt,
      });
    },
    [bridge, openBytes],
  );

  const openPdf = useCallback(async () => {
    const opened = await bridge.openNativePdf();

    if (!opened) {
      return false;
    }

    openBytes(opened.source, opened.bytes, {
      fileSize: opened.fileSize,
      modifiedAt: opened.modifiedAt,
    });
    return true;
  }, [bridge, openBytes]);

  const reopenDesktopSession = useCallback(
    async (sessionId: string) => {
      const session = documents.sessions.find((candidate) => candidate.id === sessionId);

      if (!session || session.source.kind !== 'desktop-path') {
        return;
      }

      try {
        const opened = await bridge.readDesktopPdf(session.source.path);
        pdfByteCache.set(session.documentKey, opened.bytes);
        const url = blobUrlCache.createForSession(session.id, opened.bytes);
        setViewerSource({ sessionId: session.id, url });
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
    [blobUrlCache, bridge, documents.sessions, pdfByteCache, setDocuments, setViewerSource],
  );

  const reopenRecentDocument = useCallback(
    async (document: PersistedDocument) => {
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
    [openDesktopPath, setRecentDocuments],
  );

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | null = null;

    listenForOpenWith((paths) => {
      for (const path of paths) {
        void openDesktopPath(path);
      }
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
  }, [openDesktopPath]);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const [file] = getPdfFilesFromDrop(event.dataTransfer.files);

      if (!file) {
        return;
      }

      openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()), {
        fileSize: file.size,
        modifiedAt: new Date(file.lastModified).toISOString(),
      });
    },
    [openBytes],
  );

  const handleBrowserFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const [file] = Array.from(event.target.files ?? []);

      if (!file) {
        return;
      }

      openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()), {
        fileSize: file.size,
        modifiedAt: new Date(file.lastModified).toISOString(),
      });
      event.target.value = '';
    },
    [openBytes],
  );

  return {
    handleBrowserFileChange,
    handleDrop,
    openBytes,
    openDesktopPath,
    openPdf,
    reopenDesktopSession,
    reopenRecentDocument,
  };
}
