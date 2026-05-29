import { describe, expect, it } from "vitest";
import {
  enableCategoryEncryption,
  isLockedRecentFile,
  resealCategoryEncryption,
  unlockCategoryEncryption
} from "./recentLibraryEncryption";
import { appSessionKey } from "./sessionPersistence";
import { createSmartReaderCacheEnvelope, smartReaderCacheKey } from "./smartReaderCache";
import { saveRecentFiles } from "./recentFiles";
import { saveRecentLibraryMetadata } from "./recentLibrary";
import type { RecentLibraryMetadata } from "./recentLibrary";
import type {
  AppSessionSnapshot,
  PersistedDocumentSession,
  Preferences,
  RecentFile
} from "../types/reader";

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

const documentPath = "/Users/mario/Books/spec.pdf";

describe("recent library folder encryption", () => {
  it("encrypts managed recent, session, cache, and metadata fields for a protected category", async () => {
    const recentFile = createRecentFile();
    const library = createLibrary();
    localStorage.setItem(appSessionKey, JSON.stringify(createSnapshot(createPersistedSession())));
    localStorage.setItem(
      smartReaderCacheKey,
      JSON.stringify(createSmartReaderCacheEnvelope({
        settings: preferences,
        recentFiles: [recentFile],
        readingProgress: [{
          documentId: documentPath,
          title: "spec.pdf",
          path: documentPath,
          format: "pdf",
          location: { kind: "page", page: 7 },
          updatedAt: 1
        }],
        session: {
          activeTabId: "doc-1",
          sidebarOpen: true,
          tabs: [createPersistedSession()]
        },
        adapterCache: {
          searchIndexes: [{
            documentId: documentPath,
            path: documentPath,
            format: "pdf",
            adapter: "wasm",
            version: "v1",
            updatedAt: 1
          }]
        }
      }))
    );

    const encrypted = await enableCategoryEncryption({
      library,
      categoryId: "category-methods",
      password: "correct horse battery staple",
      recentFiles: [recentFile],
      storage: localStorage
    });

    saveRecentLibraryMetadata(encrypted.library);
    localStorage.setItem("smartreader.recentFiles.v1", JSON.stringify(encrypted.recentFiles));

    const persisted = [
      localStorage.getItem("smartreader.recentLibrary.v1"),
      localStorage.getItem("smartreader.recentFiles.v1"),
      localStorage.getItem(appSessionKey),
      localStorage.getItem(smartReaderCacheKey)
    ].join("\n");

    expect(encrypted.recentFiles).toHaveLength(1);
    expect(isLockedRecentFile(encrypted.recentFiles[0])).toBe(true);
    expect(persisted).not.toContain(documentPath);
    expect(persisted).not.toContain("spec.pdf");
    expect(persisted).not.toContain("Secret Methods");
    expect(persisted).not.toContain("Reviewer Eyes Only");
    expect(persisted).not.toContain("Page 7");
    expect(persisted).not.toContain("\"page\":7");
    expect(persisted).not.toContain("secret highlighted quote");
    expect(persisted).not.toContain("Recovered note");

    const protectedCategoryId = encrypted.recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0];

    await expect(unlockCategoryEncryption({
      library: encrypted.library,
      categoryId: protectedCategoryId,
      password: "wrong password",
      recentFiles: encrypted.recentFiles
    })).rejects.toThrow("Folder password is incorrect.");

    const unlocked = await unlockCategoryEncryption({
      library: encrypted.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });

    expect(unlocked.recentFiles[0]).toMatchObject({
      title: "spec.pdf",
      path: documentPath,
      resumeLabel: "Page 7"
    });
    expect(unlocked.library.documents[documentPath]).toMatchObject({
      categoryIds: ["category-methods"],
      tagIds: ["tag-private-reviewer"],
      pinned: true,
      favorite: true
    });
    expect(unlocked.library.categories.find((category) => category.id === "category-methods")?.name).toBe("Secret Methods");
    expect(unlocked.library.tags.find((tag) => tag.id === "tag-private-reviewer")?.name).toBe("Reviewer Eyes Only");

    const resealed = await resealCategoryEncryption({
      library: {
        ...unlocked.library,
        documents: {
          ...unlocked.library.documents,
          [documentPath]: {
            ...unlocked.library.documents[documentPath],
            tagIds: ["tag-private-reviewer", "tag-to-read"],
            favorite: false
          }
        }
      },
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: unlocked.recentFiles
    });
    const unlockedAgain = await unlockCategoryEncryption({
      library: resealed.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });

    expect(unlockedAgain.library.documents[documentPath]).toMatchObject({
      tagIds: ["tag-private-reviewer", "tag-to-read"],
      favorite: false
    });
  });

  it("persists protected folder handles without recoverable category or private tag slugs", async () => {
    const recentFile = createRecentFile();
    const semanticCategoryId = "category-secret-methods";
    const semanticTagId = "tag-private-reviewer-eyes-only";
    const library: RecentLibraryMetadata = {
      categories: [{ id: semanticCategoryId, name: "Secret Methods" }],
      tags: [{ id: semanticTagId, name: "Reviewer Eyes Only", color: "#9e432e", group: "Private" }],
      documents: {
        [documentPath]: {
          categoryIds: [semanticCategoryId],
          tagIds: [semanticTagId],
          pinned: false,
          favorite: false
        }
      }
    };

    const encrypted = await enableCategoryEncryption({
      library,
      categoryId: semanticCategoryId,
      password: "correct horse battery staple",
      recentFiles: [recentFile],
      storage: localStorage
    });

    saveRecentLibraryMetadata(encrypted.library);
    localStorage.setItem("smartreader.recentFiles.v1", JSON.stringify(encrypted.recentFiles));

    const persisted = [
      localStorage.getItem("smartreader.recentLibrary.v1"),
      localStorage.getItem("smartreader.recentFiles.v1")
    ].join("\n");

    expect(persisted).not.toContain("Secret Methods");
    expect(persisted).not.toContain("secret-methods");
    expect(persisted).not.toContain(semanticCategoryId);
    expect(persisted).not.toContain("Reviewer Eyes Only");
    expect(persisted).not.toContain("reviewer-eyes-only");
    expect(persisted).not.toContain(semanticTagId);

    const protectedCategoryId = encrypted.recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0];
    const unlocked = await unlockCategoryEncryption({
      library: encrypted.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });

    expect(unlocked.library.documents[documentPath]).toMatchObject({
      categoryIds: [semanticCategoryId],
      tagIds: [semanticTagId]
    });
    expect(unlocked.library.categories.find((category) => category.id === semanticCategoryId)?.name).toBe("Secret Methods");
    expect(unlocked.library.tags.find((tag) => tag.id === semanticTagId)?.name).toBe("Reviewer Eyes Only");
  });

  it("reseals newly classified documents without leaking their title or path in storage", async () => {
    const recentFile = createRecentFile();
    const newRecentFile = createRecentFile({
      path: "/Users/mario/Books/new-classified.pdf",
      title: "new-classified.pdf",
      lastOpenedAt: 2
    });
    const encrypted = await enableCategoryEncryption({
      library: createLibrary(),
      categoryId: "category-methods",
      password: "correct horse battery staple",
      recentFiles: [recentFile],
      storage: localStorage
    });
    const protectedCategoryId = encrypted.recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0];
    const unlocked = await unlockCategoryEncryption({
      library: encrypted.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });
    localStorage.setItem(appSessionKey, JSON.stringify(createSnapshot(createPersistedSession({
      id: "doc-2",
      path: newRecentFile.path,
      title: newRecentFile.title
    }))));
    localStorage.setItem(
      smartReaderCacheKey,
      JSON.stringify(createSmartReaderCacheEnvelope({
        settings: preferences,
        recentFiles: [newRecentFile],
        readingProgress: [{
          documentId: newRecentFile.path,
          title: newRecentFile.title,
          path: newRecentFile.path,
          format: "pdf",
          location: { kind: "page", page: 2 },
          updatedAt: 2
        }],
        session: {
          activeTabId: "doc-2",
          sidebarOpen: true,
          tabs: [createPersistedSession({
            id: "doc-2",
            path: newRecentFile.path,
            title: newRecentFile.title
          })]
        },
        adapterCache: {
          searchIndexes: [{
            documentId: newRecentFile.path,
            path: newRecentFile.path,
            format: "pdf",
            adapter: "wasm",
            version: "v1",
            updatedAt: 2
          }]
        }
      }))
    );

    const resealed = await resealCategoryEncryption({
      library: {
        ...unlocked.library,
        documents: {
          ...unlocked.library.documents,
          [newRecentFile.path]: {
            categoryIds: ["category-methods"],
            tagIds: [],
            pinned: false,
            favorite: false
          }
        }
      },
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: [...unlocked.recentFiles, newRecentFile],
      storage: localStorage
    });

    saveRecentLibraryMetadata(resealed.library);
    saveRecentFiles(resealed.recentFiles);

    const persisted = [
      localStorage.getItem("smartreader.recentLibrary.v1"),
      localStorage.getItem("smartreader.recentFiles.v1"),
      localStorage.getItem(appSessionKey),
      localStorage.getItem(smartReaderCacheKey)
    ].join("\n");

    expect(persisted).not.toContain(newRecentFile.path);
    expect(persisted).not.toContain(newRecentFile.title);

    const storedRecentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];
    expect(storedRecentFiles).toHaveLength(2);
    expect(storedRecentFiles.every(isLockedRecentFile)).toBe(true);

    const unlockedAgain = await unlockCategoryEncryption({
      library: resealed.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: storedRecentFiles
    });

    expect(unlockedAgain.recentFiles.find((file) => file.path === newRecentFile.path)).toMatchObject({
      title: newRecentFile.title,
      protection: {
        encryptedCategoryId: protectedCategoryId
      }
    });
    expect(unlockedAgain.library.documents[newRecentFile.path]).toMatchObject({
      categoryIds: ["category-methods"]
    });
  });

  it("reseals child categories created under an unlocked encrypted category", async () => {
    const recentFile = createRecentFile();
    const encrypted = await enableCategoryEncryption({
      library: createLibrary(),
      categoryId: "category-methods",
      password: "correct horse battery staple",
      recentFiles: [recentFile],
      storage: localStorage
    });
    const protectedCategoryId = encrypted.recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0];
    const unlocked = await unlockCategoryEncryption({
      library: encrypted.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });

    const resealed = await resealCategoryEncryption({
      library: {
        ...unlocked.library,
        categories: [
          ...unlocked.library.categories,
          { id: "category-hidden-child", name: "Hidden Child", parentId: "category-methods" }
        ]
      },
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: unlocked.recentFiles,
      storage: localStorage
    });

    saveRecentLibraryMetadata(resealed.library);

    const persisted = localStorage.getItem("smartreader.recentLibrary.v1") ?? "";
    expect(persisted).not.toContain("category-hidden-child");
    expect(persisted).not.toContain("Hidden Child");

    const unlockedAgain = await unlockCategoryEncryption({
      library: resealed.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });

    expect(unlockedAgain.library.categories.find((category) => category.id === "category-hidden-child")).toMatchObject({
      name: "Hidden Child",
      parentId: "category-methods"
    });
  });

  it("unprotects the last moved-out document and removes the empty encrypted folder state", async () => {
    const recentFile = createRecentFile();
    const encrypted = await enableCategoryEncryption({
      library: createLibrary(),
      categoryId: "category-methods",
      password: "correct horse battery staple",
      recentFiles: [recentFile],
      storage: localStorage
    });
    const protectedCategoryId = encrypted.recentFiles[0].path.replace("smartreader-locked://", "").split("/")[0];
    const unlocked = await unlockCategoryEncryption({
      library: encrypted.library,
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: encrypted.recentFiles
    });

    const resealed = await resealCategoryEncryption({
      library: {
        ...unlocked.library,
        documents: {
          ...unlocked.library.documents,
          [documentPath]: {
            ...unlocked.library.documents[documentPath],
            categoryIds: []
          }
        }
      },
      categoryId: protectedCategoryId,
      password: "correct horse battery staple",
      recentFiles: unlocked.recentFiles,
      storage: localStorage
    });

    saveRecentLibraryMetadata(resealed.library);
    saveRecentFiles(resealed.recentFiles);

    expect(resealed.library.encryptedFolders?.[protectedCategoryId]).toBeUndefined();
    expect(resealed.recentFiles).toHaveLength(1);
    expect(resealed.recentFiles[0]).toMatchObject({
      title: "spec.pdf",
      path: documentPath
    });
    expect(resealed.recentFiles[0].protection).toBeUndefined();
    expect(isLockedRecentFile(resealed.recentFiles[0])).toBe(false);

    const persistedLibrary = JSON.parse(localStorage.getItem("smartreader.recentLibrary.v1") ?? "{}") as RecentLibraryMetadata;
    const persistedRecentFiles = JSON.parse(localStorage.getItem("smartreader.recentFiles.v1") ?? "[]") as RecentFile[];
    expect(persistedLibrary.encryptedFolders?.[protectedCategoryId]).toBeUndefined();
    expect(persistedLibrary.documents[documentPath]).toMatchObject({ categoryIds: [] });
    expect(persistedRecentFiles[0].path).toBe(documentPath);
    expect(persistedRecentFiles[0].protection).toBeUndefined();
  });
});

