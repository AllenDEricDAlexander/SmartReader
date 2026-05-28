import { describe, expect, it } from "vitest";
import { visibleRowRange } from "./virtualRows";

describe("virtual row helpers", () => {
  it("returns an empty range when there are no rows", () => {
    expect(visibleRowRange(0, 34, 0, 420, 8)).toEqual({ start: 0, end: 0 });
  });

  it("adds overscan rows around the viewport", () => {
    expect(visibleRowRange(100, 10, 250, 50, 2)).toEqual({ start: 23, end: 32 });
  });

  it("clamps the start range near the end of the list", () => {
    expect(visibleRowRange(30, 10, 290, 50, 2)).toEqual({ start: 21, end: 30 });
  });
});
