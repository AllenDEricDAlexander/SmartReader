import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DocumentSession } from "./types/reader";

const tauriMocks = vi.hoisted(() => {
  let desktopOpenHandler: ((path: string) => void) | undefined;
  let sessionIndex = 0;

  const createDesktopSession = vi.fn(async (path: string): Promise<DocumentSession> => {
    sessionIndex += 1;

    return {
      id: `desktop-${sessionIndex}`,
      title: path.split("/").pop() ?? path,
      filePath: path,
      fileSource: { kind: "desktop-path", path },
      format: path.toLowerCase().endsWith(".epub") ? "epub" : "pdf",
      status: "error",
      error: {
        kind: "access-denied",
        title: "File access needed",
        message: "SmartReader cannot access this file path. Choose the file again to reopen it."
      },
      location: { kind: "none" },
      lastLocation: { kind: "none" },
      zoom: 1,
      fitMode: "continuous",
      sidebarMode: "contents",
      outline: [],
      searchResults: [],
      bookmarks: [],
      epubSettings: {
        fontSize: 18,
        theme: "system"
      },
      openedAt: sessionIndex,
      updatedAt: sessionIndex
    };
  });

  const openPendingDesktopFiles = vi.fn(async (openPath: (path: string) => void) => {
    if (openPendingDesktopFiles.mock.calls.length === 1) {
      openPath("/Users/mario/Books/start.pdf");
    }
  });

  return {
    createDesktopSession,
    openPendingDesktopFiles,
    listenForDesktopOpenFiles: vi.fn(async (openPath: (path: string) => void) => {
      desktopOpenHandler = openPath;
      return vi.fn();
    }),
    setupTauriMenu: vi.fn(async () => undefined),
    openDesktopFileDialog: vi.fn(async () => undefined),
    readFileSource: vi.fn(),
    emitDesktopOpen: (path: string) => desktopOpenHandler?.(path)
  };
});

vi.mock("./platform/fileSources", async () => ({
  ...(await vi.importActual<typeof import("./platform/fileSources")>("./platform/fileSources")),
  isTauriRuntime: () => true
}));

vi.mock("./platform/tauriBridge", () => ({
  createDesktopSession: tauriMocks.createDesktopSession,
  listenForDesktopOpenFiles: tauriMocks.listenForDesktopOpenFiles,
  openDesktopFileDialog: tauriMocks.openDesktopFileDialog,
  openPendingDesktopFiles: tauriMocks.openPendingDesktopFiles,
  readFileSource: tauriMocks.readFileSource,
  setupTauriMenu: tauriMocks.setupTauriMenu
}));

describe("App desktop open delivery", () => {
  it("drains pending desktop files only once after open state changes", async () => {
    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.createDesktopSession).toHaveBeenCalledWith("/Users/mario/Books/start.pdf");
    });

    await act(async () => {
      tauriMocks.emitDesktopOpen("/Users/mario/Books/warm.epub");
    });

    await waitFor(() => {
      expect(tauriMocks.createDesktopSession).toHaveBeenCalledWith("/Users/mario/Books/warm.epub");
    });

    expect(tauriMocks.openPendingDesktopFiles).toHaveBeenCalledTimes(1);
  });
});
