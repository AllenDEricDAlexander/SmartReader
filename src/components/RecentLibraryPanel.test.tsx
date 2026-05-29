import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as recentLibraryEncryption from "../state/recentLibraryEncryption";
import { RecentLibraryPanel, mergeRecentLibraryCategory } from "./RecentLibraryPanel";
import { saveRecentFiles } from "../state/recentFiles";
import { saveRecentLibraryMetadata } from "../state/recentLibrary";
import type { RecentLibraryCategory, RecentLibraryMetadata } from "../state/recentLibrary";
import { appSessionKey } from "../state/sessionPersistence";
import { createSmartReaderCacheEnvelope, smartReaderCacheKey } from "../state/smartReaderCache";
import type { AppSessionSnapshot, PersistedDocumentSession, Preferences, RecentFile } from "../types/reader";

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

describe("RecentLibraryPanel category merge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not list descendant categories as merge targets", () => {
    localStorage.setItem("smartreader.recentLibrary.v1", JSON.stringify(createLibraryMetadata()));

    render(
      <RecentLibraryPanel
        recentFiles={[recentFile]}
        onOpenRecent={vi.fn()}
        onRecentFilesChange={vi.fn()}
        onProtectedPathsLocked={vi.fn()}
        onRemoveRecent={vi.fn()}
        onClearRecent={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Manage category"), {
      target: { value: "category-methods" }
    });

    const mergeTarget = screen.getByLabelText("Merge into");
    expect(within(mergeTarget).queryByRole("option", { name: "Qualitative" })).toBeNull();
    expect(within(mergeTarget).getByRole("option", { name: "Theory" })).toBeInTheDocument();
  });

  it("rejects merging a parent into its descendant without creating a category cycle", () => {
    const library = createLibraryMetadata();
    const merged = mergeRecentLibraryCategory(library, "category-methods", "category-qualitative");

    expect(merged.categories).toEqual(library.categories);
    expect(merged.documents["/Users/mario/Books/spec.pdf"].categoryIds).toEqual(["category-methods"]);
    expect(merged.categories.some((category) => category.parentId === category.id)).toBe(false);
    expect(hasCategoryCycle(merged.categories)).toBe(false);
  });

  it("moves documents and children when merging into a valid target", () => {
    const merged = mergeRecentLibraryCategory(createLibraryMetadata(), "category-methods", "category-theory");

    expect(merged.categories.map((category) => category.id)).toEqual([
      "category-qualitative",
      "category-theory"
    ]);
    expect(merged.categories.find((category) => category.id === "category-qualitative")?.parentId).toBe("category-theory");
    expect(merged.documents["/Users/mario/Books/spec.pdf"].categoryIds).toEqual(["category-theory"]);
    expect(hasCategoryCycle(merged.categories)).toBe(false);
  });
});

describe("RecentLibraryPanel batch operations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("removes every selected recent file in one batch delete", () => {
    function RecentLibraryPanelHost() {
      const [recentFiles, setRecentFiles] = useState<RecentFile[]>([
        recentFile,
        {
          ...recentFile,
          id: "/Users/mario/Books/notes.epub",
          title: "notes.epub",
          path: "/Users/mario/Books/notes.epub",
          format: "epub"
        },
        {
          ...recentFile,
          id: "/Users/mario/Books/keep.pdf",
          title: "keep.pdf",
          path: "/Users/mario/Books/keep.pdf"
        }
      ]);

      return (
        <RecentLibraryPanel
          recentFiles={recentFiles}
          onOpenRecent={vi.fn()}
          onRecentFilesChange={setRecentFiles}
          onProtectedPathsLocked={vi.fn()}
          onRemoveRecent={(path) => {
            setRecentFiles(recentFiles.filter((file) => file.path !== path));
          }}
          onClearRecent={vi.fn()}
        />
      );
    }

    render(<RecentLibraryPanelHost />);

    fireEvent.click(screen.getByLabelText("Select spec.pdf"));
    fireEvent.click(screen.getByLabelText("Select notes.epub"));
    fireEvent.click(within(screen.getByLabelText("Batch operations")).getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("spec.pdf")).toBeNull();
    expect(screen.queryByText("notes.epub")).toBeNull();
    expect(screen.getByText("keep.pdf")).toBeInTheDocument();
  });
});

