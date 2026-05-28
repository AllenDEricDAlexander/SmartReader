import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  nativePdfKitAnnotationSyncKind,
  nativePdfKitUnsupportedReason,
  pdfKitAnnotationRectsFromAnnotation
} from "../reader/pdfAnnotationGeometry";
import { safeAnnotationColor, safeAnnotationThickness } from "../reader/annotations";
import { syncPdfKitAnnotations } from "../platform/tauriBridge";
import type { DocumentSession, ReaderAnnotation } from "../types/reader";

type NativePdfKitOperation = "upsert" | "delete";

export function usePdfKitAnnotationSync(props: {
  enabled: boolean;
  sessions: DocumentSession[];
  setSessions: Dispatch<SetStateAction<DocumentSession[]>>;
  showHud: (message: string) => void;
}) {
  const { enabled, sessions, setSessions, showHud } = props;
  const inFlightSyncKeysRef = useRef(new Set<string>());
  const deferredRetryKeysRef = useRef(new Set<string>());
  const documentSyncQueuesRef = useRef(new Map<string, Promise<void>>());
  const managedCopyPathsRef = useRef(new Map<string, string>());

  const markUnsupportedNativePdfKit = useCallback((
    session: DocumentSession,
    annotation: ReaderAnnotation,
    reason = "unsupported-native-mapping"
  ) => {
    const now = Date.now();
    setSessions((current) =>
      current.map((candidate) => {
        if (candidate.id !== session.id) {
          return candidate;
        }

        let changed = false;
        const annotations = candidate.annotations.map((candidateAnnotation) => {
          if (
            candidateAnnotation.id !== annotation.id ||
            candidateAnnotation.updatedAt !== annotation.updatedAt
          ) {
            return candidateAnnotation;
          }

          changed = true;
          return {
            ...candidateAnnotation,
            nativePdfKit: {
              supported: false,
              status: reason,
              managedCopyPath: managedPdfKitCopyPath(session, candidateAnnotation, annotation),
              reason,
              syncedAt: now
            }
          };
        });

        return changed ? { ...candidate, annotations, updatedAt: now } : candidate;
      })
    );
    showHud("SmartReader annotation saved; native PDFKit unsupported");
  }, [setSessions, showHud]);

  const syncNativePdfKitAnnotation = useCallback((
    session: DocumentSession,
    annotation: ReaderAnnotation,
    operation: NativePdfKitOperation,
    retry = false
  ) => {
    if (
      !enabled ||
      session.format !== "pdf" ||
      session.fileSource.kind !== "desktop-path" ||
      annotation.location.kind !== "page"
    ) {
      return;
    }

    const syncKey = [session.id, annotation.id, annotation.updatedAt, operation].join(":");
    const documentSyncKey = pdfKitDocumentSyncKey(session);
    if (inFlightSyncKeysRef.current.has(syncKey)) {
      return;
    }

    if (retry && deferredRetryKeysRef.current.has(syncKey)) {
      return;
    }

    if (nativePdfKitUnsupportedReason(annotation) && operation !== "delete") {
      markUnsupportedNativePdfKit(session, annotation);
      return;
    }

    const kind = nativePdfKitAnnotationSyncKind(annotation);
    const area = annotation.area ?? (annotation.type === "note" ? defaultAnnotationArea(annotation.location) : undefined);
    const annotationForRects = area && !annotation.area
      ? { ...annotation, area }
      : annotation;
    const rects = pdfKitAnnotationRectsFromAnnotation(annotationForRects);

    if (!kind) {
      return;
    }

    if (rects.length === 0 && operation !== "delete") {
      markUnsupportedNativePdfKit(session, annotation, "unsupported-native-geometry");
      return;
    }

    const request: Parameters<typeof syncPdfKitAnnotations>[0] = {
      path: session.fileSource.path,
      managedCopyPath: managedPdfKitCopyPath(session, annotation),
      writeMode: "copy",
      annotations: [
        {
          id: annotation.id,
          operation,
          page: annotation.location.page,
          kind,
          color: safeAnnotationColor(annotation.color),
          thickness: safeAnnotationThickness(annotation.thickness),
          rects
        }
      ]
    };
    const note = annotation.note?.trim();

    if (note) {
      request.annotations[0].note = note;
    }

    const revision = annotation.updatedAt;
    inFlightSyncKeysRef.current.add(syncKey);
    const previousSync = documentSyncQueuesRef.current.get(documentSyncKey) ?? Promise.resolve();
    const queuedSync = previousSync
      .catch(() => undefined)
      .then(async () => {
        const managedCopyPath = managedPdfKitCopyPath(
          { pdfKitManagedCopyPath: managedCopyPathsRef.current.get(documentSyncKey) ?? session.pdfKitManagedCopyPath },
          annotation
        );
        try {
          const result = await syncPdfKitAnnotations({ ...request, managedCopyPath });
          const now = Date.now();
          const resultAnnotation = result.annotations.find((item) => item.id === annotation.id);
          managedCopyPathsRef.current.set(documentSyncKey, result.managedCopyPath);

          setSessions((current) =>
            current.map((candidate) => {
              if (candidate.id !== session.id) {
                return candidate;
              }

              let changed = false;
              const annotations = candidate.annotations.map((candidateAnnotation) => {
                if (
                  candidateAnnotation.id !== annotation.id ||
                  candidateAnnotation.updatedAt !== revision
                ) {
                  return candidateAnnotation;
                }

                changed = true;
                return {
                  ...candidateAnnotation,
                  nativePdfKit: {
                    supported: result.supported,
                    status: resultAnnotation?.status ?? result.status,
                    nativeId: resultAnnotation?.nativeId,
                    managedCopyPath: result.managedCopyPath,
                    reason: resultAnnotation?.reason,
                    syncedAt: now
                  }
                };
              });
              const pendingDeletedAnnotations = operation === "delete"
                ? candidate.pendingDeletedAnnotations?.filter((candidateAnnotation) => {
                    const keep = candidateAnnotation.id !== annotation.id ||
                      candidateAnnotation.updatedAt !== revision;

                    if (!keep) {
                      changed = true;
                    }

                    return keep;
                  })
                : candidate.pendingDeletedAnnotations;

              return changed
                ? {
                    ...candidate,
                    annotations,
                    pdfKitManagedCopyPath: result.managedCopyPath,
                    pendingDeletedAnnotations: pendingDeletedAnnotations?.length ? pendingDeletedAnnotations : undefined,
                    updatedAt: now
                  }
                : candidate;
            })
          );
          showHud(result.supported ? "PDFKit annotation copy saved" : "SmartReader annotation saved; native PDFKit unsupported");
        } catch (error: unknown) {
          const now = Date.now();
          deferredRetryKeysRef.current.add(syncKey);
          setSessions((current) =>
            current.map((candidate) => {
              if (candidate.id !== session.id) {
                return candidate;
              }

              let changed = false;
              const annotations = candidate.annotations.map((candidateAnnotation) => {
                if (
                  candidateAnnotation.id !== annotation.id ||
                  candidateAnnotation.updatedAt !== revision
                ) {
                  return candidateAnnotation;
                }

                changed = true;
                return {
                  ...candidateAnnotation,
                  nativePdfKit: failedNativePdfKitSyncState(candidate, candidateAnnotation, annotation, operation, error, now)
                };
              });

              if (changed) {
                return { ...candidate, annotations, updatedAt: now };
              }

              if (operation !== "delete") {
                return candidate;
              }

              const pendingDeletedAnnotations = upsertPendingDeletedAnnotation(
                candidate.pendingDeletedAnnotations ?? [],
                candidate,
                annotation,
                operation,
                error,
                now
              );

              return { ...candidate, annotations, pendingDeletedAnnotations, updatedAt: now };
            })
          );
          showHud("SmartReader annotation saved; PDFKit copy unavailable");
        }
      })
      .finally(() => {
        inFlightSyncKeysRef.current.delete(syncKey);
        if (documentSyncQueuesRef.current.get(documentSyncKey) === queuedSync) {
          documentSyncQueuesRef.current.delete(documentSyncKey);
        }
      });
    documentSyncQueuesRef.current.set(documentSyncKey, queuedSync);
  }, [enabled, markUnsupportedNativePdfKit, setSessions, showHud]);

  useEffect(() => {
    sessions.forEach((session) => {
      if (
        session.format === "pdf" &&
        session.fileSource.kind === "desktop-path" &&
        session.pdfKitManagedCopyPath
      ) {
        managedCopyPathsRef.current.set(pdfKitDocumentSyncKey(session), session.pdfKitManagedCopyPath);
      }
    });
  }, [sessions]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    sessions.forEach((session) => {
      if (session.format !== "pdf" || session.fileSource.kind !== "desktop-path") {
        return;
      }

      session.annotations.forEach((annotation) => {
        if (!annotation.nativePdfKit?.dirty || !annotation.nativePdfKit.pendingOperation) {
          return;
        }

        syncNativePdfKitAnnotation(session, annotation, annotation.nativePdfKit.pendingOperation, true);
      });
      session.pendingDeletedAnnotations?.forEach((annotation) => {
        if (!annotation.nativePdfKit?.dirty || !annotation.nativePdfKit.pendingOperation) {
          return;
        }

        syncNativePdfKitAnnotation(session, annotation, annotation.nativePdfKit.pendingOperation, true);
      });
    });
  }, [enabled, sessions, syncNativePdfKitAnnotation]);

  return useCallback((
    session: DocumentSession,
    annotation: ReaderAnnotation,
    operation: NativePdfKitOperation = "upsert"
  ) => {
    syncNativePdfKitAnnotation(session, annotation, operation);
  }, [syncNativePdfKitAnnotation]);
}

