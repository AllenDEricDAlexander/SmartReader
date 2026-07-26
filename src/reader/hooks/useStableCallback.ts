import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a callback whose identity never changes while always invoking the
 * latest closure.
 *
 * The reader passes handlers into the PDF viewer, and viewer progress feeds back
 * into app state. Handlers built with `useCallback` still churn there, because
 * their dependencies (the active session, the recent-document list) get a new
 * identity on every page change. That churn reaches the viewer as new props and
 * defeats memoisation on the most render-sensitive component in the app.
 *
 * The returned function is safe to use in dependency arrays. It must not be
 * called during render — only from effects and event handlers — because the
 * stored closure is swapped after commit.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);

  // A layout effect, not a passive one: child effects run before parent passive
  // effects, so the viewer can report its first page before a passive update
  // lands and would otherwise invoke a stale closure.
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