describe("RecentLibraryPanel encrypted storage atomicity", () => {
  const password = "correct horse battery staple";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("does not persist child category names or ids before reseal finishes", async () => {
    const encrypted = await createEncryptedLibraryState();
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");

    render(<RecentLibraryPanelStorageHost initialRecentFiles={encrypted.recentFiles} />);
    await unlockEncryptedFolder(password);
    storageWrites.mockClear();

    fireEvent.change(screen.getByLabelText("New category name"), {
      target: { value: "Hidden Child" }
    });
    fireEvent.change(screen.getByLabelText("Parent category"), {
      target: { value: "category-methods" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));

    expect(storageWriteText(storageWrites)).not.toContain("Hidden Child");
    expect(storageWriteText(storageWrites)).not.toContain("category-hidden-child");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hidden Child" })).toBeInTheDocument();
    });

    const persisted = localStorageSnapshot();
    expect(persisted).not.toContain("Hidden Child");
    expect(persisted).not.toContain("category-hidden-child");
    await expect(unlockPersistedLibrary()).resolves.toMatchObject({
      library: {
        categories: expect.arrayContaining([
          expect.objectContaining({
            id: "category-hidden-child",
            name: "Hidden Child",
            parentId: "category-methods"
          })
        ])
      }
    });
  });

  it("does not persist newly protected recent title or path when classifying into an unlocked encrypted category", async () => {
    const classifiedRecent = {
      ...recentFile,
      id: "/Users/mario/Books/new-classified.pdf",
      title: "new-classified.pdf",
      path: "/Users/mario/Books/new-classified.pdf",
      lastOpenedAt: 2
    };
    const encrypted = await createEncryptedLibraryState();
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");

    localStorage.setItem(appSessionKey, JSON.stringify(createSnapshot(createPersistedSession({
      id: "doc-2",
      path: classifiedRecent.path,
      title: classifiedRecent.title
    }))));
    localStorage.setItem(smartReaderCacheKey, JSON.stringify(createCacheWithRecent(classifiedRecent)));

    render(
      <RecentLibraryPanelStorageHost
        initialRecentFiles={[...encrypted.recentFiles, classifiedRecent]}
      />
    );
    await unlockEncryptedFolder(password);
    storageWrites.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "new-classified.pdf details" }));
    fireEvent.click(screen.getByLabelText("Methods"));

    expect(storageWriteText(storageWrites)).not.toContain(classifiedRecent.title);
    expect(storageWriteText(storageWrites)).not.toContain(classifiedRecent.path);
    expect(localStorageSnapshot()).not.toContain(classifiedRecent.title);
    expect(localStorageSnapshot()).not.toContain(classifiedRecent.path);

    await waitFor(() => {
      expect(localStorageSnapshot()).not.toContain(classifiedRecent.title);
      expect(localStorageSnapshot()).not.toContain(classifiedRecent.path);
    });
  });

  it("removes an encrypted category binding without restoring the old locked category after reload", async () => {
    const encrypted = await createEncryptedLibraryState();

    render(<RecentLibraryPanelStorageHost initialRecentFiles={encrypted.recentFiles} />);
    await unlockEncryptedFolder(password);

    fireEvent.click(screen.getByRole("button", { name: "spec.pdf details" }));
    fireEvent.click(screen.getByLabelText("Methods"));

    await waitFor(() => {
      const recentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];

      expect(recentFiles).toHaveLength(1);
      expect(recentFiles[0].path).toBe(recentFile.path);
      expect(recentFiles[0].protection).toBeUndefined();
    });

    const persistedLibrary = JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata;
    expect(persistedLibrary.encryptedFolders).toEqual({});
    expect(persistedLibrary.documents[recentFile.path]).toMatchObject({ categoryIds: [] });
    expect(screen.queryByText("Locked document")).toBeNull();

    cleanup();
    render(<RecentLibraryPanelStorageHost initialRecentFiles={JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[]} />);

    expect(screen.getByRole("button", { name: "spec.pdf details" })).toBeInTheDocument();
    expect(screen.queryByText("Locked document")).toBeNull();
  });

  it("batch moves the last protected document to a non-encrypted category without restoring the old locked category", async () => {
    const encrypted = await createEncryptedLibraryState();

    render(<RecentLibraryPanelStorageHost initialRecentFiles={encrypted.recentFiles} />);
    await unlockEncryptedFolder(password);

    fireEvent.click(screen.getByLabelText("Select spec.pdf"));
    fireEvent.change(screen.getByLabelText("Batch category"), {
      target: { value: "category-theory" }
    });
    fireEvent.click(within(screen.getByLabelText("Batch operations")).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      const recentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];

      expect(recentFiles[0].path).toBe(recentFile.path);
      expect(recentFiles[0].protection).toBeUndefined();
    });

    const persistedLibrary = JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata;
    expect(persistedLibrary.encryptedFolders).toEqual({});
    expect(persistedLibrary.documents[recentFile.path]).toMatchObject({
      categoryIds: ["category-theory"]
    });
  });

  it("clears locked placeholders without leaving encrypted folder state that has no unlock entry", async () => {
    const encrypted = await createEncryptedLibraryState();

    function ClearHost() {
      const [recentFiles, setRecentFiles] = useState<RecentFile[]>(encrypted.recentFiles);

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
          onClearRecent={() => {
            saveRecentFiles([]);
            setRecentFiles([]);
          }}
        />
      );
    }

    render(<ClearHost />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(screen.queryByText("Locked document")).toBeNull();
    });

    const persistedLibrary = JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata;
    expect(persistedLibrary.encryptedFolders).toEqual({});
    expect(persistedLibrary.categories).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: encrypted.recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0] })
    ]));
  });

  it("batch deletes locked placeholders without leaving encrypted folder state that has no unlock entry", async () => {
    const encrypted = await createEncryptedLibraryState();

    render(<RecentLibraryPanelStorageHost initialRecentFiles={encrypted.recentFiles} />);

    fireEvent.click(screen.getByLabelText("Select Locked document"));
    fireEvent.click(within(screen.getByLabelText("Batch operations")).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("Locked document")).toBeNull();
    });

    const persistedLibrary = JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata;
    const persistedRecentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];
    expect(persistedRecentFiles).toEqual([]);
    expect(persistedLibrary.encryptedFolders).toEqual({});
  });

  it("batch deletes unlocked protected documents and removes the empty encrypted folder state", async () => {
    const encrypted = await createEncryptedLibraryState();

    render(<RecentLibraryPanelStorageHost initialRecentFiles={encrypted.recentFiles} />);
    await unlockEncryptedFolder(password);

    fireEvent.click(screen.getByLabelText("Select spec.pdf"));
    fireEvent.click(within(screen.getByLabelText("Batch operations")).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("spec.pdf")).toBeNull();
    });

    const persistedLibrary = JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata;
    const persistedRecentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];
    expect(persistedRecentFiles).toEqual([]);
    expect(persistedLibrary.documents[recentFile.path]).toBeUndefined();
    expect(persistedLibrary.encryptedFolders).toEqual({});
  });

});

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

