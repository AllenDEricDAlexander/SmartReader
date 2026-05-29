import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(`${process.cwd()}/src/styles.css`, "utf8");

describe("responsive reader layout", () => {
  it("keeps the empty-state primary action inside narrow sidebar layouts", () => {
    expect(styles).not.toContain("padding-left: 284px");
    expect(styles).not.toContain("padding-left: 300px");
    expect(styles).toContain("padding-left: 18px");
  });

  it("removes the mobile empty-state sidebar overlay from pointer hit-testing", () => {
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.reader-workspace\.with-sidebar\.empty-workspace \.reader-sidebar/);
    expect(styles).toMatch(/\.reader-workspace\.with-sidebar\.empty-workspace \.sidebar-resize-handle[\s\S]*display: none/);
  });
});
