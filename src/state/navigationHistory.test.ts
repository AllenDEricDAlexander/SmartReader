import { describe, expect, it } from "vitest";
import {
  canNavigateBack,
  canNavigateForward,
  createNavigationHistory,
  navigateBack,
  navigateForward,
  removeNavigationHistory,
  recordNavigation
} from "./navigationHistory";
import type { ReaderLocation } from "../types/reader";

describe("reader navigation history", () => {
  it("records explicit navigation, moves back and forward, and clears forward on a new jump", () => {
    const pageOne: ReaderLocation = { kind: "page", page: 1 };
    const pageTwo: ReaderLocation = { kind: "page", page: 2 };
    const pageThree: ReaderLocation = { kind: "page", page: 3 };
    const pageFour: ReaderLocation = { kind: "page", page: 4 };
    const firstJump = recordNavigation(createNavigationHistory(), pageOne, pageTwo);
    const secondJump = recordNavigation(firstJump, pageTwo, pageThree);

    const back = navigateBack(secondJump, pageThree);

    expect(canNavigateBack(secondJump)).toBe(true);
    expect(back.location).toEqual(pageTwo);
    expect(canNavigateForward(back.history)).toBe(true);

    const forward = navigateForward(back.history, pageTwo);

    expect(forward.location).toEqual(pageThree);
    expect(canNavigateForward(forward.history)).toBe(false);

    const newJump = recordNavigation(back.history, pageTwo, pageFour);

    expect(canNavigateForward(newJump)).toBe(false);
  });

  it("does not record repeated locations or back and forward application as new history entries", () => {
    const pageOne: ReaderLocation = { kind: "page", page: 1 };
    const pageTwo: ReaderLocation = { kind: "page", page: 2 };
    const history = recordNavigation(createNavigationHistory(), pageOne, pageOne);
    const jumped = recordNavigation(history, pageOne, pageTwo);
    const back = navigateBack(jumped, pageTwo);

    expect(canNavigateBack(history)).toBe(false);
    expect(back.history.back).toEqual([]);
    expect(back.history.forward).toEqual([pageTwo]);
  });

  it("caps per-tab history and removes closed tab state", () => {
    let history = createNavigationHistory();

    for (let page = 1; page <= 130; page += 1) {
      history = recordNavigation(history, { kind: "page", page }, { kind: "page", page: page + 1 });
    }

    expect(history.back).toHaveLength(100);
    expect(history.back[0]).toEqual({ kind: "page", page: 31 });

    const cleaned = removeNavigationHistory({ open: history, closed: history }, "closed");

    expect(cleaned).toEqual({ open: history });
  });
});
