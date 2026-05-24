import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  AppSessionSnapshot,
  DocumentSession,
  EpubResourceMetadata,
  SmartReaderCacheEnvelope
} from "./types/reader";
import type { SearchWorkerDocument } from "./lib/wasmAdapter";

const pdfMocks = vi.hoisted(() => {
  const outlineItems = [
    { title: "Intro", dest: [{ num: 1, gen: 0 }], items: [] },
    { title: "Later chapter", dest: [{ num: 2, gen: 0 }], items: [] }
  ];
  const getPageIndex = vi.fn(async (ref: { num: number }) => Math.max(0, ref.num - 1));
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getOutline: vi.fn(async () => outlineItems),
      getDestination: vi.fn(async () => null),
      getPageIndex,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 640, height: 900 }),
        getTextContent: vi.fn(async () => ({ items: [] })),
        render: vi.fn(() => ({ promise: Promise.resolve() }))
      })),
      destroy: vi.fn()
    })
  }));

  return { getDocument, getPageIndex, outlineItems };
});

const tauriMocks = vi.hoisted(() => {
  let desktopOpenHandler: ((path: string) => void) | undefined;
  let sessionIndex = 0;
  let pendingPaths = ["/Users/mario/Books/start.pdf"];
  let desktopRuntime = true;

  const createDesktopSession = vi.fn(async (path: string): Promise<DocumentSession> => {
    sessionIndex += 1;
    const format = path.toLowerCase().endsWith(".epub") ? "epub" : "pdf";
    const location = format === "epub" ? { kind: "epub" as const, progress: 0 } : { kind: "page" as const, page: 1 };

    return {
      id: `desktop-${sessionIndex}`,
      title: path.split("/").pop() ?? path,
      filePath: path,
      fileSource: { kind: "desktop-path", path },
      format,
      status: "ready",
      location,
      lastLocation: location,
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
    pendingPaths.forEach(openPath);
  });
  const openEpubDocument = vi.fn(async () => ({
    id: "/Users/mario/Books/story.epub",
    title: "Story",
    chapters: [
      { id: "chapter-1", href: "OPS/chapter-1.xhtml", label: "Chapter One", index: 0 },
      { id: "chapter-2", href: "OPS/chapter-2.xhtml", label: "Chapter Two", index: 1 }
    ],
    outline: [
      { id: "chapter-1", title: "Chapter One", href: "OPS/chapter-1.xhtml", index: 0, level: 0 },
      { id: "chapter-2", title: "Chapter Two", href: "OPS/chapter-2.xhtml", index: 1, level: 0 }
    ]
  }));
  const readEpubChapter = vi.fn(async () => ({
    id: "chapter-1",
    href: "OPS/chapter-1.xhtml",
    label: "Chapter One",
    index: 0,
    sanitizedHtml: "<p>Native chapter body</p>",
    text: "Native chapter body",
    resources: [] as EpubResourceMetadata[]
  }));
  const searchEpubDocument = vi.fn(async () => [
    {
      id: "search-chapter-2-4",
      label: "Chapter Two",
      snippet: "Hidden native result",
      href: "OPS/chapter-2.xhtml",
      index: 1,
      progress: 1
    }
  ]);
  const openPdfDocument = vi.fn(async () => ({
    id: "/Users/mario/Books/start.pdf",
    pageCount: 2,
    outline: [
      { id: "outline-1", title: "Intro", page: 1, level: 0 },
      { id: "outline-2", title: "Later chapter", page: 2, level: 0 }
    ]
  }));
  const searchPdfDocument = vi.fn(async () => [
    {
      id: "pdf-search-2-4",
      label: "Page 2",
      snippet: "Native PDF result",
      page: 2
    }
  ]);
  const renderPdfPageImage = vi.fn(async () => ({
    page: 1,
    width: 640,
    height: 900,
    scale: 1,
    dataUrl: "data:image/png;base64,pdfkit",
    renderer: "pdfkit"
  }));
  const getSmartReaderCacheInfo = vi.fn(async () => ({
    defaultPath: "/Users/mario/Library/Application Support/SmartReader/cache",
    activePath: "/Users/mario/Library/Application Support/SmartReader/cache",
    isCustom: false,
    schemaVersion: 1
  }));
  const saveSmartReaderCache = vi.fn(async () => undefined);
  const setSmartReaderCacheLocation = vi.fn(async () => ({
    activePath: "/Users/mario/Library/Application Support/SmartReader/cache",
    moved: false
  }));
  const exportSmartReaderCacheFile = vi.fn(async () => ({
    path: "/Users/mario/Downloads/smartreader-cache.json",
    bytesWritten: 120,
    exportedAt: 1
  }));
  const importSmartReaderCacheFile = vi.fn(async () => {
    throw new Error("not staged");
  });
  const readFileSource = vi.fn(async () => new ArrayBuffer(8));

  return {
    createDesktopSession,
    exportSmartReaderCacheFile,
    getSmartReaderCacheInfo,
    importSmartReaderCacheFile,
    isDesktopRuntime: () => desktopRuntime,
    openEpubDocument,
    openPdfDocument,
    openCacheDirectoryDialog: vi.fn(async () => undefined),
    openCacheExportDialog: vi.fn(async () => undefined),
    openCacheImportDialog: vi.fn(async () => undefined),
    openPendingDesktopFiles,
    listenForDesktopOpenFiles: vi.fn(async (openPath: (path: string) => void) => {
      desktopOpenHandler = openPath;
      return vi.fn();
    }),
    setupTauriMenu: vi.fn(async () => undefined),
    openDesktopFileDialog: vi.fn(async () => undefined),
    readEpubChapter,
    readFileSource,
    renderPdfPageImage,
    saveSmartReaderCache,
    searchEpubDocument,
    searchPdfDocument,
    setSmartReaderCacheLocation,
    emitDesktopOpen: (path: string) => desktopOpenHandler?.(path),
    reset: () => {
      desktopOpenHandler = undefined;
      sessionIndex = 0;
      pendingPaths = ["/Users/mario/Books/start.pdf"];
      desktopRuntime = true;
      createDesktopSession.mockClear();
      exportSmartReaderCacheFile.mockClear();
      getSmartReaderCacheInfo.mockClear();
      importSmartReaderCacheFile.mockClear();
      openEpubDocument.mockClear();
      openPdfDocument.mockClear();
      openPendingDesktopFiles.mockClear();
      readEpubChapter.mockClear();
      readFileSource.mockClear();
      renderPdfPageImage.mockClear();
      saveSmartReaderCache.mockClear();
      searchEpubDocument.mockClear();
      searchPdfDocument.mockClear();
      setSmartReaderCacheLocation.mockClear();
    },
    setDesktopRuntime: (enabled: boolean) => {
      desktopRuntime = enabled;
    },
    setPendingPaths: (paths: string[]) => {
      pendingPaths = paths;
    },
    setCacheImportResult: (cache: unknown) => {
      (importSmartReaderCacheFile as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
        cache,
        importedAt: 1,
        applied: false
      });
    }
  };
});

