import { useCallback, useRef, useState } from 'react';
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
  const loadVersions = useRef(new Map<string, number>());
  const privacyVersions = useRef(new Map<string, number>());
  const [bookmarksByDocument, setBookmarksByDocument] = useState<Record<string, Bookmark[]>>({});
  const [annotationsByDocument, setAnnotationsByDocument] = useState<
    Record<string, ReaderAnnotation[]>
  >({});

  const loadDocumentDecorations = useCallback(
    async (documentKey: string) => {
      const version = (loadVersions.current.get(documentKey) ?? 0) + 1;
      loadVersions.current.set(documentKey, version);
      const [bookmarks, annotations] = await Promise.all([
        persistence.listBookmarks(documentKey),
        persistence.listAnnotations(documentKey),
      ]);
      if (loadVersions.current.get(documentKey) !== version) return;

      setBookmarksByDocument((current) => ({ ...current, [documentKey]: bookmarks }));
      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: annotations.map(normalizeAnnotation),
      }));
    },
    [persistence],
  );

  const forgetDocumentDecorations = useCallback((documentKeys: string[]) => {
    for (const key of documentKeys) {
      loadVersions.current.set(key, (loadVersions.current.get(key) ?? 0) + 1);
      privacyVersions.current.set(key, (privacyVersions.current.get(key) ?? 0) + 1);
    }
    const excluded = new Set(documentKeys);
    setBookmarksByDocument((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !excluded.has(key))));
    setAnnotationsByDocument((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !excluded.has(key))));
  }, []);

  const addBookmarkForActivePage = useCallback(async () => {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const privacy = privacyVersions.current.get(activeSession.documentKey) ?? 0;
    const saved = await persistence.saveBookmark({
      id: null,
      documentKey: activeSession.documentKey,
      page: activeSession.page,
      title: `Page ${activeSession.page}`,
      note: null,
      createdAt: now,
      updatedAt: now,
    });
    if ((privacyVersions.current.get(activeSession.documentKey) ?? 0) !== privacy) return;

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

      const privacy = privacyVersions.current.get(documentKey) ?? 0;
      const saved = await persistence.saveBookmark({
        ...bookmark,
        title: normalizedTitle,
        note: normalizedNote,
        updatedAt: new Date().toISOString(),
      });
      if ((privacyVersions.current.get(documentKey) ?? 0) !== privacy) return undefined;

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
      const privacy = privacyVersions.current.get(documentKey) ?? 0;
      await persistence.deleteBookmark(bookmarkId);
      if ((privacyVersions.current.get(documentKey) ?? 0) !== privacy) return;
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
      const privacy = privacyVersions.current.get(activeSession.documentKey) ?? 0;
      const saved = await persistence.saveAnnotation({
        id: null,
        documentKey: activeSession.documentKey,
        createdAt: now,
        updatedAt: now,
        ...input,
      });
      if ((privacyVersions.current.get(activeSession.documentKey) ?? 0) !== privacy) return undefined;

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
      const privacy = privacyVersions.current.get(documentKey) ?? 0;
      const { tagIds: _tagIds, ...annotationWithoutTags } = annotation;
      const saved = await persistence.saveAnnotation({
        ...annotationWithoutTags,
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      if ((privacyVersions.current.get(documentKey) ?? 0) !== privacy) return undefined;
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
      const privacy = privacyVersions.current.get(documentKey) ?? 0;
      if (selected) {
        await persistence.detachAnnotationTag(annotationId, tagId);
      } else {
        await persistence.attachAnnotationTag(annotationId, tagId);
      }
      if ((privacyVersions.current.get(documentKey) ?? 0) !== privacy) return;

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
    async (documentKey: string, annotationId: number) => {
      const privacy = privacyVersions.current.get(documentKey) ?? 0;
      await persistence.deleteAnnotation(annotationId);
      if ((privacyVersions.current.get(documentKey) ?? 0) !== privacy) return;
      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: removeAnnotation(current[documentKey] ?? [], annotationId),
      }));
    },
    [persistence],
  );

  const importAnnotationsForDocument = useCallback(
    async (documentKey: string, json: string) => {
      if (!json.trim()) return;
      const privacy = privacyVersions.current.get(documentKey) ?? 0;
      const imported = importAnnotations(json);
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
      if ((privacyVersions.current.get(documentKey) ?? 0) !== privacy) return;

      setAnnotationsByDocument((current) => ({
        ...current,
        [documentKey]: savedAnnotations
          .map(normalizeAnnotation)
          .reduce(
            (annotations, annotation) => addOrReplaceAnnotation(annotations, annotation),
            current[documentKey] ?? [],
          ),
      }));
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
    forgetDocumentDecorations,
    renameBookmarkForDocument,
    saveAnnotationForActiveDocument,
    toggleAnnotationTagForDocument,
    updateAnnotationForDocument,
    updateBookmarkForDocument,
  };
}
