import { describe, expect, it } from 'vitest';
import type { Bookmark } from './annotationModels';
import {
  addOrReplaceAnnotation,
  addOrReplaceBookmark,
  exportAnnotations,
  importAnnotations,
  removeAnnotation,
  removeBookmark,
  setAnnotationTag,
} from './annotationStore';

describe('annotationStore bookmarks', () => {
  it('adds bookmarks sorted by page', () => {
    const first: Bookmark = {
      id: null,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 10,
      title: 'Results',
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    };
    const second: Bookmark = { ...first, page: 2, title: 'Intro' };

    expect(addOrReplaceBookmark(addOrReplaceBookmark([], first), second).map((b) => b.page)).toEqual(
      [2, 10],
    );
  });

  it('removes bookmarks by id', () => {
    expect(
      removeBookmark(
        [
          {
            id: 1,
            documentKey: 'desktop:/tmp/book.pdf',
            page: 1,
            title: 'Intro',
            createdAt: '2026-06-16T00:00:00Z',
            updatedAt: '2026-06-16T00:00:00Z',
          },
        ],
        1,
      ),
    ).toEqual([]);
  });

  it('adds and removes annotations', () => {
    const annotation = {
      id: 4,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 3,
      type: 'highlight' as const,
      color: '#facc15',
      text: 'Important',
      quote: 'quoted text',
      areas: [{ pageIndex: 2, top: 10, left: 10, height: 2, width: 20 }],
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    };

    expect(addOrReplaceAnnotation([], annotation)).toEqual([annotation]);
    expect(removeAnnotation([annotation], 4)).toEqual([]);
  });

  it('exports and imports annotation JSON', () => {
    const annotations = [
      {
        id: 1,
        documentKey: 'desktop:/tmp/book.pdf',
        page: 3,
        type: 'note' as const,
        color: '#38bdf8',
        text: 'Remember this',
        quote: null,
        areas: [],
        createdAt: '2026-06-16T00:00:00Z',
        updatedAt: '2026-06-16T00:00:00Z',
      },
    ];

    const json = exportAnnotations(annotations);
    expect(importAnnotations(json)).toEqual(annotations);
  });

  it('adds and removes annotation tag ids without duplicating them', () => {
    const annotation = {
      id: 4,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 3,
      type: 'note' as const,
      color: '#38bdf8',
      text: 'Remember this',
      quote: null,
      areas: [],
      tagIds: [1],
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    };

    const selected = setAnnotationTag([annotation], 4, 1, true);
    expect(selected[0].tagIds).toEqual([1]);

    const unselected = setAnnotationTag(selected, 4, 1, false);
    expect(unselected[0].tagIds).toEqual([]);
  });
});
