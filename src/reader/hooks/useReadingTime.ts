import { useEffect, useRef } from 'react';
import type { DocumentSession } from '../../documents/documentModels';
import { errorMessage, type LibraryService } from '../../library/libraryService';

type UseReadingTimeInput = {
  library?: LibraryService;
  session: DocumentSession | null;
  active: boolean;
  ready: boolean;
  onError?(message: string): void;
};

export function useReadingTime({ library, session, active, ready, onError }: UseReadingTimeInput): void {
  const latestSession = useRef(session);
  const reportError = useRef(onError);
  const paperId = session?.source.kind === 'library' ? session.source.paperId : null;

  // Passive cleanups run before these updates, so a departing tab flushes its
  // own latest page and zoom, never the newly selected tab's reading position.
  useEffect(() => {
    latestSession.current = session;
    reportError.current = onError;
  }, [session, onError]);

  useEffect(() => {
    if (!library || !session || paperId === null || !active || !ready) return;
    const readingLibrary = library;
    const readingPaperId = paperId;
    const initialSession = session;
    let access = library.captureAccess();
    if (!library.canAccess(paperId, access)) return;
    let focused = document.hasFocus();
    let segmentStart = focused && document.visibilityState === 'visible' ? performance.now() : null;
    let pendingSeconds = 0;
    let stopped = false;
    let disposed = false;

    function collectSegment() {
      if (segmentStart === null) return;
      const now = performance.now();
      pendingSeconds += Math.max(0, now - segmentStart) / 1000;
      segmentStart = now;
    }

    function flush() {
      if (stopped) return;
      collectSegment();
      if (pendingSeconds <= 0 || !readingLibrary.canAccess(readingPaperId, access)) return;
      const current = latestSession.current;
      const position = current?.id === initialSession.id && current.source.kind === 'library'
        && current.source.paperId === paperId ? current : initialSession;
      let remaining = pendingSeconds;
      pendingSeconds = 0;
      // The service bounds each increment to 60 seconds. Split a long segment
      // if the event loop delayed the regular 15-second flush.
      while (remaining > 0) {
        const seconds = Math.min(60, remaining);
        remaining -= seconds;
        void readingLibrary.recordReading(readingPaperId, seconds, position.page, position.zoom).catch((failure: unknown) => {
          if (stopped || !readingLibrary.canAccess(readingPaperId, access)) return;
          if (!disposed) pendingSeconds += seconds;
          reportError.current?.(errorMessage(failure));
        });
      }
    }

    function updateForeground() {
      if (stopped) return;
      if (focused && document.visibilityState === 'visible') {
        if (segmentStart === null) segmentStart = performance.now();
      } else {
        collectSegment();
        segmentStart = null;
        flush();
      }
    }

    const onFocus = () => { focused = true; updateForeground(); };
    const onBlur = () => { focused = false; updateForeground(); };
    const stopLocked = library.onLocked((ids) => {
      if (ids.includes(paperId)) {
        stopped = true;
        segmentStart = null;
        pendingSeconds = 0;
      } else {
        access = library.captureAccess();
      }
    });
    const timer = window.setInterval(flush, 15_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', updateForeground);

    return () => {
      flush();
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', updateForeground);
      stopLocked();
    };
  }, [library, session?.id, paperId, active, ready]);
}
