import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveRecentFiles } from "../state/recentFiles";
import { saveRecentLibraryMetadata } from "../state/recentLibrary";
import type { RecentLibraryMetadata } from "../state/recentLibrary";
import { appSessionKey } from "../state/sessionPersistence";
import { smartReaderCacheKey } from "../state/smartReaderCache";
import type { RecentFile } from "../types/reader";

const resealControl = vi.hoisted(() => ({
  fail: false
}));

vi.mock("../state/recentLibraryEncryption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/recentLibraryEncryption")>();

  return {
    ...actual,
    resealCategoryEncryption: vi.fn((input: Parameters<typeof actual.resealCategoryEncryption>[0]) => {
      if (resealControl.fail) {
        return Promise.reject(new Error("reseal exploded"));
      }

      return actual.resealCategoryEncryption(input);
    })
  };
});

import { RecentLibraryPanel } from "./RecentLibraryPanel";
import {
  enableCategoryEncryption,
  resealCategoryEncryption
} from "../state/recentLibraryEncryption";

const recentFile: RecentFile = {
  id: "/Users/mario/Books/spec.pdf",
  title: "spec.pdf",
  path: "/Users/mario/Books/spec.pdf",
  parentPath: "/Users/mario/Books",
  format: "pdf",
  access: "desktop-path",
  lastOpenedAt: 1,
  resumeLabel: "Page 9",
  location: { kind: "page", page: 9 }
};

