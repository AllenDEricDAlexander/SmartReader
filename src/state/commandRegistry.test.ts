import { describe, expect, it, vi } from "vitest";
import { createCommandRegistry } from "./commandRegistry";
import { createSessionFromFile } from "./documentSessions";

describe("command registry", () => {
  it("routes shortcuts through shell commands instead of renderer internals", () => {
    const openFile = vi.fn();
    const closeTab = vi.fn();
    const toggleSidebar = vi.fn();
    const zoomIn = vi.fn();
    const session = createSessionFromFile({
      path: "/Users/mario/Documents/spec.pdf",
      name: "spec.pdf",
      size: 1024,
      lastModified: 100
    });

    const registry = createCommandRegistry({
      getActiveSession: () => session,
      actions: {
        openFile,
        closeTab,
        createEmptyTab: vi.fn(),
        toggleSidebar,
        openFind: vi.fn(),
        findNext: vi.fn(),
        findPrevious: vi.fn(),
        zoomIn,
        zoomOut: vi.fn(),
        resetZoom: vi.fn(),
        toggleBookmark: vi.fn(),
        openPreferences: vi.fn(),
        focusLocationInput: vi.fn(),
        navigateBack: vi.fn(),
        navigateForward: vi.fn()
      }
    });

    expect(registry.runShortcut("Meta+O")).toBe(true);
    expect(registry.runShortcut("Meta+B")).toBe(true);
    expect(registry.runShortcut("Meta+=")).toBe(true);
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("disables document commands when no readable document is active", () => {
    const registry = createCommandRegistry({
      getActiveSession: () => undefined,
      actions: {
        openFile: vi.fn(),
        closeTab: vi.fn(),
        createEmptyTab: vi.fn(),
        toggleSidebar: vi.fn(),
        openFind: vi.fn(),
        findNext: vi.fn(),
        findPrevious: vi.fn(),
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        resetZoom: vi.fn(),
        toggleBookmark: vi.fn(),
        openPreferences: vi.fn(),
        focusLocationInput: vi.fn(),
        navigateBack: vi.fn(),
        navigateForward: vi.fn()
      }
    });

    expect(registry.getCommand("zoom.in")?.enabled).toBe(false);
    expect(registry.runShortcut("Meta+=")).toBe(false);
    expect(registry.getCommand("file.open")?.enabled).toBe(true);
  });
});