vi.mock("./platform/fileSources", async () => ({
  ...(await vi.importActual<typeof import("./platform/fileSources")>("./platform/fileSources")),
  isTauriRuntime: () => tauriMocks.isDesktopRuntime()
}));

vi.mock("./platform/tauriBridge", () => ({
  createDesktopSession: tauriMocks.createDesktopSession,
  exportSmartReaderCacheFile: tauriMocks.exportSmartReaderCacheFile,
  getSmartReaderCacheInfo: tauriMocks.getSmartReaderCacheInfo,
  importSmartReaderCacheFile: tauriMocks.importSmartReaderCacheFile,
  listenForDesktopOpenFiles: tauriMocks.listenForDesktopOpenFiles,
  openCacheDirectoryDialog: tauriMocks.openCacheDirectoryDialog,
  openCacheExportDialog: tauriMocks.openCacheExportDialog,
  openCacheImportDialog: tauriMocks.openCacheImportDialog,
  openEpubDocument: tauriMocks.openEpubDocument,
  openPdfDocument: tauriMocks.openPdfDocument,
  openDesktopFileDialog: tauriMocks.openDesktopFileDialog,
  openPendingDesktopFiles: tauriMocks.openPendingDesktopFiles,
  readEpubChapter: tauriMocks.readEpubChapter,
  readFileSource: tauriMocks.readFileSource,
  renderPdfPageImage: tauriMocks.renderPdfPageImage,
  saveSmartReaderCache: tauriMocks.saveSmartReaderCache,
  searchEpubDocument: tauriMocks.searchEpubDocument,
  searchPdfDocument: tauriMocks.searchPdfDocument,
  setSmartReaderCacheLocation: tauriMocks.setSmartReaderCacheLocation,
  setupTauriMenu: tauriMocks.setupTauriMenu
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfMocks.getDocument
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "/pdf.worker.mjs"
}));