describe("RecentLibraryPanel reseal failure storage atomicity", () => {
  beforeEach(() => {
    localStorage.clear();
    resealControl.fail = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("keeps storage and UI on the previous safe state when reseal fails", async () => {
    const encrypted = await createEncryptedLibraryState();
    const lockedRecentPath = encrypted.recentFiles[0].path;

    render(<RecentLibraryPanelStorageHost initialRecentFiles={encrypted.recentFiles} />);
    await unlockEncryptedFolder();

    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    resealControl.fail = true;

    fireEvent.change(screen.getByLabelText("New category name"), {
      target: { value: "Hidden Child" }
    });
    fireEvent.change(screen.getByLabelText("Parent category"), {
      target: { value: "category-methods" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));

    await waitFor(() => {
      expect(resealCategoryEncryption).toHaveBeenCalled();
    });

    expect(screen.queryByRole("button", { name: "Hidden Child" })).toBeNull();
    expect(storageWriteText(storageWrites)).not.toContain("Hidden Child");
    expect(storageWriteText(storageWrites)).not.toContain("category-hidden-child");
    expect(localStorage.getItem("smartreader.recentLibrary.v1") ?? "").not.toContain("Hidden Child");
    expect(localStorage.getItem("smartreader.recentLibrary.v1") ?? "").not.toContain("category-hidden-child");
    expect(localStorage.getItem("smartreader.recentFiles.v1") ?? "").toContain(lockedRecentPath);
  });

  it("removes failed newly protected plaintext while keeping the locked recent entry when reseal fails", async () => {
    const classifiedRecent = {
      ...recentFile,
      id: "/Users/mario/Books/new-classified.pdf",
      title: "new-classified.pdf",
      path: "/Users/mario/Books/new-classified.pdf",
      lastOpenedAt: 2
    };
    const encrypted = await createEncryptedLibraryState();
    const lockedRecentPath = encrypted.recentFiles[0].path;

    localStorage.setItem(appSessionKey, JSON.stringify({
      version: 1,
      activeTabId: "doc-2",
      sidebarOpen: true,
      preferences: {},
      sessions: [{
        id: "doc-2",
        title: classifiedRecent.title,
        filePath: classifiedRecent.path,
        fileSource: { kind: "desktop-path", path: classifiedRecent.path },
        format: "pdf",
        status: "ready",
        location: { kind: "page", page: 2 },
        lastLocation: { kind: "page", page: 2 },
        openedAt: 1,
        updatedAt: 2
      }]
    }));
    localStorage.setItem(smartReaderCacheKey, JSON.stringify({
      schemaVersion: 1,
      settings: {},
      recentFiles: [classifiedRecent],
      readingProgress: [{
        documentId: classifiedRecent.path,
        title: classifiedRecent.title,
        path: classifiedRecent.path,
        format: classifiedRecent.format,
        location: classifiedRecent.location,
        updatedAt: classifiedRecent.lastOpenedAt
      }],
      session: {
        activeTabId: "doc-2",
        sidebarOpen: true,
        tabs: [{
          id: "doc-2",
          title: classifiedRecent.title,
          filePath: classifiedRecent.path,
          fileSource: { kind: "desktop-path", path: classifiedRecent.path },
          format: "pdf",
          status: "ready",
          location: { kind: "page", page: 2 },
          lastLocation: { kind: "page", page: 2 },
          openedAt: 1,
          updatedAt: 2
        }]
      },
      adapterCache: {
        searchIndexes: [{
          documentId: classifiedRecent.path,
          path: classifiedRecent.path,
          format: classifiedRecent.format,
          adapter: "wasm",
          version: "v1",
          updatedAt: classifiedRecent.lastOpenedAt
        }]
      }
    }));

    render(
      <RecentLibraryPanelStorageHost
        initialRecentFiles={[...encrypted.recentFiles, classifiedRecent]}
      />
    );
    await unlockEncryptedFolder();
    resealControl.fail = true;

    fireEvent.click(screen.getByRole("button", { name: "new-classified.pdf details" }));
    fireEvent.click(screen.getByLabelText("Methods"));

    await waitFor(() => {
      expect(resealCategoryEncryption).toHaveBeenCalled();
    });

    const persisted = localStorageSnapshot();
    expect(persisted).not.toContain(classifiedRecent.title);
    expect(persisted).not.toContain(classifiedRecent.path);

    const persistedRecentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];
    expect(persistedRecentFiles.some((file) => file.path === lockedRecentPath)).toBe(true);
    expect(persistedRecentFiles.some((file) => file.path.startsWith("smartreader-locked://"))).toBe(true);
  });
});

async function createEncryptedLibraryState(): Promise<{
  library: RecentLibraryMetadata;
  recentFiles: RecentFile[];
}> {
  const encrypted = await enableCategoryEncryption({
    library: createLibraryMetadata(),
    categoryId: "category-methods",
    password: "correct horse battery staple",
    recentFiles: [recentFile],
    storage: localStorage
  });

  saveRecentLibraryMetadata(encrypted.library);
  saveRecentFiles(encrypted.recentFiles);

  return encrypted;
}

function RecentLibraryPanelStorageHost(props: { initialRecentFiles: RecentFile[] }) {
  const [recentFiles, setRecentFiles] = useState(props.initialRecentFiles);

  return (
    <RecentLibraryPanel
      recentFiles={recentFiles}
      onOpenRecent={vi.fn()}
      onRecentFilesChange={(next) => {
        saveRecentFiles(next);
        setRecentFiles(next);
      }}
      onProtectedPathsLocked={vi.fn()}
      onRemoveRecent={vi.fn()}
      onClearRecent={vi.fn()}
    />
  );
}

async function unlockEncryptedFolder(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Locked document details" }));
  fireEvent.change(screen.getByLabelText("Folder password"), {
    target: { value: "correct horse battery staple" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock folder" }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "spec.pdf details" })).toBeInTheDocument();
  });
}

function createLibraryMetadata(): RecentLibraryMetadata {
  return {
    categories: [
      { id: "category-methods", name: "Methods" },
      { id: "category-qualitative", name: "Qualitative", parentId: "category-methods" },
      { id: "category-theory", name: "Theory" }
    ],
    tags: [],
    documents: {
      "/Users/mario/Books/spec.pdf": {
        categoryIds: ["category-methods"],
        tagIds: [],
        pinned: false,
        favorite: false
      }
    },
    encryptedFolders: {}
  };
}

function storageWriteText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => call.slice(1).join("\n")).join("\n");
}

function localStorageSnapshot(): string {
  return [
    localStorage.getItem("smartreader.recentLibrary.v1"),
    localStorage.getItem("smartreader.recentFiles.v1"),
    localStorage.getItem(appSessionKey),
    localStorage.getItem(smartReaderCacheKey)
  ].join("\n");
}
