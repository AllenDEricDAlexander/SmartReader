import { useCallback, useState } from 'react';
import type { Bookmark, ReaderAnnotation } from '../../annotations/annotationModels';
import {
  addOrReplaceAnnotation,
  addOrReplaceBookmark,
  importAnnotations,
  removeAnnotation,
  removeBookmark,
  setAnnotationTag,
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
> & {
  tagIds?: number[];
};

function normalizeAnnotation(annotation: ReaderAnnotation): ReaderAnnotation {
  return {
    ...annotation,
    tagIds: annotation.tagIds ?? [],
  };
}

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
      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: annotations.map(normalizeAnnotation),
      }));
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
      note: null,
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

  const updateBookmarkForDocument = useCallback(
    async (
      documentKey: string,
      bookmark: Bookmark,
      updates: Pick<Bookmark, 'title' | 'note'>,
    ) => {
      if (bookmark.id === null) {
        return undefined;
      }

      const normalizedTitle = updates.title.trim();
      const normalizedNote = updates.note?.trim() || null;

      if (
        !normalizedTitle ||
        (normalizedTitle === bookmark.title && normalizedNote === bookmark.note)
      ) {
        return bookmark;
      }

      const saved = await persistence.saveBookmark({
        ...bookmark,
        title: normalizedTitle,
        note: normalizedNote,
        updatedAt: new Date().toISOString(),
      });

      setBookmarksByDocument((current) => {
        const bookmarks = current[documentKey];

        if (!bookmarks) {
          return current;
        }

        return {
          ...current,
          [documentKey]: addOrReplaceBookmark(bookmarks, saved),
        };
      });

      return saved;
    },
    [persistence],
  );

  const renameBookmarkForDocument = useCallback(
    (documentKey: string, bookmark: Bookmark, title: string) =>
      updateBookmarkForDocument(documentKey, bookmark, {
        title,
        note: bookmark.note,
      }),
    [updateBookmarkForDocument],
  );

  const deleteBookmarkForDocument = useCallback(
    async (documentKey: string, bookmarkId: number) => {
      await persistence.deleteBookmark(bookmarkId);
      setBookmarksByDocument((current) => {
        const bookmarks = current[documentKey];

        if (!bookmarks) {
          return current;
        }

        return {
          ...current,
          [documentKey]: removeBookmark(bookmarks, bookmarkId),
        };
      });
    },
    [persistence],
  );

  const saveAnnotationForActiveDocument = useCallback(
    async (input: AnnotationInput) => {
      if (!activeSession) {
        return undefined;
      }

      const now = new Date().toISOString();
      const saved = await persistence.saveAnnotation({
        id: null,
        documentKey: activeSession.documentKey,
        createdAt: now,
        updatedAt: now,
        ...input,
      });

      const normalized = normalizeAnnotation(saved);

      setAnnotationsByDocument((current) => ({
        ...current,
        [activeSession.documentKey]: addOrReplaceAnnotation(
          current[activeSession.documentKey] ?? [],
          normalized,
        ),
      }));

      return normalized;
    },
    [activeSession, persistence],
  );

  const addPageNote = useCallback(
    async () => {
      await saveAnnotationForActiveDocument({
        page: activeSession?.page ?? 1,
        type: 'note',
        color: '#38bdf8',
        text: '页面笔记',
        quote: null,
        areas: [],
      });
    },
    [activeSession, saveAnnotationForActiveDocument],
  );

  const updateAnnotationForDocument = useCallback(
    async (documentKey: string, annotation: ReaderAnnotation, updates: Partial<ReaderAnnotation>) => {
      const { tagIds: _tagIds, ...annotationWithoutTags } = annotation;
      const saved = await persistence.saveAnnotation({
        ...annotationWithoutTags,
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      const normalized = normalizeAnnotation(saved);

      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: addOrReplaceAnnotation(current[documentKey] ?? [], normalized),
      }));

      return normalized;
    },
    [persistence],
  );

  const toggleAnnotationTagForDocument = useCallback(
    async (documentKey: string, annotationId: number, tagId: number, selected: boolean) => {
      if (selected) {
        await persistence.detachAnnotationTag(annotationId, tagId);
      } else {
        await persistence.attachAnnotationTag(annotationId, tagId);
      }

      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: setAnnotationTag(
          current[documentKey] ?? [],
          annotationId,
          tagId,
          !selected,
        ),
      }));
    },
    [persistence],
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

  const importAnnotationsForDocument = useCallback(
    async (documentKey: string, json: string) => {
      let imported: ReaderAnnotation[];

      try {
        imported = importAnnotations(json);
      } catch {
        return;
      }

      try {
        const savedAnnotations = await Promise.all(
          imported.map((annotation) =>
            persistence.saveAnnotation({
              ...annotation,
              id: null,
              documentKey,
              tagIds: annotation.tagIds ?? [],
              updatedAt: new Date().toISOString(),
            }),
          ),
        );

        setAnnotationsByDocument((current) => ({
          ...current,
          [documentKey]: savedAnnotations
            .map(normalizeAnnotation)
            .reduce(
              (annotations, annotation) => addOrReplaceAnnotation(annotations, annotation),
              current[documentKey] ?? [],
            ),
        }));
      } catch {
        return;
      }
    },
    [persistence],
  );

  return {
    annotationsByDocument,
    bookmarksByDocument,
    addBookmarkForActivePage,
    addPageNote,
    deleteBookmarkForDocument,
    deleteAnnotationForDocument,
    importAnnotationsForDocument,
    loadDocumentDecorations,
    renameBookmarkForDocument,
    saveAnnotationForActiveDocument,
    toggleAnnotationTagForDocument,
    updateAnnotationForDocument,
    updateBookmarkForDocument,
  };
}