describe("App desktop open delivery", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    tauriMocks.reset();
    pdfMocks.getDocument.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn()
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn()
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:smartreader-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: createSearchWorkerMock()
    });
  });

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

  it("keeps a loaded desktop PDF cached when switching back to an already-open tab", async () => {
    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.readFileSource).toHaveBeenCalledWith({
        kind: "desktop-path",
        path: "/Users/mario/Books/start.pdf"
      });
    });

    await act(async () => {
      tauriMocks.emitDesktopOpen("/Users/mario/Books/second.pdf");
    });

    await waitFor(() => {
      expect(tauriMocks.readFileSource).toHaveBeenCalledWith({
        kind: "desktop-path",
        path: "/Users/mario/Books/second.pdf"
      });
    });

    fireEvent.click(screen.getByText("start.pdf"));

    await waitFor(() => {
      expect(screen.queryByText("Opening start.pdf")).not.toBeInTheDocument();
    });
    const readFileSourceCalls = tauriMocks.readFileSource.mock.calls as unknown as [{ path?: string }][];
    expect(
      readFileSourceCalls.filter(([source]) => source.path === "/Users/mario/Books/start.pdf")
    ).toHaveLength(1);
  });

  it("loads desktop PDF metadata through Tauri for contents navigation", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    expect(await screen.findByText("Intro")).toBeInTheDocument();
    expect(screen.getByText("Later chapter")).toBeInTheDocument();
    expect(tauriMocks.openPdfDocument).toHaveBeenCalledWith("/Users/mario/Books/start.pdf");
  });

  it("scrolls to a clicked PDF outline page after the location changes", async () => {
    tauriMocks.setPendingPaths([]);
    tauriMocks.setDesktopRuntime(false);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["%PDF-1.7"], "local.pdf", { type: "application/pdf" })]
      }
    });

    await screen.findByText("Intro");
    fireEvent.click(screen.getByText("Later chapter"));
    await waitFor(() => {
      expect(screen.getByLabelText("Page or location")).toHaveValue("2");
    });

    (HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByText("Intro"));

    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("searches desktop PDF content through Rust", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await screen.findByText("Intro");
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "native" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    await waitFor(() => {
      expect(tauriMocks.searchPdfDocument).toHaveBeenCalledWith("/Users/mario/Books/start.pdf", "native");
    });
    expect(await screen.findByText("Native PDF result")).toBeInTheDocument();
  });

  it("uses experimental PDFKit rendering for desktop PDFs and falls back to PDF.js when rasterization fails", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    tauriMocks.renderPdfPageImage.mockRejectedValueOnce(new Error("pdfkit failed"));

    render(<App />);

    await screen.findByText("Intro");
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByLabelText("Enable experimental PDFKit renderer"));

    await waitFor(() => {
      expect(tauriMocks.renderPdfPageImage).toHaveBeenCalledWith("/Users/mario/Books/start.pdf", 1, expect.any(Number));
    });
    expect(await screen.findByText("PDFKit unavailable; using PDF.js.")).toBeInTheDocument();
    expect(pdfMocks.getDocument).toHaveBeenCalled();
  });

  it("hydrates the last desktop session on startup", async () => {
    tauriMocks.setPendingPaths([]);
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(createSnapshot("pdf-1", 9)));

    render(<App />);

    expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Page or location")).toHaveValue("9");
  });

  it("keeps each tab reading progress while switching open documents", async () => {
    tauriMocks.setPendingPaths([]);
    localStorage.setItem(
      "smartreader.appSession.v1",
      JSON.stringify({
        ...createSnapshot("pdf-1", 9),
        sessions: [
          createSnapshotSession("pdf-1", "/Users/mario/Books/spec.pdf", 9),
          createSnapshotSession("pdf-2", "/Users/mario/Books/guide.pdf", 33)
        ]
      })
    );

    render(<App />);

    await screen.findByText("spec.pdf");
    expect(screen.getByText("Page 9")).toBeInTheDocument();
    expect(screen.getByLabelText("Page or location")).toHaveValue("9");

    await act(async () => {
      screen.getByText("guide.pdf").click();
    });
    expect(screen.getByText("Page 33")).toBeInTheDocument();
    expect(screen.getByLabelText("Page or location")).toHaveValue("33");

    await act(async () => {
      screen.getByText("spec.pdf").click();
    });
    expect(screen.getByLabelText("Page or location")).toHaveValue("9");
  });

  it("loads desktop EPUB metadata and the active chapter through Tauri without full-book byte parsing", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Native chapter body")).toBeInTheDocument();
    });
    expect(tauriMocks.openEpubDocument).toHaveBeenCalledWith("/Users/mario/Books/story.epub");
    expect(tauriMocks.readEpubChapter).toHaveBeenCalledWith("/Users/mario/Books/story.epub", "OPS/chapter-1.xhtml");
    expect(tauriMocks.readFileSource).not.toHaveBeenCalledWith({
      kind: "desktop-path",
      path: "/Users/mario/Books/story.epub"
    });
    expect(screen.getAllByText("Chapter One").length).toBeGreaterThan(0);
  });

  it("ignores a late desktop EPUB chapter response after the tab is closed", async () => {
    let resolveChapter: (value: Awaited<ReturnType<typeof tauriMocks.readEpubChapter>>) => void = () => undefined;
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.readEpubChapter.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveChapter = resolve;
        })
    );

    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.readEpubChapter).toHaveBeenCalledWith("/Users/mario/Books/story.epub", "OPS/chapter-1.xhtml");
    });

    fireEvent.click(screen.getByLabelText("Close story.epub"));

    await act(async () => {
      resolveChapter({
        id: "chapter-1",
        href: "OPS/chapter-1.xhtml",
        label: "Chapter One",
        index: 0,
        sanitizedHtml: "<p>Late chapter body</p>",
        text: "Late chapter body",
        resources: [] as EpubResourceMetadata[]
      });
    });

    expect(screen.queryByText("Late chapter body")).not.toBeInTheDocument();
  });

  it("revokes browser object URLs when a browser-file tab is closed", async () => {
    tauriMocks.setDesktopRuntime(false);
    tauriMocks.setPendingPaths([]);

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["%PDF-1.7"], "local.pdf", { type: "application/pdf" })]
      }
    });

    await screen.findByText("local.pdf");
    fireEvent.click(screen.getByLabelText("Close local.pdf"));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:smartreader-test");
  });

  it("updates browser EPUB chapter content when moving to the next chapter", async () => {
    tauriMocks.setDesktopRuntime(false);
    tauriMocks.setPendingPaths([]);
    tauriMocks.readFileSource.mockResolvedValueOnce(await createBrowserEpubFixture());

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["epub"], "browser.epub", { type: "application/epub+zip" })]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("Browser chapter one body")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByText("Browser chapter two body")).toBeInTheDocument();
    });
    expect(screen.queryByText("Browser chapter one body")).not.toBeInTheDocument();
  });

  it("reports a ready WASM worker adapter and searches browser EPUB payloads through it", async () => {
    tauriMocks.setDesktopRuntime(false);
    tauriMocks.setPendingPaths([]);
    tauriMocks.readFileSource.mockResolvedValueOnce(await createBrowserEpubFixture());

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["epub"], "browser.epub", { type: "application/epub+zip" })]
      }
    });

    await screen.findByText("Browser chapter one body");
    fireEvent.click(screen.getByLabelText("More"));
    expect(await screen.findByText("WASM worker search is ready.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "chapter two" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    expect(await screen.findByText("WASM: Browser chapter two body")).toBeInTheDocument();
  });

  it("shows WASM fallback status when worker wasm init fails", async () => {
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: createSearchWorkerMock({ failInit: true })
    });
    tauriMocks.setDesktopRuntime(false);
    tauriMocks.setPendingPaths([]);
    tauriMocks.readFileSource.mockResolvedValueOnce(await createBrowserEpubFixture());

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["epub"], "browser.epub", { type: "application/epub+zip" })]
      }
    });

    await screen.findByText("Browser chapter one body");
    fireEvent.click(screen.getByLabelText("More"));
    expect(await screen.findByText("WASM worker failed: wasm init failed. Fallback adapters stay active.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "chapter two" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    expect(await screen.findByText("Browser chapter two body")).toBeInTheDocument();
    expect(screen.queryByText("WASM: Browser chapter two body")).not.toBeInTheDocument();
  });

  it("searches desktop EPUB content through Rust for unvisited chapters", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Native chapter body")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "hidden" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    await waitFor(() => {
      expect(tauriMocks.searchEpubDocument).toHaveBeenCalledWith("/Users/mario/Books/story.epub", "hidden");
    });

    expect(await screen.findByText("Hidden native result")).toBeInTheDocument();
  });

  it("shows encrypted EPUB errors without attempting a DRM bypass", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/locked.epub"]);
    tauriMocks.openEpubDocument.mockRejectedValueOnce(new Error("encrypted EPUB package"));

    render(<App />);

    expect(await screen.findByText("Encrypted EPUB")).toBeInTheDocument();
    expect(screen.getByText("SmartReader cannot open DRM-protected EPUB files.")).toBeInTheDocument();
    expect(tauriMocks.readEpubChapter).not.toHaveBeenCalled();
  });

  it("shows sanitized EPUB resource metadata without exposing rewritten URLs", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>Native chapter body</p>",
      text: "Native chapter body",
      resources: [
        {
          id: "image-1",
          href: "OPS/images/cover.png",
          mediaType: "image/png",
          rewrittenUrl: "asset://localhost/cover.png"
        },
        {
          id: "remote",
          href: "https://evil.example/track.png",
          mediaType: "image/png",
          rewrittenUrl: "https://evil.example/track.png"
        }
      ]
    });

    render(<App />);

    expect(await screen.findByText("1 resource available")).toBeInTheDocument();
    expect(screen.queryByText("asset://localhost/cover.png")).not.toBeInTheDocument();
    expect(screen.queryByText("https://evil.example/track.png")).not.toBeInTheDocument();
  });

  it("does not persist an invalid imported cache before apply succeeds", async () => {
    (tauriMocks.openCacheImportDialog as unknown as { mockResolvedValue: (value: string) => void }).mockResolvedValue(
      "/Users/mario/Downloads/bad-cache.json"
    );
    tauriMocks.setCacheImportResult({
      schemaVersion: 1,
      settings: { recentRetention: "bad" },
      recentFiles: [],
      readingProgress: [],
      session: { activeTabId: "bad", sidebarOpen: true, tabs: [] },
      adapterCache: { searchIndexes: [] }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    tauriMocks.saveSmartReaderCache.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

    expect(await screen.findByText("Cache import is invalid.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply Imported Cache" })).not.toBeInTheDocument();
    expect(
      (tauriMocks.saveSmartReaderCache.mock.calls as unknown as Array<[SmartReaderCacheEnvelope]>).some(
        ([cache]) => cache.session.activeTabId === "bad"
      )
    ).toBe(false);
  });
});

