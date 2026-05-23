import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultReaderShortcutBindings,
  findShortcutConflicts,
  normalizeShortcut,
  shouldHandleReaderShortcut,
  useReaderShortcuts
} from "./useReaderShortcuts";

describe("reader shortcuts", () => {
  it("ignores reading shortcuts from editable targets", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "true");

    expect(shouldHandleReaderShortcut(new KeyboardEvent("keydown", { key: "ArrowRight" }))).toBe(true);
    expect(shouldHandleReaderShortcut(new KeyboardEvent("keydown", { key: "ArrowRight" }), input)).toBe(false);
    expect(shouldHandleReaderShortcut(new KeyboardEvent("keydown", { key: "ArrowRight" }), textarea)).toBe(false);
    expect(shouldHandleReaderShortcut(new KeyboardEvent("keydown", { key: "ArrowRight" }), select)).toBe(false);
    expect(shouldHandleReaderShortcut(new KeyboardEvent("keydown", { key: "ArrowRight" }), contentEditable)).toBe(false);
  });

  it("normalizes default and user shortcuts and reports conflicts", () => {
    const bindings = defaultReaderShortcutBindings([
      { commandId: "reader.nextPage", shortcut: "j" },
      { commandId: "reader.previousPage", shortcut: "Meta+F" }
    ]);

    expect(normalizeShortcut(new KeyboardEvent("keydown", { key: "j" }))).toBe("J");
    expect(bindings.find((binding) => binding.commandId === "reader.nextPage")?.shortcut).toBe("J");
    expect(findShortcutConflicts(bindings)).toEqual([
      {
        shortcut: "Meta+F",
        commandIds: ["reader.previousPage", "reader.openFind"]
      }
    ]);
  });

  it("exposes a hook that runs matching shortcuts and prevents browser defaults", () => {
    const nextPage = vi.fn();

    function TestHarness() {
      useReaderShortcuts({
        enabled: true,
        bindings: [{ commandId: "reader.nextPage", shortcut: "ArrowRight" }],
        handlers: {
          "reader.nextPage": nextPage
        }
      });

      return <button>Reader</button>;
    }

    render(<TestHarness />);

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(nextPage).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
