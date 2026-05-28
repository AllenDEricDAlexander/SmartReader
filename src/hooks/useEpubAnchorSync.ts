import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createEpubAnchor, rebindEpubAnchor, resolveEpubAnchor } from "../platform/tauriBridge";
import type { DocumentSession, ReaderAnnotation } from "../types/reader";

export function useEpubAnchorSync(props: {
  activeSession?: DocumentSession;
  setSessions: Dispatch<SetStateAction<DocumentSession[]>>;
}) {
  const { activeSession, setSessions } = props;
  const epubAnchorResolveRef = useRef(new Set<string>());

  useEffect(() => {
    const session = activeSession;
    if (!session || session.format !== "epub" || session.fileSource.kind !== "desktop-path") {
      return;
    }

    const epubPath = session.fileSource.path;

    session.annotations.forEach((annotation) => {
      if (annotation.location.kind !== "epub" || !annotation.location.anchor) {
        return;
      }

      const anchor = annotation.location.anchor;
      const resolveKey = [
        session.id,
        annotation.id,
        annotation.updatedAt,
        anchor.anchorHash,
        anchor.occurrenceIndex,
        anchor.startOffset,
        anchor.endOffset
      ].join(":");

      if (epubAnchorResolveRef.current.has(resolveKey)) {
        return;
      }

      epubAnchorResolveRef.current.add(resolveKey);
      void resolveEpubAnchor(epubPath, anchor)
        .catch(() => rebindEpubAnchor(epubPath, anchor).catch((error: unknown) => {
          markEpubAnchorFallback(setSessions, session.id, annotation.id, annotation.updatedAt, "anchor-rebind-failed", error);
          return undefined;
        }))
        .then((result) => {
          if (!result) {
            return;
          }

          setSessions((current) =>
            current.map((candidate) => {
              if (candidate.id !== session.id) {
                return candidate;
              }

              let changed = false;
              const annotations = candidate.annotations.map((candidateAnnotation) => {
                if (
                  candidateAnnotation.id !== annotation.id ||
                  candidateAnnotation.updatedAt !== annotation.updatedAt ||
                  candidateAnnotation.location.kind !== "epub"
                ) {
                  return candidateAnnotation;
                }

                const currentAnchor = candidateAnnotation.location.anchor;
                if (
                  currentAnchor &&
                  currentAnchor.anchorHash === result.anchor.anchorHash &&
                  currentAnchor.occurrenceIndex === result.anchor.occurrenceIndex &&
                  currentAnchor.startOffset === result.anchor.startOffset &&
                  currentAnchor.endOffset === result.anchor.endOffset
                ) {
                  return candidateAnnotation;
                }

                changed = true;
                return {
                  ...candidateAnnotation,
                  location: {
                    ...candidateAnnotation.location,
                    anchor: result.anchor,
                    cfi: result.anchor.cfiHint ?? candidateAnnotation.location.cfi
                  },
                  nativeEpub: {
                    supported: true,
                    status: result.status,
                    syncedAt: Date.now()
                  }
                };
              });

              return changed ? { ...candidate, annotations, updatedAt: Date.now() } : candidate;
            })
          );
        })
        .catch(() => undefined);
    });
  }, [activeSession, setSessions]);

  return useCallback((session: DocumentSession, annotation: ReaderAnnotation) => {
    if (
      session.format !== "epub" ||
      session.fileSource.kind !== "desktop-path" ||
      annotation.location.kind !== "epub" ||
      !annotation.location.chapterHref ||
      !annotation.selectedText?.trim()
    ) {
      return;
    }

    const revision = annotation.updatedAt;
    const request = {
      path: session.fileSource.path,
      chapterHref: annotation.location.chapterHref,
      selectedText: annotation.selectedText.trim(),
      cfiHint: annotation.location.cfi,
      ...(typeof annotation.location.anchorOccurrenceIndex === "number"
        ? { occurrenceIndex: annotation.location.anchorOccurrenceIndex }
        : {})
    };

    void createEpubAnchor(request)
      .then((anchor) => {
        setSessions((current) =>
          current.map((candidate) => {
            if (candidate.id !== session.id) {
              return candidate;
            }

            let changed = false;
            const annotations = candidate.annotations.map((candidateAnnotation) => {
              if (
                candidateAnnotation.id !== annotation.id ||
                candidateAnnotation.updatedAt !== revision ||
                candidateAnnotation.location.kind !== "epub"
              ) {
                return candidateAnnotation;
              }

              changed = true;
                return {
                  ...candidateAnnotation,
                  location: {
                    ...candidateAnnotation.location,
                    anchor,
                    cfi: anchor.cfiHint ?? candidateAnnotation.location.cfi
                  },
                  nativeEpub: {
                    supported: true,
                    status: "anchored",
                    syncedAt: Date.now()
                  }
                };
              });

            return changed ? { ...candidate, annotations, updatedAt: Date.now() } : candidate;
          })
        );
      })
      .catch((error: unknown) => {
        markEpubAnchorFallback(setSessions, session.id, annotation.id, revision, "anchor-create-failed", error);
      });
  }, [setSessions]);
}

function markEpubAnchorFallback(
  setSessions: Dispatch<SetStateAction<DocumentSession[]>>,
  sessionId: string,
  annotationId: string,
  revision: number,
  reason: string,
  error: unknown
) {
  const now = Date.now();
  setSessions((current) =>
    current.map((candidate) => {
      if (candidate.id !== sessionId) {
        return candidate;
      }

      let changed = false;
      const annotations = candidate.annotations.map((candidateAnnotation) => {
        if (candidateAnnotation.id !== annotationId || candidateAnnotation.updatedAt !== revision) {
          return candidateAnnotation;
        }

        changed = true;
        return {
          ...candidateAnnotation,
          nativeEpub: {
            supported: false,
            status: "fallback-text-match",
            reason,
            lastError: epubAnchorErrorMessage(error),
            failedAt: now
          }
        };
      });

      return changed ? { ...candidate, annotations, updatedAt: now } : candidate;
    })
  );
}

function epubAnchorErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "EPUB native anchor failed";
}