async function createBrowserEpubFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
      </rootfiles>
    </container>`
  );
  zip.file(
    "OPS/content.opf",
    `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>
        <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
        <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml" />
      </manifest>
      <spine>
        <itemref idref="chapter-1" />
        <itemref idref="chapter-2" />
      </spine>
    </package>`
  );
  zip.file("OPS/chapter-1.xhtml", "<html><body><p>Browser chapter one body</p></body></html>");
  zip.file("OPS/chapter-2.xhtml", "<html><body><p>Browser chapter two body</p></body></html>");

  return zip.generateAsync({ type: "arraybuffer" });
}

function createSnapshot(activeTabId: string, page: number): AppSessionSnapshot {
  return {
    version: 1,
    activeTabId,
    sidebarOpen: true,
    preferences: {
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
    },
    sessions: [createSnapshotSession(activeTabId, "/Users/mario/Books/spec.pdf", page)]
  };
}

function createSearchWorkerMock(options: { failInit?: boolean } = {}) {
  return class SearchWorkerMock {
    onmessage: ((event: MessageEvent) => void) | null = null;
    private documents: SearchWorkerDocument[] = [];

    postMessage(message: {
      id: number;
      type: string;
      documents?: SearchWorkerDocument[];
      query?: string;
    }) {
      queueMicrotask(() => {
        if (message.type === "init") {
          if (options.failInit) {
            this.onmessage?.({ data: { id: message.id, type: "error", error: "wasm init failed" } } as MessageEvent);
            return;
          }

          this.documents = message.documents ?? [];
          this.onmessage?.({ data: { id: message.id, type: "ready" } } as MessageEvent);
          return;
        }

        if (message.type === "search") {
          const query = (message.query ?? "").toLowerCase();
          const results = this.documents.flatMap((document) => {
            const found = [];
            const text = document.text.toLowerCase();
            let searchStart = 0;
            let index = text.indexOf(query, searchStart);

            while (index >= 0) {
              found.push({
                id: `wasm-${document.id}-${index}`,
                label: document.label,
                snippet: `WASM: ${document.text}`,
                location: document.location
              });
              searchStart = index + query.length;
              index = text.indexOf(query, searchStart);
            }

            return found;
          });

          this.onmessage?.({ data: { id: message.id, type: "results", results } } as MessageEvent);
        }
      });
    }

    terminate() {
      this.documents = [];
    }
  };
}

function createSnapshotSession(id: string, path: string, page: number): AppSessionSnapshot["sessions"][number] {
  const title = path.split("/").pop() ?? path;

  return {
    id,
    title,
    filePath: path,
    fileSource: { kind: "desktop-path", path },
    format: "pdf",
    status: "ready",
    location: { kind: "page", page },
    lastLocation: { kind: "page", page },
    zoom: 1,
    fitMode: "continuous",
    sidebarMode: "contents",
    bookmarks: [],
    pageCount: 100,
    epubSettings: {
      fontSize: 18,
      theme: "system"
    },
    openedAt: 1,
    updatedAt: 2
  };
}