function createRecentFile(overrides: Partial<RecentFile> = {}): RecentFile {
  return {
    id: overrides.id ?? overrides.path ?? documentPath,
    title: "spec.pdf",
    path: documentPath,
    parentPath: "/Users/mario/Books",
    format: "pdf",
    access: "desktop-path",
    lastOpenedAt: 1,
    resumeLabel: "Page 7",
    location: { kind: "page", page: 7 },
    ...overrides
  };
}

function createLibrary(): RecentLibraryMetadata {
  return {
    categories: [{ id: "category-methods", name: "Secret Methods" }],
    tags: [{ id: "tag-private-reviewer", name: "Reviewer Eyes Only", color: "#9e432e", group: "Private" }],
    documents: {
      [documentPath]: {
        categoryIds: ["category-methods"],
        tagIds: ["tag-private-reviewer"],
        pinned: true,
        favorite: true
      }
    }
  };
}

function createPersistedSession(overrides: { id?: string; path?: string; title?: string } = {}): PersistedDocumentSession {
  const path = overrides.path ?? documentPath;
  const title = overrides.title ?? "spec.pdf";

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
    bookmarks: [{ id: "bookmark-1", title: "Page 7", location: { kind: "page", page: 7 }, createdAt: 1 }],
    annotations: [{
      id: "annotation-1",
      type: "highlight",
      tag: "重点",
      color: "#ffe28a",
      thickness: 2,
      location: { kind: "page", page: 7 },
      selectedText: "secret highlighted quote",
      note: "Recovered note",
      createdAt: 1,
      updatedAt: 1
    }],
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