async function createEncryptedLibraryState(): Promise<{
  library: RecentLibraryMetadata;
  recentFiles: RecentFile[];
}> {
  const encrypted = await recentLibraryEncryption.enableCategoryEncryption({
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

async function unlockEncryptedFolder(password: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Locked document details" }));
  fireEvent.change(screen.getByLabelText("Folder password"), {
    target: { value: password }
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock folder" }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "spec.pdf details" })).toBeInTheDocument();
  });
}

async function unlockPersistedLibrary(): Promise<{
  library: RecentLibraryMetadata;
  recentFiles: RecentFile[];
  protectedPaths: string[];
}> {
  const recentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];
  const protectedCategoryId = recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0];

  return recentLibraryEncryption.unlockCategoryEncryption({
    library: JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata,
    categoryId: protectedCategoryId,
    password: "correct horse battery staple",
    recentFiles
  });
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

function createCacheWithRecent(file: RecentFile) {
  return createSmartReaderCacheEnvelope({
    settings: preferences,
    recentFiles: [file],
    readingProgress: [{
      documentId: file.path,
      title: file.title,
      path: file.path,
      format: file.format,
      location: file.location,
      updatedAt: file.lastOpenedAt
    }],
    session: {
      activeTabId: "doc-2",
      sidebarOpen: true,
      tabs: [createPersistedSession({ id: "doc-2", path: file.path, title: file.title })]
    },
    adapterCache: {
      searchIndexes: [{
        documentId: file.path,
        path: file.path,
        format: file.format,
        adapter: "wasm",
        version: "v1",
        updatedAt: file.lastOpenedAt
      }]
    }
  });
}

const preferences: Preferences = {
  reopenLastSession: true,
  rememberPosition: true,
  defaultSidebarVisible: true,
  defaultPdfFitMode: "continuous",
  epubFontSize: 18,
  epubTheme: "system",
  recentRetention: 12,
  cacheLocation: { mode: "default" },
  search: { resultLimit: "unlimited", includePdf: true, includeEpub: true },
  shortcuts: [],
  wasm: { enabled: true },
  pdfKit: { enabled: false }
};

function createPersistedSession(overrides: { id?: string; path?: string; title?: string } = {}): PersistedDocumentSession {
  const path = overrides.path ?? recentFile.path;
  const title = overrides.title ?? recentFile.title;

  return {
    id: overrides.id ?? "doc-1",
    title,
    filePath: path,
    fileSource: { kind: "desktop-path", path },
    format: "pdf",
    status: "ready",
    location: { kind: "page", page: 7 },
    lastLocation: { kind: "page", page: 7 },
    zoom: 1,
    fitMode: "continuous",
    sidebarMode: "annotations",
    bookmarks: [],
    annotations: [],
    pageCount: 10,
    epubSettings: { fontSize: 18, theme: "system" },
    openedAt: 1,
    updatedAt: 1
  };
}

function createSnapshot(session: PersistedDocumentSession): AppSessionSnapshot {
  return {
    version: 1,
    activeTabId: session.id,
    sidebarOpen: true,
    preferences,
    sessions: [session]
  };
}

function hasCategoryCycle(categories: RecentLibraryCategory[]): boolean {
  const byId = new Map(categories.map((category) => [category.id, category]));

  return categories.some((category) => {
    const seen = new Set<string>();
    let current: RecentLibraryCategory | undefined = category;

    while (current?.parentId) {
      if (seen.has(current.id) || current.parentId === current.id) {
        return true;
      }

      seen.add(current.id);
      current = byId.get(current.parentId);
    }

    return false;
  });
}
