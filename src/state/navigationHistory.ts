import type { ReaderLocation } from "../types/reader";

export interface NavigationHistory {
  back: ReaderLocation[];
  forward: ReaderLocation[];
}

export const NAVIGATION_HISTORY_LIMIT = 100;

export function createNavigationHistory(): NavigationHistory {
  return {
    back: [],
    forward: []
  };
}

export function canNavigateBack(history: NavigationHistory | undefined): boolean {
  return Boolean(history?.back.length);
}

export function canNavigateForward(history: NavigationHistory | undefined): boolean {
  return Boolean(history?.forward.length);
}

export function recordNavigation(
  history: NavigationHistory,
  current: ReaderLocation,
  next: ReaderLocation
): NavigationHistory {
  if (sameLocation(current, next)) {
    return history;
  }

  return {
    back: capHistoryStack([...history.back, current]),
    forward: []
  };
}

export function navigateBack(
  history: NavigationHistory,
  current: ReaderLocation
): { history: NavigationHistory; location: ReaderLocation } {
  const location = history.back.at(-1);

  if (!location) {
    return { history, location: current };
  }

  return {
    history: {
      back: history.back.slice(0, -1),
      forward: capHistoryStack([current, ...history.forward])
    },
    location
  };
}

export function navigateForward(
  history: NavigationHistory,
  current: ReaderLocation
): { history: NavigationHistory; location: ReaderLocation } {
  const location = history.forward[0];

  if (!location) {
    return { history, location: current };
  }

  return {
    history: {
      back: capHistoryStack([...history.back, current]),
      forward: history.forward.slice(1)
    },
    location
  };
}

export function removeNavigationHistory(
  histories: Record<string, NavigationHistory>,
  tabId: string
): Record<string, NavigationHistory> {
  if (!(tabId in histories)) {
    return histories;
  }

  const next = { ...histories };
  delete next[tabId];
  return next;
}

function sameLocation(first: ReaderLocation, second: ReaderLocation): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function capHistoryStack(stack: ReaderLocation[]): ReaderLocation[] {
  return stack.length > NAVIGATION_HISTORY_LIMIT
    ? stack.slice(stack.length - NAVIGATION_HISTORY_LIMIT)
    : stack;
}
