export type ReadingHistory = {
  currentPage: number;
  backStack: number[];
  forwardStack: number[];
};

export function createReadingHistory(initialPage: number): ReadingHistory {
  return {
    currentPage: initialPage,
    backStack: [],
    forwardStack: [],
  };
}

export function pushHardNavigation(history: ReadingHistory, nextPage: number): ReadingHistory {
  if (nextPage === history.currentPage) {
    return history;
  }

  return {
    currentPage: nextPage,
    backStack: [...history.backStack, history.currentPage],
    forwardStack: [],
  };
}

export function recordProgressOnly(history: ReadingHistory, nextPage: number): ReadingHistory {
  return {
    ...history,
    currentPage: nextPage,
  };
}

export function stepBack(history: ReadingHistory): ReadingHistory {
  const previous = history.backStack.at(-1);

  if (!previous) {
    return history;
  }

  return {
    currentPage: previous,
    backStack: history.backStack.slice(0, -1),
    forwardStack: [history.currentPage, ...history.forwardStack],
  };
}

export function stepForward(history: ReadingHistory): ReadingHistory {
  const next = history.forwardStack[0];

  if (!next) {
    return history;
  }

  return {
    currentPage: next,
    backStack: [...history.backStack, history.currentPage],
    forwardStack: history.forwardStack.slice(1),
  };
}