function pdfKitDocumentSyncKey(session: DocumentSession): string {
  return session.fileSource.kind === "desktop-path" ? [session.id, session.fileSource.path].join(":") : session.id;
}

function defaultAnnotationArea(location: ReaderAnnotation["location"]): ReaderAnnotation["area"] {
  return location.kind === "page"
    ? {
        page: location.page,
        left: 24,
        top: 24,
        width: 180,
        height: 48
      }
    : undefined;
}

function pdfKitSyncErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "PDFKit sync failed";
}

function failedNativePdfKitSyncState(
  session: Pick<DocumentSession, "pdfKitManagedCopyPath">,
  candidateAnnotation: ReaderAnnotation,
  annotation: ReaderAnnotation,
  operation: NativePdfKitOperation,
  error: unknown,
  now: number
): NonNullable<ReaderAnnotation["nativePdfKit"]> {
  return {
    ...candidateAnnotation.nativePdfKit,
    supported: false,
    status: "sync-failed",
    managedCopyPath: managedPdfKitCopyPath(session, candidateAnnotation, annotation),
    dirty: true,
    pendingOperation: operation,
    lastSyncError: pdfKitSyncErrorMessage(error),
    failedAt: now
  };
}

function managedPdfKitCopyPath(
  session: Pick<DocumentSession, "pdfKitManagedCopyPath">,
  annotation: ReaderAnnotation,
  fallbackAnnotation?: ReaderAnnotation
): string | undefined {
  return session.pdfKitManagedCopyPath ??
    annotation.nativePdfKit?.managedCopyPath ??
    fallbackAnnotation?.nativePdfKit?.managedCopyPath;
}

function upsertPendingDeletedAnnotation(
  pendingDeletedAnnotations: ReaderAnnotation[],
  session: Pick<DocumentSession, "pdfKitManagedCopyPath">,
  annotation: ReaderAnnotation,
  operation: NativePdfKitOperation,
  error: unknown,
  now: number
): ReaderAnnotation[] {
  let replaced = false;
  const failedAnnotation = {
    ...annotation,
    nativePdfKit: failedNativePdfKitSyncState(session, annotation, annotation, operation, error, now)
  };
  const updatedAnnotations = pendingDeletedAnnotations.map((candidateAnnotation) => {
    if (
      candidateAnnotation.id !== annotation.id ||
      candidateAnnotation.updatedAt !== annotation.updatedAt
    ) {
      return candidateAnnotation;
    }

    replaced = true;
    return failedAnnotation;
  });

  return replaced ? updatedAnnotations : [failedAnnotation, ...pendingDeletedAnnotations];
}
