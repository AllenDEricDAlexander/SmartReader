import { useCallback, useState } from 'react';
import type { Bookmark, ReaderAnnotation } from '../../annotations/annotationModels';
import {
  addOrReplaceAnnotation,
  addOrReplaceBookmark,
  importAnnotations,
  removeAnnotation,
} from '../../annotations/annotationStore';
import type { DocumentSession } from '../../documents/documentModels';
import type { PersistenceApi } from '../../persistence/persistenceApi';

type UseReaderDecorationsInput = {
  activeSession: DocumentSession | null;
  persistence: PersistenceApi;
};

type AnnotationInput = Pick<
  ReaderAnnotation,
  'page' | 'type' | 'color' | 'text' | 'quote' | 'areas'
>;

export function useReaderDecorations({
  activeSession,
  persistence,
}: UseReaderDecorationsInput) {
  const [bookmarksByDocument, setBookmarksByDocument] = useState<Record<string, Bookmark[]>>({});
  const [annotationsByDocument, setAnnotationsByDocument] = useState<
    Record<string, ReaderAnnotation[]>
  >({});

  const loadDocumentDecorations = useCallback(
    async (documentKey: string) => {
      const [bookmarks, annotations] = await Promise.all([
        persistence.listBookmarks(documentKey),
        persistence.listAnnotations(documentKey),
      ]);

      setBookmarksByDocument((current) => ({ ...current, [documentKey]: bookmarks }));
      setAnnotationsByDocument((current) => ({ ...current, [documentKey]: annotations }));
    },
    [persistence],
  );

  const addBookmarkForActivePage = useCallback(async () => {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const saved = await persistence.saveBookmark({
      id: null,
      documentKey: activeSession.documentKey,
      page: activeSession.page,
      title: `Page ${activeSession.page}`,
      createdAt: now,
      updatedAt: now,
    });

    setBookmarksByDocument((current) => ({
      ...current,
      [activeSession.documentKey]: addOrReplaceBookmark(
        current[activeSession.documentKey] ?? [],
        saved,
      ),
    }));
  }, [activeSession, persistence]);

  const saveAnnotationForActiveDocument = useCallback(
    async (input: AnnotationInput) => {
      if (!activeSession) {
        return;
      }

      const now = new Date().toISOString();
      const saved = await persistence.saveAnnotation({
        id: null,
        documentKey: activeSession.documentKey,
        createdAt: now,
        updatedAt: now,
        ...input,
      });

      setAnnotationsByDocument((current) => ({
        ...current,
        [activeSession.documentKey]: addOrReplaceAnnotation(
          current[activeSession.documentKey] ?? [],
          saved,
        ),
      }));
    },
    [activeSession, persistence],
  );

  const addPageNote = useCallback(
    () =>
      saveAnnotationForActiveDocument({
        page: activeSession?.page ?? 1,
        type: 'note',
        color: '#38bdf8',
        text: 'Page note',
        quote: null,
        areas: [],
      }),
    [activeSession, saveAnnotationForActiveDocument],
  );

  const deleteAnnotationForDocument = useCallback(
    (documentKey: string, annotationId: number) => {
      void persistence.deleteAnnotation(annotationId);
      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: removeAnnotation(current[documentKey] ?? [], annotationId),
      }));
    },
    [persistence],
  );

  const importAnnotationsForDocument = useCallback((documentKey: string, json: string) => {
    const imported = importAnnotations(json);
    setAnnotationsByDocument((current) => ({
      ...current,
      [documentKey]: imported,
    }));
  }, []);

  return {
    annotationsByDocument,
    bookmarksByDocument,
    addBookmarkForActivePage,
    addPageNote,
    deleteAnnotationForDocument,
    importAnnotationsForDocument,
    loadDocumentDecorations,
    saveAnnotationForActiveDocument,
  };
}
