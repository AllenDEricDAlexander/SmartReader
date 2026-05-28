import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { validateSmartReaderCacheEnvelope } from "./state/smartReaderCache";
import type {
  AppSessionSnapshot,
  DocumentSession,
  EpubResourceMetadata,
  SmartReaderCacheEnvelope
} from "./types/reader";
import type { SearchWorkerDocument } from "./lib/wasmAdapter";

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
      annotations: [],
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
  const readEpubChapter = vi.fn(async (_path: string, href = "OPS/chapter-1.xhtml") => {
    const chapterNumber = href.includes("chapter-2") ? 2 : 1;

    return {
      id: `chapter-${chapterNumber}`,
      href,
      label: chapterNumber === 2 ? "Chapter Two" : "Chapter One",
      index: chapterNumber - 1,
      sanitizedHtml: "<p>Native chapter body</p>",
      text: "Native chapter body",
      resources: [] as EpubResourceMetadata[]
    };
  });
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
  const syncPdfKitAnnotations = vi.fn(async (request: {
    path: string;
    managedCopyPath?: string;
    annotations: Array<{ id: string; page: number; kind: string; operation: string }>;
  }) => ({
    supported: !request.annotations.some((annotation) => annotation.kind === "wavy" || annotation.kind === "redText"),
    status: request.annotations.some((annotation) => annotation.kind === "wavy" || annotation.kind === "redText")
      ? "unsupported-native-mapping"
      : "synced",
    sourcePath: request.path,
    managedCopyPath: request.managedCopyPath ?? "/tmp/smartreader-pdfkit-managed.pdf",
    annotations: request.annotations.map((annotation) => ({
      id: annotation.id,
      status: annotation.kind === "wavy" || annotation.kind === "redText"
        ? "unsupported-native-mapping"
        : annotation.operation === "delete"
          ? "deleted"
          : "upserted",
      page: annotation.page,
      kind: annotation.kind,
      nativeId: `smartreader:${annotation.id}`,
      reason: annotation.kind === "wavy" || annotation.kind === "redText" ? "unsupported-native-mapping" : undefined
    }))
  }));
  const createEpubAnchor = vi.fn(async () => ({
    chapterHref: "OPS/chapter-1.xhtml",
    selectedText: "Native chapter body",
    occurrenceIndex: 0,
    startOffset: 0,
    endOffset: 19,
    prefix: "",
    suffix: "",
    textHash: "fnv1a64:text",
    anchorHash: "fnv1a64:anchor",
    cfiHint: "epubcfi(/legacy)"
  }));
  const resolveEpubAnchor = vi.fn(async (_path: string, anchor: unknown) => ({
    status: "resolved",
    anchor,
    selectedText: "repeat",
    occurrenceIndex: 1,
    startOffset: 13,
    endOffset: 19
  }));
  const rebindEpubAnchor = vi.fn(async (_path: string, anchor: unknown) => ({
    status: "rebound",
    anchor,
    selectedText: "repeat",
    occurrenceIndex: 1,
    startOffset: 13,
    endOffset: 19
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
    createEpubAnchor,
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
    saveSmartReaderCache,
    searchEpubDocument,
    setSmartReaderCacheLocation,
    rebindEpubAnchor,
    resolveEpubAnchor,
    syncPdfKitAnnotations,
    emitDesktopOpen: (path: string) => desktopOpenHandler?.(path),
    reset: () => {
      desktopOpenHandler = undefined;
      sessionIndex = 0;
      pendingPaths = ["/Users/mario/Books/start.pdf"];
      desktopRuntime = true;
      createDesktopSession.mockClear();
      createEpubAnchor.mockClear();
      exportSmartReaderCacheFile.mockClear();
      getSmartReaderCacheInfo.mockClear();
      importSmartReaderCacheFile.mockClear();
      openEpubDocument.mockClear();
      openPdfDocument.mockClear();
      openPendingDesktopFiles.mockClear();
      readEpubChapter.mockClear();
      readFileSource.mockClear();
      saveSmartReaderCache.mockClear();
      searchEpubDocument.mockClear();
      setSmartReaderCacheLocation.mockClear();
      rebindEpubAnchor.mockClear();
      resolveEpubAnchor.mockClear();
      syncPdfKitAnnotations.mockClear();
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

const embedPdfMocks = vi.hoisted(() => {
  type PageChangeHandler = (event: { documentId: string; pageNumber: number; totalPages: number }) => void;
  type SelectionChangeHandler = (event: { documentId: string; selection: unknown }) => void;
  type EndSelectionHandler = (event: { documentId: string; modeId: string }) => void;
  type SearchResultPayload = {
    pageIndex: number;
    charIndex: number;
    charCount: number;
    context?: {
      before?: string;
      match?: string;
      after?: string;
      truncatedLeft?: boolean;
      truncatedRight?: boolean;
    };
  };

  let pageChangeHandler: PageChangeHandler | undefined;
  let scrollHandler: ((event: { documentId: string }) => void) | undefined;
  let layoutChangeHandler: ((event: { documentId: string }) => void) | undefined;
  let selectionChangeHandler: SelectionChangeHandler | undefined;
  let endSelectionHandler: EndSelectionHandler | undefined;
  let annotationEventHandler: (() => void) | undefined;
  let scrollOffset = { x: 0, y: 0 };
  let searchResults: SearchResultPayload[] = [];
  const scrollToPage = vi.fn();
  const onPageChange = vi.fn((handler: PageChangeHandler) => {
    pageChangeHandler = handler;
    return vi.fn();
  });
  const onScroll = vi.fn((handler: (event: { documentId: string }) => void) => {
    scrollHandler = handler;
    return vi.fn();
  });
  const onLayoutChange = vi.fn((handler: (event: { documentId: string }) => void) => {
    layoutChangeHandler = handler;
    return vi.fn();
  });
  const getMetrics = vi.fn(() => ({
    scrollOffset
  }));
  const getLayout = vi.fn(() => ({
    virtualItems: [
      {
        pageLayouts: [
          { pageNumber: 1, height: 900 },
          { pageNumber: 2, height: 900 }
        ]
      }
    ]
  }));
  const getRectPositionForPage = vi.fn((_page: number, rect: { origin: { x: number; y: number }; size: { width: number; height: number } }) => rect);
  const scrollCapability = {
    forDocument: vi.fn(() => ({
      getMetrics,
      getLayout,
      getRectPositionForPage,
      scrollToPage
    })),
    onPageChange,
    onScroll,
    onLayoutChange,
    scrollToPage
  };
  const documentManagerCapability = {
    getActiveDocumentId: vi.fn(() => "smartreader-test-document")
  };
  const searchAllPages = vi.fn(() => ({
    wait: vi.fn(),
    toPromise: vi.fn(async () => ({ results: searchResults, total: searchResults.length }))
  }));
  const searchCapability = {
    goToResult: vi.fn(),
    nextResult: vi.fn(),
    previousResult: vi.fn(),
    searchAllPages,
    setShowAllResults: vi.fn(),
    startSearch: vi.fn(),
    stopSearch: vi.fn()
  };
  const annotationScope = {
    setActiveTool: vi.fn(),
    exportAnnotations: vi.fn(() => ({
      toPromise: vi.fn(async () => [])
    })),
    importAnnotations: vi.fn(),
    onAnnotationEvent: vi.fn((handler: () => void) => {
      annotationEventHandler = handler;
      return vi.fn();
    })
  };
  const annotationCapability = {
    forDocument: vi.fn(() => annotationScope),
    setToolDefaults: vi.fn()
  };
  const requestZoom = vi.fn();
  const zoomCapability = {
    forDocument: vi.fn(() => ({
      requestZoom
    })),
    requestZoom
  };
  let selectedTextItems = ["Native PDF selection"];
  let formattedSelectionItems = [
    {
      pageIndex: 0,
      rect: { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } },
      segmentRects: [
        { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } }
      ]
    }
  ];
  const selectedText = vi.fn(async () => selectedTextItems);
  const formattedSelection = vi.fn(() => formattedSelectionItems);
  const selectionCapability = {
    getFormattedSelection: formattedSelection,
    getSelectedText: vi.fn(() => ({
      toPromise: selectedText
    })),
    onEndSelection: vi.fn((handler: EndSelectionHandler) => {
      endSelectionHandler = handler;
      return vi.fn();
    }),
    onSelectionChange: vi.fn((handler: SelectionChangeHandler) => {
      selectionChangeHandler = handler;
      return vi.fn();
    })
  };
  const registry = {
    getPlugin: vi.fn((pluginId: string) => {
      if (pluginId === "scroll") {
        return { provides: () => scrollCapability };
      }
      if (pluginId === "document-manager") {
        return { provides: () => documentManagerCapability };
      }
      if (pluginId === "search") {
        return { provides: () => searchCapability };
      }
      if (pluginId === "annotation") {
        return { provides: () => annotationCapability };
      }
      if (pluginId === "selection") {
        return { provides: () => selectionCapability };
      }
      if (pluginId === "zoom") {
        return { provides: () => zoomCapability };
      }
      return null;
    })
  };
  const PDFViewer = vi.fn();

  return {
    PDFViewer,
    documentManagerCapability,
    emitPageChange: (pageNumber: number) => {
      pageChangeHandler?.({
        documentId: "smartreader-test-document",
        pageNumber,
        totalPages: 2
      });
    },
    emitScroll: (offset = scrollOffset) => {
      scrollOffset = offset;
      scrollHandler?.({
        documentId: "smartreader-test-document"
      });
    },
    emitLayoutChange: () => {
      layoutChangeHandler?.({
        documentId: "smartreader-test-document"
      });
    },
    emitSelectionChange: (selection: unknown = {}) => {
      selectionChangeHandler?.({
        documentId: "smartreader-test-document",
        selection
      });
    },
    emitEndSelection: () => {
      endSelectionHandler?.({
        documentId: "smartreader-test-document",
        modeId: "pointerMode"
      });
    },
    emitAnnotationEvent: () => {
      annotationEventHandler?.();
    },
    registry,
    reset: () => {
      PDFViewer.mockClear();
      documentManagerCapability.getActiveDocumentId.mockClear();
      registry.getPlugin.mockClear();
      scrollCapability.forDocument.mockClear();
      getMetrics.mockClear();
      getLayout.mockClear();
      getRectPositionForPage.mockClear();
      scrollToPage.mockClear();
      onPageChange.mockClear();
      onScroll.mockClear();
      onLayoutChange.mockClear();
      pageChangeHandler = undefined;
      scrollHandler = undefined;
      layoutChangeHandler = undefined;
      selectionChangeHandler = undefined;
      endSelectionHandler = undefined;
      annotationEventHandler = undefined;
      scrollOffset = { x: 0, y: 0 };
      searchAllPages.mockClear();
      searchResults = [];
      searchCapability.goToResult.mockClear();
      searchCapability.nextResult.mockClear();
      searchCapability.previousResult.mockClear();
      searchCapability.setShowAllResults.mockClear();
      searchCapability.startSearch.mockClear();
      searchCapability.stopSearch.mockClear();
      annotationCapability.forDocument.mockClear();
      annotationCapability.setToolDefaults.mockClear();
      annotationScope.setActiveTool.mockClear();
      annotationScope.exportAnnotations.mockClear();
      annotationScope.importAnnotations.mockClear();
      annotationScope.onAnnotationEvent.mockClear();
      requestZoom.mockClear();
      zoomCapability.forDocument.mockClear();
      formattedSelection.mockClear();
      selectedText.mockClear();
      selectionCapability.getSelectedText.mockClear();
      selectionCapability.onEndSelection.mockClear();
      selectionCapability.onSelectionChange.mockClear();
      selectedTextItems = ["Native PDF selection"];
      formattedSelectionItems = [
        {
          pageIndex: 0,
          rect: { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } },
          segmentRects: [
            { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } }
          ]
        }
      ];
    },
    setFormattedSelection: (selection: typeof formattedSelectionItems) => {
      formattedSelectionItems = selection;
    },
    setSelectedText: (text: string[]) => {
      selectedTextItems = text;
    },
    setSearchResults: (results: SearchResultPayload[]) => {
      searchResults = results;
    },
    scrollCapability,
    scrollToPage,
    searchCapability,
    searchAllPages,
    annotationCapability,
    annotationScope,
    selectionCapability,
    requestZoom,
    zoomCapability
  };
});

vi.mock("./platform/fileSources", async () => ({
  ...(await vi.importActual<typeof import("./platform/fileSources")>("./platform/fileSources")),
  isTauriRuntime: () => tauriMocks.isDesktopRuntime()
}));

vi.mock("./platform/tauriBridge", () => ({
  createDesktopSession: tauriMocks.createDesktopSession,
  createEpubAnchor: tauriMocks.createEpubAnchor,
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
  saveSmartReaderCache: tauriMocks.saveSmartReaderCache,
  searchEpubDocument: tauriMocks.searchEpubDocument,
  setSmartReaderCacheLocation: tauriMocks.setSmartReaderCacheLocation,
  rebindEpubAnchor: tauriMocks.rebindEpubAnchor,
  resolveEpubAnchor: tauriMocks.resolveEpubAnchor,
  syncPdfKitAnnotations: tauriMocks.syncPdfKitAnnotations,
  setupTauriMenu: tauriMocks.setupTauriMenu
}));

vi.mock("@embedpdf/react-pdf-viewer", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  function MockPDFViewer(props: { config?: { src?: string }; onReady?: (registry: unknown) => void }) {
    embedPdfMocks.PDFViewer(props);
    React.useEffect(() => {
      props.onReady?.(embedPdfMocks.registry);
    }, [props.onReady]);

    return React.createElement(
      "div",
      {
        className: "embedpdf-viewer-mock",
        "data-testid": "embedpdf-viewer",
        "data-src": props.config?.src ?? ""
      },
      React.createElement("article", { "data-page-number": "1", "data-search-match": undefined }),
      React.createElement("article", { "data-page-number": "2", "data-search-match": undefined })
    );
  }

  return {
    AnnotationPlugin: { id: "annotation" },
    DocumentManagerPlugin: { id: "document-manager" },
    PDFViewer: MockPDFViewer,
    ScrollPlugin: { id: "scroll" },
    ScrollStrategy: { Vertical: "vertical", Horizontal: "horizontal" },
    SelectionPlugin: { id: "selection" },
    SearchPlugin: { id: "search" },
    ZoomPlugin: { id: "zoom" },
    ZoomMode: {
      Automatic: "automatic",
      FitPage: "fit-page",
      FitWidth: "fit-width"
    }
  };
});

describe("App desktop open delivery", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
    const selection = window.getSelection();
    if (selection && typeof selection.removeAllRanges === "function") {
      selection.removeAllRanges();
    }
    tauriMocks.reset();
    embedPdfMocks.reset();
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
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
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

  it("lets EmbedPDF own PDF contents navigation after desktop metadata loads", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(tauriMocks.openPdfDocument).toHaveBeenCalledWith("/Users/mario/Books/start.pdf");
    expect(screen.queryByRole("navigation", { name: "Document navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Intro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Later chapter" })).not.toBeInTheDocument();
    const config = embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config;
    expect(config.theme.light.accent.primary).toBe("#9b633f");
    expect(config.disabledCategories).not.toContain("annotation");
    expect(config.annotations.colorPresets).toContain("#ffe28a");
  });

  it("lets EmbedPDF own duplicate PDF toolbar controls while SmartReader keeps marks and annotation transfer", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();

    expect(screen.queryByLabelText("Page or location")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fit mode")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Find")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Annotation type")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add annotation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bookmark" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PDF annotations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import PDF annotations" })).toBeInTheDocument();
  });

  it("renders desktop PDF documents through EmbedPDF blob URLs", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    tauriMocks.readFileSource.mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70]).buffer);

    render(<App />);

    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
    });
    expect(tauriMocks.readFileSource).toHaveBeenCalledWith({
      kind: "desktop-path",
      path: "/Users/mario/Books/start.pdf"
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.src).toBe("blob:smartreader-test");
    await waitFor(() => {
      expect(embedPdfMocks.scrollToPage).toHaveBeenCalledWith({
        pageNumber: 1,
        behavior: "instant"
      });
    });
  });

  it("does not render SmartReader PDF selection annotation UI when EmbedPDF owns annotations", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();

    expect(screen.queryByLabelText("Selection annotation quick menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick highlight annotation" })).not.toBeInTheDocument();
    expect(screen.queryByText("Native PDF selection")).not.toBeInTheDocument();
    expect(embedPdfMocks.selectionCapability.onEndSelection).not.toHaveBeenCalled();
    expect(embedPdfMocks.selectionCapability.getFormattedSelection).not.toHaveBeenCalled();
    expect(embedPdfMocks.selectionCapability.getSelectedText).not.toHaveBeenCalled();
  });

  it("opens the EmbedPDF search surface from the reader find shortcut", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    fireEvent.keyDown(document, { key: "f", metaKey: true });

    await waitFor(() => {
      expect(embedPdfMocks.searchCapability.startSearch).toHaveBeenCalledWith("smartreader-test-document");
      expect(embedPdfMocks.searchCapability.setShowAllResults).toHaveBeenCalledWith(true, "smartreader-test-document");
    });
    expect(screen.queryByLabelText("Find in document")).not.toBeInTheDocument();
  });

  it("updates the visible PDF page from scrolling without forcing a page snap", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    render(<App />);

    await waitForStartPdfReader();
    await waitFor(() => expect(embedPdfMocks.scrollCapability.onPageChange).toHaveBeenCalled());
    embedPdfMocks.scrollToPage.mockClear();

    act(() => {
      embedPdfMocks.emitPageChange(2);
    });

    await screen.findByText("Page 2");
    expect(embedPdfMocks.scrollToPage).not.toHaveBeenCalled();
  });

  it("keeps explicit PDF next and previous shortcuts as hard page jumps", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    render(<App />);

    await waitForStartPdfReader();
    embedPdfMocks.scrollToPage.mockClear();

    fireEvent.keyDown(document, { key: "ArrowRight" });

    await screen.findByText("Page 2");
    expect(embedPdfMocks.scrollToPage).toHaveBeenCalledWith({
      pageNumber: 2,
      behavior: "instant"
    });

    embedPdfMocks.scrollToPage.mockClear();
    fireEvent.keyDown(document, { key: "ArrowLeft" });

    await screen.findByText("Page 1");
    expect(embedPdfMocks.scrollToPage).toHaveBeenCalledWith({
      pageNumber: 1,
      behavior: "instant"
    });
  });

  it("zooms a PDF from a trackpad pinch wheel gesture and keeps zoom bounded", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    render(<App />);

    const reader = await screen.findByLabelText("start.pdf reader");
    await waitForStartPdfReader();
    embedPdfMocks.requestZoom.mockClear();

    fireEvent.wheel(reader, { ctrlKey: true, deltaY: -120, clientX: 300, clientY: 240 });

    await waitFor(() => {
      expect(embedPdfMocks.requestZoom).toHaveBeenLastCalledWith(1.1);
    });

    for (let index = 0; index < 40; index += 1) {
      fireEvent.wheel(reader, { ctrlKey: true, deltaY: -120, clientX: 300, clientY: 240 });
    }

    await waitFor(() => {
      expect(embedPdfMocks.requestZoom).toHaveBeenLastCalledWith(3);
    });

    for (let index = 0; index < 80; index += 1) {
      fireEvent.wheel(reader, { ctrlKey: true, deltaY: 120, clientX: 300, clientY: 240 });
    }

    await waitFor(() => {
      expect(embedPdfMocks.requestZoom).toHaveBeenLastCalledWith(0.5);
    });
  });

  it("keeps EmbedPDF search state stable after pinch zoom changes", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    await act(async () => undefined);
    const reader = screen.getByLabelText("start.pdf reader");
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    await waitFor(() => expect(embedPdfMocks.searchCapability.startSearch).toHaveBeenCalledWith("smartreader-test-document"));
    embedPdfMocks.searchAllPages.mockClear();

    fireEvent.wheel(reader, { ctrlKey: true, deltaY: -120, clientX: 300, clientY: 240 });

    await waitFor(() => {
      expect(embedPdfMocks.requestZoom).toHaveBeenLastCalledWith(1.1);
    });
    await act(async () => undefined);
    expect(embedPdfMocks.searchAllPages).not.toHaveBeenCalled();
  });

  it("coalesces pinch wheel zoom updates until the next animation frame", async () => {
    let animationFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrame = callback;
      return 1;
    });
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    const reader = await screen.findByLabelText("start.pdf reader");
    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
    });
    embedPdfMocks.requestZoom.mockClear();

    fireEvent.wheel(reader, { ctrlKey: true, deltaY: -120, clientX: 300, clientY: 240 });
    fireEvent.wheel(reader, { ctrlKey: true, deltaY: -120, clientX: 300, clientY: 240 });

    expect(embedPdfMocks.requestZoom).not.toHaveBeenCalled();

    await act(async () => {
      animationFrame?.(0);
    });

    await waitFor(() => {
      expect(embedPdfMocks.requestZoom).toHaveBeenLastCalledWith(1.2);
    });
  });

  it("renders browser-file PDFs through EmbedPDF without the legacy page renderer", async () => {
    tauriMocks.setDesktopRuntime(false);
    tauriMocks.setPendingPaths([]);

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["%PDF-1.7"], "local.pdf", { type: "application/pdf" })]
      }
    });

    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(embedPdfMocks.scrollCapability.onPageChange).toHaveBeenCalled();
    });
    act(() => {
      embedPdfMocks.emitPageChange(2);
    });
    await screen.findByText("Page 2");
    expect(screen.queryByText("Page render failed.")).not.toBeInTheDocument();
  });

  it("keeps browser-file PDF search inside EmbedPDF instead of SmartReader search UI", async () => {
    tauriMocks.setDesktopRuntime(false);
    tauriMocks.setPendingPaths([]);

    render(<App />);

    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: {
        files: [new File(["%PDF-1.7"], "local.pdf", { type: "application/pdf" })]
      }
    });

    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
      expect(embedPdfMocks.scrollCapability.onPageChange).toHaveBeenCalled();
    });
    fireEvent.keyDown(document, { key: "f", metaKey: true });

    await waitFor(() => {
      expect(embedPdfMocks.searchCapability.startSearch).toHaveBeenCalledWith("smartreader-test-document");
    });
    expect(screen.queryByLabelText("Find in document")).not.toBeInTheDocument();
  });

  it("does not mount SmartReader PDF outline rows when EmbedPDF owns large outlines", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/large-outline.pdf"]);
    tauriMocks.openPdfDocument.mockResolvedValueOnce({
      id: "/Users/mario/Books/large-outline.pdf",
      pageCount: 10000,
      outline: Array.from({ length: 10000 }, (_, index) => ({
        id: `large-outline-${index}`,
        title: `Large Section ${index}`,
        page: index + 1,
        level: index % 10 === 0 ? 0 : Math.min(index % 10, 3)
      }))
    });

    render(<App />);

    await screen.findByLabelText("large-outline.pdf reader");
    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
      expect(tauriMocks.openPdfDocument).toHaveBeenCalledWith("/Users/mario/Books/large-outline.pdf");
    });
    expect(screen.queryByRole("navigation", { name: "Document navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Large Section 0" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Large Section 9999" })).not.toBeInTheDocument();
  });

  it("debounces cache persistence during visible page progress updates", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    await waitFor(() => expect(embedPdfMocks.scrollCapability.onPageChange).toHaveBeenCalled());

    vi.useFakeTimers();
    try {
      tauriMocks.saveSmartReaderCache.mockClear();

      act(() => {
        embedPdfMocks.emitPageChange(2);
      });

      expect(screen.getByText("Page 2")).toBeInTheDocument();
      expect(tauriMocks.saveSmartReaderCache).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(tauriMocks.saveSmartReaderCache).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not render SmartReader PDF search results when EmbedPDF owns search", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(screen.queryByRole("tab", { name: "Search" })).not.toBeInTheDocument();
    expect(document.querySelector(".search-result-row")).not.toBeInTheDocument();
  });

  it("keeps native PDFKit annotation copy separate from the EmbedPDF renderer", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(screen.getByLabelText("Enable native PDFKit annotation copy"));

    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
    });
    expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.src).toBe("blob:smartreader-test");
  });

  it("hydrates the last desktop session on startup", async () => {
    tauriMocks.setPendingPaths([]);
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(createSnapshot("pdf-1", 9)));

    render(<App />);

    expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("Page 9")).toBeInTheDocument();
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

    await act(async () => {
      screen.getByText("guide.pdf").click();
    });
    expect(screen.getByText("Page 33")).toBeInTheDocument();

    await act(async () => {
      screen.getByText("spec.pdf").click();
    });
    expect(screen.getByText("Page 9")).toBeInTheDocument();
  });

  it("focuses an already-open recent document instead of opening a duplicate tab", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    fireEvent.click(screen.getByText("start.pdf"));

    await waitFor(() => {
      expect(screen.getByLabelText("start.pdf reader")).toBeInTheDocument();
    });
    expect(tauriMocks.createDesktopSession).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("start.pdf")).toHaveLength(1);
  });

  it("keeps the existing tab active when a duplicate desktop open is delivered", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await screen.findByLabelText("start.pdf reader");

    await act(async () => {
      tauriMocks.emitDesktopOpen("/Users/mario/Books/start.pdf");
    });

    await waitFor(() => {
      expect(screen.getByLabelText("start.pdf reader")).toBeInTheDocument();
    });
    expect(screen.getAllByText("start.pdf")).toHaveLength(1);
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("restores a closed desktop recent document at its saved location", async () => {
    tauriMocks.setPendingPaths([]);
    tauriMocks.openPdfDocument.mockResolvedValueOnce({
      id: "/Users/mario/Books/spec.pdf",
      pageCount: 12,
      outline: []
    });
    localStorage.setItem(
      "smartreader.recentFiles.v1",
      JSON.stringify([
        {
          id: "/Users/mario/Books/spec.pdf",
          title: "spec.pdf",
          path: "/Users/mario/Books/spec.pdf",
          parentPath: "/Users/mario/Books",
          format: "pdf",
          access: "desktop-path",
          lastOpenedAt: 1,
          resumeLabel: "Page 9",
          location: { kind: "page", page: 9 }
        }
      ])
    );

    render(<App />);

    fireEvent.click(await screen.findByText("spec.pdf"));

    await screen.findByText("Page 9");
    expect(screen.getByLabelText("spec.pdf reader")).toBeInTheDocument();
  });

  it("uses toolbar Back and Forward for explicit PDF navigation history", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    render(<App />);

    await waitForStartPdfReader();
    fireEvent.keyDown(document, { key: "ArrowRight" });

    await screen.findByText("Page 2");

    fireEvent.click(screen.getByLabelText("Back"));

    await screen.findByText("Page 1");

    fireEvent.click(screen.getByLabelText("Forward"));

    await screen.findByText("Page 2");
  });

  it("starts EmbedPDF search from the PDF find command without SmartReader result panes", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    fireEvent.keyDown(document, { key: "f", metaKey: true });

    await waitFor(() => {
      expect(embedPdfMocks.searchCapability.startSearch).toHaveBeenCalledWith("smartreader-test-document");
    });
    expect(screen.queryByLabelText("Find in document")).not.toBeInTheDocument();
    expect(document.querySelector(".search-result-row")).not.toBeInTheDocument();
  });

  it("keeps PDF search result navigation delegated to EmbedPDF", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(screen.queryByRole("button", { name: /Page 2, result/ })).not.toBeInTheDocument();
    expect(embedPdfMocks.searchCapability.goToResult).not.toHaveBeenCalled();
  });

  it("delegates PDF find next and previous shortcuts to EmbedPDF", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", metaKey: true, shiftKey: true }));

    expect(embedPdfMocks.searchCapability.nextResult).toHaveBeenCalledWith("smartreader-test-document");
    expect(embedPdfMocks.searchCapability.previousResult).toHaveBeenCalledWith("smartreader-test-document");
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it("delegates PDF search highlighting to EmbedPDF instead of SmartReader page overlays", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(screen.getByTestId("embedpdf-viewer")).toBeInTheDocument();
    expect(document.querySelector(".pdf-search-highlight")).not.toBeInTheDocument();
  });

  it("does not rebuild legacy text overlays for PDF search", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(screen.queryByLabelText("Find in document")).not.toBeInTheDocument();
    expect(document.querySelector("[data-smartreader-pdf-text-layer]")).not.toBeInTheDocument();
  });

  it("marks the active bookmark row and toolbar state for the current PDF page", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    fireEvent.click(screen.getByLabelText("Bookmark"));

    const pageOneMark = await screen.findByRole("button", { name: "Page 1" });
    expect(pageOneMark).toHaveAttribute("aria-current", "true");
    expect(screen.getByLabelText("Bookmark")).toHaveAttribute("aria-pressed", "true");

    act(() => {
      embedPdfMocks.emitPageChange(2);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Bookmark")).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("keeps EPUB TOC fragment rows ordered and only activates the clicked anchor item", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.openEpubDocument.mockResolvedValueOnce({
      id: "/Users/mario/Books/story.epub",
      title: "Story",
      chapters: [
        { id: "chapter-1", href: "OPS/chapter-1.xhtml", label: "Chapter One", index: 0 }
      ],
      outline: [
        { id: "parent", title: "Parent Chapter", href: "OPS/chapter-1.xhtml", index: 0, level: 0 },
        { id: "child", title: "Deep Anchor", href: "OPS/chapter-1.xhtml#deep", index: 0, level: 1 }
      ]
    });
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: `<p id="deep">Native chapter body</p>`,
      text: "Native chapter body",
      resources: [] as EpubResourceMetadata[]
    });

    render(<App />);

    await screen.findByText("Native chapter body");
    const rowsBeforeClick = Array.from(document.querySelectorAll(".sidebar-row button:last-child")).map((row) => row.textContent);
    expect(rowsBeforeClick).toEqual(["Parent Chapter", "Deep Anchor"]);

    fireEvent.click(screen.getByRole("button", { name: "Deep Anchor" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deep Anchor" }).closest(".sidebar-row")).toHaveClass("active");
    });
    expect(screen.getByRole("button", { name: "Parent Chapter" }).closest(".sidebar-row")).not.toHaveClass("active");
    expect(tauriMocks.readEpubChapter).toHaveBeenCalledWith("/Users/mario/Books/story.epub", "OPS/chapter-1.xhtml");
  });

  it("scrolls to an EPUB fragment anchor when a child TOC item is clicked", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.openEpubDocument.mockResolvedValueOnce({
      id: "/Users/mario/Books/story.epub",
      title: "Story",
      chapters: [
        { id: "chapter-1", href: "OPS/chapter-1.xhtml", label: "Chapter One", index: 0 }
      ],
      outline: [
        { id: "parent", title: "Parent Chapter", href: "OPS/chapter-1.xhtml", index: 0, level: 0 },
        { id: "child", title: "Deep Anchor", href: "OPS/chapter-1.xhtml#deep", index: 0, level: 1 }
      ]
    });
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: `<p id="deep">Native chapter body</p>`,
      text: "Native chapter body",
      resources: [] as EpubResourceMetadata[]
    });

    render(<App />);

    await screen.findByText("Native chapter body");
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Deep Anchor" }));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    });
    expect(screen.getByRole("button", { name: "Deep Anchor" }).closest(".sidebar-row")).toHaveClass("active");
  });

  it("uses EmbedPDF native annotation UI instead of the front-end PDF annotation bar", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(screen.queryByLabelText("Annotation type")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add annotation" })).not.toBeInTheDocument();
    expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.annotations).toMatchObject({
      autoCommit: true,
      annotationAuthor: "SmartReader"
    });
    expect(screen.queryByText("Important result")).not.toBeInTheDocument();
  });

  it("exports and imports native PDF annotations through the EmbedPDF annotation scope", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    embedPdfMocks.annotationScope.exportAnnotations.mockReturnValueOnce({
      toPromise: vi.fn(async () => [{ annotation: { id: "native-annotation-1" } }])
    });

    render(<App />);

    await waitForStartPdfReader();
    await waitFor(() => {
      expect(embedPdfMocks.annotationCapability.forDocument).toHaveBeenCalledWith("smartreader-test-document");
    });
    fireEvent.click(screen.getByRole("button", { name: "Export PDF annotations" }));

    await waitFor(() => {
      expect(embedPdfMocks.annotationScope.exportAnnotations).toHaveBeenCalled();
    });
    const exportedBlob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(exportedText).toContain("\"schemaVersion\": 1");
    expect(exportedText).toContain("native-annotation-1");
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].nativePdfAnnotations?.annotations).toEqual([
        { annotation: { id: "native-annotation-1" } }
      ]);
    });

    const importPayload = {
      annotations: [{ annotation: { id: "native-annotation-2" } }]
    };
    fireEvent.change(screen.getByLabelText("Import PDF annotations file"), {
      target: {
        files: [new File([JSON.stringify(importPayload)], "annotations.json", { type: "application/json" })]
      }
    });

    await waitFor(() => {
      expect(embedPdfMocks.annotationScope.importAnnotations).toHaveBeenCalledWith(importPayload.annotations);
    });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].nativePdfAnnotations?.annotations).toEqual(importPayload.annotations);
    });
  });

  it("restores and persists native PDF annotations through EmbedPDF", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("native-pdf-annotation-restore", 1);
    const persistedAnnotations = [{ annotation: { id: "native-restored-1" } }];
    snapshot.sessions[0].nativePdfAnnotations = {
      schemaVersion: 1,
      annotations: persistedAnnotations,
      updatedAt: 1
    };
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));
    embedPdfMocks.annotationScope.exportAnnotations.mockReturnValue({
      toPromise: vi.fn(async () => [{ annotation: { id: "native-created-1" } }])
    });

    render(<App />);

    await waitForStartPdfReader("spec.pdf reader");
    await waitFor(() => {
      expect(embedPdfMocks.annotationScope.importAnnotations).toHaveBeenCalledWith(persistedAnnotations);
    });

    embedPdfMocks.emitAnnotationEvent();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].nativePdfAnnotations?.annotations).toEqual([
        { annotation: { id: "native-created-1" } }
      ]);
    });
  });

  it("reimports native PDF annotations when an imported cache updates a live PDF viewer", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    (tauriMocks.openCacheImportDialog as unknown as { mockResolvedValue: (value: string) => void }).mockResolvedValue(
      "/Users/mario/Downloads/native-pdf-cache.json"
    );
    const importedAnnotations = [{ annotation: { id: "native-imported-live" } }];
    const importedTab = createSnapshotSession("desktop-1", "/Users/mario/Books/start.pdf", 1);
    importedTab.nativePdfAnnotations = {
      schemaVersion: 1,
      annotations: importedAnnotations,
      updatedAt: 4
    };
    tauriMocks.setCacheImportResult({
      schemaVersion: 1,
      appVersion: "0.1.0",
      savedAt: "2026-05-23T00:00:00.000Z",
      settings: createSnapshot("desktop-1", 1).preferences,
      recentFiles: [],
      readingProgress: [],
      session: {
        activeTabId: "desktop-1",
        sidebarOpen: true,
        tabs: [importedTab]
      },
      adapterCache: { searchIndexes: [] }
    });

    render(<App />);

    await waitForStartPdfReader();
    await waitFor(() => {
      expect(embedPdfMocks.annotationCapability.forDocument).toHaveBeenCalledWith("smartreader-test-document");
    });
    embedPdfMocks.annotationScope.importAnnotations.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply Imported Cache" }));

    await waitFor(() => {
      expect(embedPdfMocks.annotationScope.importAnnotations).toHaveBeenCalledWith(importedAnnotations);
    });
  });

  it("does not add a SmartReader quick annotation menu over EmbedPDF text selections", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();

    expect(screen.queryByRole("button", { name: "Quick note annotation" })).not.toBeInTheDocument();
    expect(embedPdfMocks.annotationScope.setActiveTool).not.toHaveBeenCalledWith(
      "textComment",
      expect.anything()
    );
    expect(screen.queryByText("Native PDF result")).not.toBeInTheDocument();
  });

  it("keeps SmartReader PDF quick annotation UI disabled after the outer mouseup event", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    const reader = screen.getByLabelText("start.pdf reader");
    fireEvent.mouseUp(reader);

    expect(screen.queryByRole("button", { name: "Quick note annotation" })).not.toBeInTheDocument();
  });

  it("enables selectable PDF text through the EmbedPDF selection plugin", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.selection).toMatchObject({
      menuHeight: 48,
      marquee: { enabled: true }
    });
    expect(embedPdfMocks.selectionCapability.onSelectionChange).not.toHaveBeenCalled();
    expect(embedPdfMocks.selectionCapability.onEndSelection).not.toHaveBeenCalled();
  });

  it("keeps PDF text selectable when the WebView lacks Promise.withResolvers", async () => {
    const promiseConstructor = Promise as PromiseConstructor & {
      withResolvers?: () => { promise: Promise<unknown>; resolve: (value?: unknown) => void; reject: (error?: unknown) => void };
    };
    const originalWithResolvers = promiseConstructor.withResolvers;
    Object.defineProperty(Promise, "withResolvers", {
      configurable: true,
      writable: true,
      value: undefined
    });
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    try {
      render(<App />);

      await waitForStartPdfReader();
      expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.selection).toMatchObject({
        marquee: { enabled: true }
      });
      expect(screen.queryByText("This PDF page has no selectable text. Use Area annotation instead.")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        writable: true,
        value: originalWithResolvers
      });
    }
  });

  it.each(["note", "highlight", "underline", "strike"] as const)(
    "sends PDFKit text selection rects for %s annotations",
    async (annotationType) => {
      tauriMocks.setPendingPaths([]);
      const snapshot = createSnapshot("pdfkit-text-selection", 1);
      snapshot.preferences.pdfKit.enabled = true;
      localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

      render(<App />);

      await selectEmbedPdfText({ text: ["Native PDF result"] });

      if (annotationType === "note" || annotationType === "highlight" || annotationType === "underline") {
        fireEvent.click(await screen.findByRole("button", { name: `Quick ${annotationType} annotation` }));
      } else {
        fireEvent.change(screen.getByLabelText("Annotation type"), {
          target: { value: annotationType }
        });
        fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));
      }

      await waitFor(() => {
        const request = tauriMocks.syncPdfKitAnnotations.mock.calls.at(-1)?.[0];
        expect(request?.annotations[0]).toMatchObject({
          operation: "upsert",
          page: 1,
          kind: annotationType,
          rects: [
            {
              x: 80,
              y: 756,
              width: 180,
              height: 24
            }
          ]
        });
      });

      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].area).toMatchObject({
        page: 1,
        left: 80,
        top: 120,
        width: 180,
        height: 24,
        viewportHeight: 900,
        viewportScale: 1
      });
      expect(stored.sessions[0].annotations[0].rects).toEqual([
        expect.objectContaining({
          left: 80,
          top: 120,
          width: 180,
          height: 24
        })
      ]);
    }
  );

  it("sends all PDFKit rects for a multi-rect text selection", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-multi-rect", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await selectEmbedPdfText({
      text: ["Native PDF result"],
      selection: [
        {
          pageIndex: 0,
          rect: { origin: { x: 80, y: 120 }, size: { width: 180, height: 54 } },
          segmentRects: [
            { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } },
            { origin: { x: 80, y: 150 }, size: { width: 140, height: 24 } }
          ]
        }
      ]
    });
    fireEvent.click(await screen.findByRole("button", { name: "Quick highlight annotation" }));

    await waitFor(() => {
      const request = tauriMocks.syncPdfKitAnnotations.mock.calls.at(-1)?.[0];
      expect(request?.annotations[0]).toMatchObject({
        kind: "highlight",
        rects: [
          { x: 80, y: 756, width: 180, height: 24 },
          { x: 80, y: 726, width: 140, height: 24 }
        ]
      });
    });
  });

  it("does not offer PDF text annotation for a selection spanning two pages", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-cross-page-selection", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await selectEmbedPdfText({
      text: ["Native PDF result", "Native PDF result"],
      selection: [
        {
          pageIndex: 0,
          rect: { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } },
          segmentRects: [
            { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } }
          ]
        },
        {
          pageIndex: 1,
          rect: { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } },
          segmentRects: [
            { origin: { x: 80, y: 120 }, size: { width: 180, height: 24 } }
          ]
        }
      ]
    });

    expect(screen.queryByRole("toolbar", { name: "Selection annotation quick menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick highlight annotation" })).not.toBeInTheDocument();
  });

  it("keeps the default PDF selection quick menu disabled when the next selection is empty", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    expect(screen.queryByRole("toolbar", { name: "Selection annotation quick menu" })).not.toBeInTheDocument();

    await act(async () => {
      embedPdfMocks.emitSelectionChange(null);
    });

    await waitFor(() => {
      expect(screen.queryByRole("toolbar", { name: "Selection annotation quick menu" })).not.toBeInTheDocument();
    });
  });

  it("does not create the PDF selection quick menu for a collapsed text range", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();
    embedPdfMocks.setFormattedSelection([]);

    await act(async () => {
      embedPdfMocks.emitSelectionChange();
      embedPdfMocks.emitEndSelection();
    });

    expect(screen.queryByRole("toolbar", { name: "Selection annotation quick menu" })).not.toBeInTheDocument();
  });

  it("keeps the selected annotation while editing name, note, type, and note font settings", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdf-annotations", 1);
    snapshot.sessions[0].sidebarMode = "annotations";
    snapshot.sessions[0].annotations = [
      {
        id: "annotation-1",
        type: "area",
        tag: "重点",
        color: "#ffe28a",
        thickness: 2,
        location: { kind: "page", page: 1 },
        area: {
          page: 1,
          left: 80,
          top: 120,
          width: 180,
          height: 24,
          viewportWidth: 700,
          viewportHeight: 900,
          viewportScale: 1
        },
        note: "Original note",
        hidden: false,
        createdAt: 1,
        updatedAt: 1
      }
    ];
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    fireEvent.click((await screen.findByText("Original note")).closest("button")!);
    fireEvent.change(await screen.findByLabelText("Annotation name"), {
      target: { value: "   " }
    });
    fireEvent.blur(screen.getByLabelText("Annotation name"));
    expect(screen.getByLabelText("Annotation name")).toHaveValue("Original note");

    fireEvent.change(screen.getByLabelText("Annotation name"), {
      target: { value: "  Renamed annotation  " }
    });
    fireEvent.blur(screen.getByLabelText("Annotation name"));
    fireEvent.change(screen.getByLabelText("Selected annotation note"), {
      target: { value: "Edited note" }
    });
    fireEvent.change(screen.getByLabelText("Selected annotation type"), {
      target: { value: "wavy" }
    });
    fireEvent.change(screen.getByLabelText("Selected annotation note font size"), {
      target: { value: "18" }
    });

    expect(screen.getByLabelText("Annotation name")).toHaveValue("Renamed annotation");
    expect(screen.getByLabelText("Selected annotation note")).toHaveValue("Edited note");
    expect(screen.getByText("Renamed annotation").closest(".annotation-row")).toHaveClass("active");

    fireEvent.click(screen.getByRole("button", { name: "Cancel annotation selection" }));
    expect(screen.queryByLabelText("Selected annotation note")).not.toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
    expect(stored.sessions[0].annotations[0]).toMatchObject({
      name: "Renamed annotation",
      note: "Edited note",
      type: "wavy",
      noteFontSize: 18
    });
  });

  it("renames marks and resizes the desktop sidebar with keyboard and double-click reset", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("marks-rename", 1);
    snapshot.sessions[0].sidebarMode = "bookmarks";
    snapshot.sessions[0].bookmarks = [
      {
        id: "bookmark-1",
        title: "Page 1",
        location: { kind: "page" as const, page: 1 },
        createdAt: 1
      }
    ];
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    const renameInput = await screen.findByLabelText("Rename mark Page 1");
    fireEvent.change(renameInput, { target: { value: "  Important mark  " } });
    fireEvent.blur(renameInput);
    expect(await screen.findByLabelText("Rename mark Important mark")).toHaveValue("Important mark");

    const resizeHandle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowRight" });
    let workspace = document.querySelector<HTMLElement>(".reader-workspace");
    expect(workspace?.style.getPropertyValue("--sidebar-width")).toBe("270px");
    expect(workspace?.style.gridTemplateColumns).toBe("");
    expect(workspace?.children).toHaveLength(3);
    expect(workspace?.children[0]).toHaveClass("reader-sidebar");
    expect(workspace?.children[1]).toHaveClass("sidebar-resize-handle");
    expect(workspace?.children[2]).toHaveClass("reader-viewport");
    fireEvent.doubleClick(resizeHandle);
    expect(document.querySelector<HTMLElement>(".reader-workspace")?.style.getPropertyValue("--sidebar-width")).toBe("260px");
    expect(document.querySelector<HTMLElement>(".reader-workspace")?.style.gridTemplateColumns).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    workspace = document.querySelector<HTMLElement>(".reader-workspace");
    expect(workspace).not.toHaveClass("with-sidebar");
    expect(workspace?.style.gridTemplateColumns).toBe("");
    expect(workspace?.style.getPropertyValue("--sidebar-width")).toBe("");
    expect(workspace?.children).toHaveLength(1);
  });

  it("keeps PDF annotation viewport metadata when sanitizing imported cache data", () => {
    const snapshot = createSnapshot("cache-area", 1);
    snapshot.sessions[0].annotations = [
      {
        id: "annotation-area",
        type: "area",
        tag: "重点",
        color: "#ffe28a",
        thickness: 2,
        location: { kind: "page", page: 1 },
        area: {
          page: 1,
          left: 24,
          top: 24,
          width: 180,
          height: 48,
          viewportHeight: 900,
          viewportScale: 1.25
        },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: "annotation-invalid-area",
        type: "area",
        tag: "重点",
        color: "#ffe28a",
        thickness: 2,
        location: { kind: "page", page: 1 },
        area: {
          page: 1,
          left: 24,
          top: 24,
          width: 180,
          height: 48,
          viewportHeight: -1,
          viewportScale: Number.POSITIVE_INFINITY
        },
        createdAt: 1,
        updatedAt: 1
      }
    ];

    const cache = validateSmartReaderCacheEnvelope({
      schemaVersion: 1,
      savedAt: "2026-05-26T00:00:00.000Z",
      settings: snapshot.preferences,
      recentFiles: [],
      readingProgress: [],
      session: {
        activeTabId: snapshot.activeTabId,
        sidebarOpen: snapshot.sidebarOpen,
        tabs: snapshot.sessions
      },
      adapterCache: { searchIndexes: [] }
    });

    expect(cache?.session.tabs[0].annotations[0].area).toMatchObject({
      viewportHeight: 900,
      viewportScale: 1.25
    });
    expect(cache?.session.tabs[0].annotations[1].area).not.toHaveProperty("viewportHeight");
    expect(cache?.session.tabs[0].annotations[1].area).not.toHaveProperty("viewportScale");
  });

  it("does not activate SmartReader square annotation tools from default PDF selection context", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);

    render(<App />);

    await waitForStartPdfReader();

    expect(embedPdfMocks.annotationScope.setActiveTool).not.toHaveBeenCalledWith("square", expect.anything());
    expect(screen.queryByRole("button", { name: "Add annotation" })).not.toBeInTheDocument();
    expect(screen.queryByText("Area annotation")).not.toBeInTheDocument();
  });

  it("persists desktop PDFKit area annotations through the sync bridge", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-annotations", 1);
    snapshot.preferences.pdfKit.enabled = true;
    snapshot.sessions[0].zoom = 1.1;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledWith({
        path: "/Users/mario/Books/spec.pdf",
        managedCopyPath: undefined,
        writeMode: "copy",
        annotations: [
          expect.objectContaining({
            operation: "upsert",
            page: 1,
            kind: "area",
            color: "#ffe28a",
            thickness: 2,
            rects: [
              {
                x: 80,
                y: 756,
                width: 180,
                height: 24
              }
            ]
          })
        ]
      });
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativePdfKit).toMatchObject({
        status: "upserted",
        nativeId: expect.stringMatching(/^smartreader:/)
      });
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    });

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(2);
      expect(tauriMocks.syncPdfKitAnnotations.mock.calls[1]?.[0]).toMatchObject({
        path: "/Users/mario/Books/spec.pdf",
        managedCopyPath: "/tmp/smartreader-pdfkit-managed.pdf",
        writeMode: "copy"
      });
    });
  });

  it("marks toolbar PDFKit annotations without viewport geometry unsupported", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-missing-geometry", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await waitForStartPdfReader("spec.pdf reader");
    fireEvent.change(screen.getByLabelText("Annotation type"), {
      target: { value: "area" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));
    fireEvent.click(screen.getByRole("tab", { name: "Annotations" }));

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).not.toHaveBeenCalled();
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativePdfKit).toMatchObject({
        supported: false,
        status: "unsupported-native-geometry",
        reason: "unsupported-native-geometry"
      });
    });
    expect(screen.getByText("Native PDFKit: unsupported-native-geometry")).toBeInTheDocument();
  });

  it("serializes quick PDFKit annotation syncs per document and reuses the returned managed copy", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-serialized", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));
    let resolveFirstSync: (() => void) | undefined;

    tauriMocks.syncPdfKitAnnotations.mockImplementationOnce((request) =>
      new Promise((resolve) => {
        resolveFirstSync = () => {
          resolve({
            supported: true,
            status: "synced",
            sourcePath: request.path,
            managedCopyPath: "/tmp/smartreader-pdfkit-managed-first.pdf",
            annotations: request.annotations.map((annotation) => ({
              id: annotation.id,
              status: "upserted",
              page: annotation.page,
              kind: annotation.kind,
              nativeId: `smartreader:${annotation.id}`,
              reason: undefined
            }))
          });
        };
      })
    );

    render(<App />);

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
    });

    await addEmbedPdfAreaAnnotation();
    expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstSync?.();
    });

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(2);
      expect(tauriMocks.syncPdfKitAnnotations.mock.calls[1]?.[0]).toMatchObject({
        path: "/Users/mario/Books/spec.pdf",
        managedCopyPath: "/tmp/smartreader-pdfkit-managed-first.pdf",
        writeMode: "copy",
        annotations: [
          expect.objectContaining({
            operation: "upsert",
            kind: "area"
          })
        ]
      });
    });
  });

  it("syncs PDFKit annotation edits and deletes without duplicate request items", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-edit", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText("Selected annotation color"), {
      target: { value: "#9ed7ff" }
    });
    fireEvent.change(screen.getByLabelText("Selected annotation thickness"), {
      target: { value: "4" }
    });

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(3);
    });

    const editRequest = tauriMocks.syncPdfKitAnnotations.mock.calls.at(-1)?.[0];
    if (!editRequest) {
      throw new Error("Missing PDFKit edit sync request");
    }
    expect(editRequest.annotations).toHaveLength(1);
    expect(editRequest.annotations[0]).toMatchObject({
      operation: "upsert",
      kind: "area",
      color: "#9ed7ff",
      thickness: 4
    });
    expect(editRequest.managedCopyPath).toBe("/tmp/smartreader-pdfkit-managed.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Delete selected annotation" }));

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(4);
    });

    const deleteRequest = tauriMocks.syncPdfKitAnnotations.mock.calls.at(-1)?.[0];
    if (!deleteRequest) {
      throw new Error("Missing PDFKit delete sync request");
    }
    expect(deleteRequest.annotations).toEqual([
      expect.objectContaining({
        operation: "delete",
        kind: "area"
      })
    ]);
  });

  it("syncs hidden PDFKit annotations as native deletes and restores them as upserts", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-hidden", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByLabelText("Visible"));

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(2);
    });
    expect(tauriMocks.syncPdfKitAnnotations.mock.calls.at(-1)?.[0].annotations).toEqual([
      expect.objectContaining({
        operation: "delete",
        kind: "area"
      })
    ]);

    fireEvent.click(screen.getByLabelText("Visible"));

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(3);
    });
    expect(tauriMocks.syncPdfKitAnnotations.mock.calls.at(-1)?.[0].annotations).toEqual([
      expect.objectContaining({
        operation: "upsert",
        kind: "area"
      })
    ]);
  });

  it.each(["wavy", "red-text"] as const)(
    "deletes stale native PDFKit annotation before marking %s unsupported",
    async (unsupportedType) => {
      tauriMocks.setPendingPaths([]);
      const snapshot = createSnapshot("pdfkit-unsupported", 1);
      snapshot.preferences.pdfKit.enabled = true;
      localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

      render(<App />);

      await addEmbedPdfAreaAnnotation();

      await waitFor(() => {
        expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
      });

      fireEvent.change(screen.getByLabelText("Selected annotation type"), {
        target: { value: unsupportedType }
      });

      await waitFor(() => {
        expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(2);
        expect(tauriMocks.syncPdfKitAnnotations.mock.calls[1]?.[0]).toMatchObject({
          path: "/Users/mario/Books/spec.pdf",
          managedCopyPath: "/tmp/smartreader-pdfkit-managed.pdf",
          writeMode: "copy",
          annotations: [
            expect.objectContaining({
              operation: "delete",
              kind: "area"
            })
          ]
        });
        const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
        expect(stored.sessions[0].annotations[0].nativePdfKit).toMatchObject({
          supported: false,
          status: "unsupported-native-mapping",
          reason: "unsupported-native-mapping"
        });
        expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("nativeId");
        expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
      });
      expect(screen.getByText("Native PDFKit: unsupported-native-mapping")).toBeInTheDocument();
    }
  );

  it.each(["wavy", "red-text"] as const)(
    "keeps PDF text selection annotations unsupported for %s without native sync",
    async (unsupportedType) => {
      tauriMocks.setPendingPaths([]);
      const snapshot = createSnapshot("pdfkit-text-unsupported", 1);
      snapshot.preferences.pdfKit.enabled = true;
      localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

      render(<App />);

      await selectEmbedPdfText({ text: ["Native PDF result"] });
      fireEvent.change(screen.getByLabelText("Annotation type"), {
        target: { value: unsupportedType }
      });
      fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));

      await waitFor(() => {
        expect(tauriMocks.syncPdfKitAnnotations).not.toHaveBeenCalled();
        const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
        expect(stored.sessions[0].annotations[0].nativePdfKit).toMatchObject({
          supported: false,
          status: "unsupported-native-mapping",
          reason: "unsupported-native-mapping"
        });
      });
    }
  );

  it("marks failed PDFKit syncs dirty and retries them after reopen with native-managed copy recompute", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-retry", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    const view = render(<App />);

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    });

    tauriMocks.syncPdfKitAnnotations.mockRejectedValueOnce(new Error("native write failed"));
    fireEvent.change(screen.getByLabelText("Selected annotation color"), {
      target: { value: "#9ed7ff" }
    });

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(2);
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativePdfKit).toMatchObject({
        status: "sync-failed",
        dirty: true,
        pendingOperation: "upsert",
        lastSyncError: "native write failed"
      });
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    });

    view.unmount();
    tauriMocks.syncPdfKitAnnotations.mockClear();

    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
      expect(tauriMocks.syncPdfKitAnnotations.mock.calls[0]?.[0].managedCopyPath).toBeUndefined();
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativePdfKit).toMatchObject({
        status: "upserted"
      });
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("dirty");
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("pendingOperation");
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("lastSyncError");
    });
  });

  it("persists failed PDFKit deletes for retry after the live annotation is removed", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-delete-retry", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    const view = render(<App />);

    await addEmbedPdfAreaAnnotation();

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    });

    tauriMocks.syncPdfKitAnnotations.mockRejectedValueOnce(new Error("native delete failed"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected annotation" }));

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(2);
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations).toHaveLength(0);
      expect(stored.sessions[0].pendingDeletedAnnotations).toHaveLength(1);
      expect(stored.sessions[0].pendingDeletedAnnotations?.[0].nativePdfKit).toMatchObject({
        status: "sync-failed",
        dirty: true,
        pendingOperation: "delete",
        lastSyncError: "native delete failed"
      });
      expect(stored.sessions[0].pendingDeletedAnnotations?.[0].nativePdfKit).not.toHaveProperty("managedCopyPath");
    });
    expect(screen.queryByText("Area annotation")).not.toBeInTheDocument();

    view.unmount();
    tauriMocks.syncPdfKitAnnotations.mockClear();

    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.syncPdfKitAnnotations).toHaveBeenCalledTimes(1);
      const retryRequest = tauriMocks.syncPdfKitAnnotations.mock.calls[0]?.[0];
      expect(retryRequest?.managedCopyPath).toBeUndefined();
      expect(retryRequest?.annotations).toEqual([
        expect.objectContaining({
          operation: "delete",
          kind: "area"
        })
      ]);
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations).toHaveLength(0);
      expect(stored.sessions[0].pendingDeletedAnnotations ?? []).toHaveLength(0);
    });
  });

  it("stores a desktop EPUB native anchor for text annotations", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);

    render(<App />);

    const chapterText = await screen.findByText("Native chapter body");
    const selectionNode = chapterText.firstChild ?? chapterText;
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: selectionNode,
      anchorOffset: 0,
      rangeCount: 1,
      getRangeAt: () => ({ collapsed: false }),
      toString: () => "Native chapter body"
    } as unknown as Selection);
    await screen.findByDisplayValue("Chapter One");
    fireEvent.mouseDown(screen.getByRole("button", { name: "Add annotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));

    await waitFor(() => {
      expect(tauriMocks.createEpubAnchor).toHaveBeenCalledWith({
        path: "/Users/mario/Books/story.epub",
        chapterHref: "OPS/chapter-1.xhtml",
        selectedText: "Native chapter body",
        cfiHint: expect.stringMatching(/^epubcfi\(/)
      });
    });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].location).toMatchObject({
        kind: "epub",
        cfi: expect.stringMatching(/^epubcfi\(/),
        anchor: expect.objectContaining({
          chapterHref: "OPS/chapter-1.xhtml",
          selectedText: "Native chapter body",
          anchorHash: "fnv1a64:anchor"
        })
      });
    });
    getSelectionSpy.mockRestore();
  });

  it("creates an EPUB native anchor for the selected duplicate text occurrence", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>repeat alpha repeat</p>",
      text: "repeat alpha repeat",
      resources: [] as EpubResourceMetadata[]
    });
    tauriMocks.createEpubAnchor.mockResolvedValueOnce({
      chapterHref: "OPS/chapter-1.xhtml",
      selectedText: "repeat",
      occurrenceIndex: 1,
      startOffset: 13,
      endOffset: 19,
      prefix: "repeat alpha ",
      suffix: "",
      textHash: "fnv1a64:text",
      anchorHash: "fnv1a64:duplicate",
      cfiHint: "epubcfi(/duplicate)"
    });

    render(<App />);

    await screen.findByText("repeat alpha repeat");
    const chapterText = document.querySelector(".epub-content p")!;
    const selectionNode = chapterText.firstChild ?? chapterText;
    const range = document.createRange();
    range.setStart(selectionNode, 13);
    range.setEnd(selectionNode, 19);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: selectionNode,
      anchorOffset: 13,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => "repeat"
    } as unknown as Selection);
    await screen.findByDisplayValue("Chapter One");

    fireEvent.mouseDown(screen.getByRole("button", { name: "Add annotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));

    await waitFor(() => {
      expect(tauriMocks.createEpubAnchor).toHaveBeenCalledWith({
        path: "/Users/mario/Books/story.epub",
        chapterHref: "OPS/chapter-1.xhtml",
        selectedText: "repeat",
        occurrenceIndex: 1,
        cfiHint: expect.stringMatching(/^epubcfi\(/)
      });
    });
    await waitFor(() => {
      const annotation = document.querySelector(".reader-annotation");
      expect(annotation?.textContent).toBe("repeat");
      expect(annotation?.previousSibling?.textContent).toBe("repeat alpha ");
    });
    getSelectionSpy.mockRestore();
  });

  it("persists visible EPUB fallback metadata when native anchor creation fails", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.createEpubAnchor.mockRejectedValueOnce(new Error("anchor create unavailable"));

    render(<App />);

    const chapterText = await screen.findByText("Native chapter body");
    const selectionNode = chapterText.firstChild ?? chapterText;
    const range = document.createRange();
    range.selectNodeContents(selectionNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: selectionNode,
      anchorOffset: 0,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => "Native chapter body"
    } as unknown as Selection);
    await screen.findByDisplayValue("Chapter One");

    fireEvent.mouseDown(screen.getByRole("button", { name: "Add annotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativeEpub).toMatchObject({
        supported: false,
        status: "fallback-text-match",
        reason: "anchor-create-failed",
        lastError: "anchor create unavailable"
      });
      const location = stored.sessions[0].annotations[0].location;
      expect(location.kind === "epub" ? location.anchor : undefined).toBeUndefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Annotations" }));
    expect(await screen.findByText("Native EPUB: fallback-text-match")).toBeInTheDocument();
    getSelectionSpy.mockRestore();
  });

  it("persists visible EPUB fallback metadata when native anchor resolve and rebind fail", async () => {
    tauriMocks.setPendingPaths([]);
    tauriMocks.resolveEpubAnchor.mockRejectedValueOnce(new Error("resolve failed"));
    tauriMocks.rebindEpubAnchor.mockRejectedValueOnce(new Error("rebind failed"));
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>repeat alpha repeat</p>",
      text: "repeat alpha repeat",
      resources: [] as EpubResourceMetadata[]
    });
    const snapshot = createSnapshot("epub-anchor-fallback", 1);
    snapshot.sessions[0] = {
      ...snapshot.sessions[0],
      title: "story.epub",
      filePath: "/Users/mario/Books/story.epub",
      fileSource: { kind: "desktop-path", path: "/Users/mario/Books/story.epub" },
      format: "epub",
      sidebarMode: "annotations",
      location: {
        kind: "epub",
        chapterHref: "OPS/chapter-1.xhtml",
        chapterLabel: "Chapter One",
        progress: 0
      },
      lastLocation: {
        kind: "epub",
        chapterHref: "OPS/chapter-1.xhtml",
        chapterLabel: "Chapter One",
        progress: 0
      },
      annotations: [
        {
          id: "annotation-repeat",
          type: "highlight",
          tag: "重点",
          color: "#ffe28a",
          thickness: 2,
          selectedText: "repeat",
          location: {
            kind: "epub",
            chapterHref: "OPS/chapter-1.xhtml",
            chapterLabel: "Chapter One",
            progress: 0,
            anchor: {
              chapterHref: "OPS/chapter-1.xhtml",
              selectedText: "repeat",
              occurrenceIndex: 1,
              startOffset: 13,
              endOffset: 19,
              prefix: "repeat alpha ",
              suffix: "",
              textHash: "fnv1a64:text",
              anchorHash: "fnv1a64:anchor"
            }
          },
          createdAt: 1,
          updatedAt: 2
        }
      ]
    };
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
      expect(stored.sessions[0].annotations[0].nativeEpub).toMatchObject({
        supported: false,
        status: "fallback-text-match",
        reason: "anchor-rebind-failed",
        lastError: "rebind failed"
      });
    });
    expect(await screen.findByText("Native EPUB: fallback-text-match")).toBeInTheDocument();
  });

  it("uses stored EPUB native anchors instead of the first duplicate selectedText match", async () => {
    tauriMocks.setPendingPaths([]);
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>repeat alpha repeat</p>",
      text: "repeat alpha repeat",
      resources: [] as EpubResourceMetadata[]
    });
    const snapshot = createSnapshot("epub-anchor-duplicate", 1);
    snapshot.sessions[0] = {
      ...snapshot.sessions[0],
      title: "story.epub",
      filePath: "/Users/mario/Books/story.epub",
      fileSource: { kind: "desktop-path", path: "/Users/mario/Books/story.epub" },
      format: "epub",
      location: {
        kind: "epub",
        chapterHref: "OPS/chapter-1.xhtml",
        chapterLabel: "Chapter One",
        progress: 0
      },
      lastLocation: {
        kind: "epub",
        chapterHref: "OPS/chapter-1.xhtml",
        chapterLabel: "Chapter One",
        progress: 0
      },
      annotations: [
        {
          id: "annotation-repeat",
          type: "highlight",
          tag: "重点",
          color: "#ffe28a",
          thickness: 2,
          selectedText: "repeat",
          location: {
            kind: "epub",
            chapterHref: "OPS/chapter-1.xhtml",
            chapterLabel: "Chapter One",
            progress: 0,
            anchor: {
              chapterHref: "OPS/chapter-1.xhtml",
              selectedText: "repeat",
              occurrenceIndex: 1,
              startOffset: 13,
              endOffset: 19,
              prefix: "repeat alpha ",
              suffix: "",
              textHash: "fnv1a64:text",
              anchorHash: "fnv1a64:anchor"
            }
          },
          createdAt: 1,
          updatedAt: 2
        }
      ]
    };
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await screen.findByText("repeat alpha");
    const annotation = document.querySelector(".reader-annotation");
    expect(annotation?.textContent).toBe("repeat");
    expect(annotation?.previousSibling?.textContent).toBe("repeat alpha ");
    expect(tauriMocks.resolveEpubAnchor).toHaveBeenCalledWith(
      "/Users/mario/Books/story.epub",
      expect.objectContaining({
        occurrenceIndex: 1,
        startOffset: 13
      })
    );
  });

  it("escapes Markdown-sensitive annotation export content", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("markdown-export", 1);
    snapshot.sessions[0].title = "Report\n# Injected <script>";
    snapshot.sessions[0].sidebarMode = "annotations";
    snapshot.sessions[0].annotations = [
      {
        id: "annotation-markdown",
        type: "note" as const,
        tag: "引用备注" as const,
        color: "#ffe28a",
        thickness: 2,
        location: {
          kind: "epub" as const,
          chapterHref: "OPS/chapter.xhtml#intro",
          chapterLabel: "Chapter\n# forged location <i>raw</i>",
          progress: 0.25
        },
        selectedText: "Quote\n- forged item <b>raw</b>",
        note: "Note\n## forged heading <img src=x>",
        hidden: false,
        createdAt: 1,
        updatedAt: 1
      }
    ];
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    const exportButton = await screen.findByRole("button", { name: "Export annotations" });
    fireEvent.click(exportButton);

    const exportedBlob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });

    expect(exportedText).toContain("# Report\\n\\# Injected &lt;script&gt; annotations");
    expect(exportedText).toContain("## 1. Note\\n\\#\\# forged heading &lt;img src=x&gt;");
    expect(exportedText).toContain("- Location: Chapter\\n\\# forged location &lt;i&gt;raw&lt;/i&gt;");
    expect(exportedText).toContain("- Selected text: Quote\\n\\- forged item &lt;b&gt;raw&lt;/b&gt;");
    expect(exportedText).toContain("- Note: Note\\n\\#\\# forged heading &lt;img src=x&gt;");
    expect(exportedText).not.toContain("\n# Injected <script>");
    expect(exportedText).not.toContain("\n# forged location <i>raw</i>");
    expect(exportedText).not.toContain("\n## forged heading <img src=x>");
  });

  it("creates unique annotation ids for annotations added in the same millisecond", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdfkit-unique-annotations", 1);
    snapshot.preferences.pdfKit.enabled = true;
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));
    vi.spyOn(Date, "now").mockReturnValue(10);

    render(<App />);

    await waitForStartPdfReader("spec.pdf reader");
    fireEvent.change(screen.getByLabelText("Annotation note"), {
      target: { value: "First note" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));
    fireEvent.change(screen.getByLabelText("Annotation note"), {
      target: { value: "Second note" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));

    const stored = JSON.parse(localStorage.getItem("smartreader.appSession.v1") ?? "{}") as AppSessionSnapshot;
    const ids = stored.sessions[0].annotations.map((annotation) => annotation.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("restores PDF annotations after restart and keeps management actions working", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdf-annotations", 1);
    snapshot.sessions[0].sidebarMode = "annotations";
    snapshot.sessions[0].annotations = [
      {
        id: "annotation-recovered",
        type: "note" as const,
        tag: "个人思考" as const,
        color: "#b7f7d4",
        thickness: 3,
        location: { kind: "page" as const, page: 2 },
        area: {
          page: 2,
          left: 80,
          top: 120,
          width: 180,
          height: 24,
          viewportHeight: 900,
          viewportScale: 1
        },
        note: "Recovered note",
        selectedText: "Recovered selection",
        hidden: false,
        createdAt: 1,
        updatedAt: 1
      }
    ];
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    expect(await screen.findByText("Recovered note")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export annotations" }));
    const exportedBlob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(exportedText).toContain("- Type: Note");
    expect(exportedText).toContain("- Tag: 个人思考");
    expect(exportedText).toContain("- Note: Recovered note");

    fireEvent.click(screen.getByRole("button", { name: "Hide all annotations" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all annotations" }));

    fireEvent.click(screen.getByText("Recovered note").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Page 2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation Recovered note" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete annotation Recovered note" }));
    expect(screen.queryByText("Recovered note")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem("smartreader.appSession.v1")).not.toContain("Recovered note");
    });
  });

  it("windows large annotation sidebars without dropping annotation state", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("pdf-annotations", 1);
    snapshot.sessions[0].sidebarMode = "annotations";
    snapshot.sessions[0].annotations = Array.from({ length: 10000 }, (_, index) => ({
      id: `annotation-${index}`,
      type: "highlight" as const,
      tag: "重点" as const,
      color: "#ffe28a",
      thickness: 2,
      location: { kind: "page" as const, page: (index % 2) + 1 },
      note: `Annotation ${index}`,
      hidden: false,
      createdAt: index,
      updatedAt: index
    }));
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await screen.findByText("Annotation 0");
    expect(screen.queryByText("Annotation 9700")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".annotation-row").length).toBeLessThan(200);

    const sidebarContent = document.querySelector(".sidebar-content");
    expect(sidebarContent).toBeInstanceOf(HTMLElement);
    Object.defineProperty(sidebarContent, "clientHeight", {
      configurable: true,
      value: 420
    });
    Object.defineProperty(sidebarContent, "scrollTop", {
      configurable: true,
      writable: true,
      value: 9700 * 82
    });

    fireEvent.scroll(sidebarContent as HTMLElement);

    await screen.findByText("Annotation 9700");
    expect(screen.queryByText("Annotation 0")).not.toBeInTheDocument();
  });

  it("shows no-result search feedback without moving the current location", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.searchEpubDocument.mockResolvedValueOnce([]);

    render(<App />);

    await screen.findByText("Native chapter body");
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "missing" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    expect(await screen.findByText("No results")).toBeInTheDocument();
    expect(tauriMocks.searchEpubDocument).toHaveBeenCalledWith("/Users/mario/Books/story.epub", "missing");
    expect(screen.getByDisplayValue("Chapter One")).toBeInTheDocument();
  });

  it("does not render the legacy SmartReader PDF thumbnail sidebar", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/start.pdf"]);
    tauriMocks.openPdfDocument.mockResolvedValueOnce({
      id: "/Users/mario/Books/start.pdf",
      pageCount: 40,
      outline: []
    });

    render(<App />);

    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
    });
    expect(screen.getByLabelText("start.pdf reader")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Thumbnails" })).not.toBeInTheDocument();
    expect(document.querySelector(".thumbnail-row")).not.toBeInTheDocument();
  });

  it("keeps large PDF thumbnail navigation inside EmbedPDF", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/large-thumbnails.pdf"]);
    tauriMocks.openPdfDocument.mockResolvedValueOnce({
      id: "/Users/mario/Books/large-thumbnails.pdf",
      pageCount: 10000,
      outline: []
    });

    render(<App />);

    await screen.findByLabelText("large-thumbnails.pdf reader");
    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
      expect(tauriMocks.openPdfDocument).toHaveBeenCalledWith("/Users/mario/Books/large-thumbnails.pdf");
    });
    expect(screen.queryByRole("navigation", { name: "Document navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Page 9700" })).not.toBeInTheDocument();
    expect(document.querySelector(".thumbnail-row")).not.toBeInTheDocument();
  });

  it("windows large search result sidebars without limiting search results", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.searchEpubDocument.mockResolvedValueOnce(
      Array.from({ length: 10000 }, (_, index) => ({
        id: `search-result-${index}`,
        label: "Chapter One",
        snippet: `Snippet ${index}`,
        href: "OPS/chapter-1.xhtml",
        index: 0,
        progress: 0
      }))
    );

    render(<App />);

    await screen.findByText("Native chapter body");
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "needle" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    await screen.findByText("1 / 10000");
    expect(screen.queryByRole("button", { name: /Chapter One, result 9701: Snippet 9700/ })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".search-result-row").length).toBeLessThan(200);

    const sidebarContent = document.querySelector(".sidebar-content");
    expect(sidebarContent).toBeInstanceOf(HTMLElement);
    Object.defineProperty(sidebarContent, "clientHeight", {
      configurable: true,
      value: 420
    });
    Object.defineProperty(sidebarContent, "scrollTop", {
      configurable: true,
      writable: true,
      value: 562600
    });

    fireEvent.scroll(sidebarContent as HTMLElement);

    await screen.findByRole("button", { name: /Chapter One, result 9701: Snippet 9700/ });
    expect(screen.queryByRole("button", { name: /Chapter One, result 1: Snippet 0/ })).not.toBeInTheDocument();
  });

  it("restores and saves EPUB chapter scroll location", async () => {
    tauriMocks.setPendingPaths([]);
    localStorage.setItem(
      "smartreader.appSession.v1",
      JSON.stringify({
        version: 1,
        activeTabId: "epub-1",
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
        sessions: [
          {
            id: "epub-1",
            title: "story.epub",
            filePath: "/Users/mario/Books/story.epub",
            fileSource: { kind: "desktop-path", path: "/Users/mario/Books/story.epub" },
            format: "epub",
            status: "ready",
            location: {
              kind: "epub",
              chapterHref: "OPS/chapter-2.xhtml",
              chapterLabel: "Chapter Two",
              progress: 1,
              scrollTop: 240
            },
            lastLocation: {
              kind: "epub",
              chapterHref: "OPS/chapter-2.xhtml",
              chapterLabel: "Chapter Two",
              progress: 1,
              scrollTop: 240
            },
            zoom: 1,
            fitMode: "continuous",
            sidebarMode: "contents",
            bookmarks: [],
            epubSettings: { fontSize: 18, theme: "system" },
            openedAt: 1,
            updatedAt: 2
          }
        ]
      })
    );
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.readEpubChapter).toHaveBeenCalledWith("/Users/mario/Books/story.epub", "OPS/chapter-2.xhtml");
    });
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 240 });
    });

    const reader = await screen.findByLabelText("story.epub reader");
    Object.defineProperty(reader, "scrollTop", {
      configurable: true,
      writable: true,
      value: 360
    });
    fireEvent.scroll(reader);

    await waitFor(() => {
      expect(screen.getAllByText("Chapter Two").length).toBeGreaterThan(0);
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });
    expect(localStorage.getItem("smartreader.appSession.v1")).toContain("\"scrollTop\":360");
  });

  it("debounces high-frequency EPUB scroll persistence while keeping the final scrollTop", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);

    render(<App />);

    await screen.findByText("Native chapter body");
    const reader = await screen.findByLabelText("story.epub reader");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setItemSpy.mockClear();

    vi.useFakeTimers();
    try {
      for (let index = 0; index < 10; index += 1) {
        Object.defineProperty(reader, "scrollTop", {
          configurable: true,
          writable: true,
          value: 300 + index
        });
        fireEvent.scroll(reader);
      }

      const sessionWrites = () =>
        setItemSpy.mock.calls.filter(([key]) => key === "smartreader.appSession.v1");

      expect(sessionWrites()).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(249);
      });

      expect(sessionWrites()).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(sessionWrites()).toHaveLength(1);
      expect(localStorage.getItem("smartreader.appSession.v1")).toContain("\"scrollTop\":309");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps EPUB visual highlights capacity-safe for a large common-word chapter", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: `<p>${Array.from({ length: 1000 }, () => "the").join(" ")}</p>`,
      text: Array.from({ length: 1000 }, () => "the").join(" "),
      resources: [] as EpubResourceMetadata[]
    });
    tauriMocks.searchEpubDocument.mockResolvedValueOnce([
      {
        id: "search-chapter-1-common",
        label: "Chapter One",
        snippet: "the",
        href: "OPS/chapter-1.xhtml",
        index: 0,
        progress: 0
      }
    ]);

    render(<App />);

    await screen.findByText(/the the the/);
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "the" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    await screen.findByText("1 / 1");

    const marks = document.querySelectorAll(".epub-content mark.search-highlight");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveClass("current");
  });

  it("does not rebuild EPUB highlighted HTML for unrelated renders", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>Needle chapter body needle.</p>",
      text: "Needle chapter body needle.",
      resources: [] as EpubResourceMetadata[]
    });
    tauriMocks.searchEpubDocument.mockResolvedValueOnce([
      {
        id: "search-chapter-1-needle",
        label: "Chapter One",
        snippet: "needle",
        href: "OPS/chapter-1.xhtml",
        index: 0,
        progress: 0
      }
    ]);
    const parseSpy = vi.spyOn(DOMParser.prototype, "parseFromString");

    render(<App />);

    await screen.findByText(/Needle chapter body/);
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "needle" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    await screen.findByText("1 / 1");
    expect(parseSpy).toHaveBeenCalled();
    parseSpy.mockClear();

    fireEvent.click(screen.getByLabelText("More"));

    expect(await screen.findByRole("dialog", { name: "Preferences" })).toBeInTheDocument();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("does not parse unchanged EPUB chapter HTML without search or text annotations", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    const parseSpy = vi.spyOn(DOMParser.prototype, "parseFromString");

    render(<App />);

    await screen.findByText(/Native chapter body/);
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("moves the single EPUB current highlight to the selected same-chapter occurrence", async () => {
    tauriMocks.setPendingPaths(["/Users/mario/Books/story.epub"]);
    tauriMocks.readEpubChapter.mockResolvedValueOnce({
      id: "chapter-1",
      href: "OPS/chapter-1.xhtml",
      label: "Chapter One",
      index: 0,
      sanitizedHtml: "<p>first needle then second needle.</p>",
      text: "first needle then second needle.",
      resources: [] as EpubResourceMetadata[]
    });
    tauriMocks.searchEpubDocument.mockResolvedValueOnce([
      {
        id: "search-chapter-1-first",
        label: "Chapter One",
        snippet: "first needle",
        href: "OPS/chapter-1.xhtml",
        index: 0,
        progress: 0
      },
      {
        id: "search-chapter-1-second",
        label: "Chapter One",
        snippet: "second needle",
        href: "OPS/chapter-1.xhtml",
        index: 0,
        progress: 0
      }
    ]);

    render(<App />);

    await screen.findByText(/first needle then second needle/);
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), {
      target: { value: "needle" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Find" }).at(-1)!);

    await screen.findByText("1 / 2");
    expect(document.querySelector(".epub-content")?.innerHTML).toContain("first <mark");
    expect(document.querySelector(".epub-content")?.innerHTML).toContain("</mark> then second needle");

    fireEvent.click(screen.getByLabelText("Next result"));

    await screen.findByText("2 / 2");
    expect(document.querySelectorAll(".epub-content mark.search-highlight.current")).toHaveLength(1);
    expect(document.querySelector(".epub-content")?.innerHTML).toContain("first needle then second <mark");
  });

  it("does not reset a persisted PDF fit preference when EPUB preferences change", async () => {
    tauriMocks.setPendingPaths([]);
    const snapshot = createSnapshot("manual-fit", 1);
    snapshot.sessions[0].fitMode = "fit-width";
    snapshot.preferences.defaultPdfFitMode = "fit-width";
    localStorage.setItem("smartreader.appSession.v1", JSON.stringify(snapshot));

    render(<App />);

    await waitForStartPdfReader("spec.pdf reader");
    expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.zoom.defaultZoomLevel).toBe("fit-width");

    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.change(await screen.findByLabelText("EPUB font size"), {
      target: { value: "22" }
    });

    await waitFor(() => {
      expect(embedPdfMocks.PDFViewer.mock.calls.at(-1)?.[0].config.zoom.defaultZoomLevel).toBe("fit-width");
    });
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
                location: document.location,
                matchIndex: found.length,
                matchOffset: index
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

async function selectEmbedPdfText(options: {
  text?: string[];
  selection?: Parameters<typeof embedPdfMocks.setFormattedSelection>[0];
} = {}) {
  if (options.text) {
    embedPdfMocks.setSelectedText(options.text);
  }
  if (options.selection) {
    embedPdfMocks.setFormattedSelection(options.selection);
  }

  const viewer = await screen.findByTestId("embedpdf-viewer");
  await waitFor(() => {
    expect(embedPdfMocks.selectionCapability.onEndSelection).toHaveBeenCalled();
  });
  fireEvent.pointerUp(viewer, { clientX: 180, clientY: 210 });

  await act(async () => {
    embedPdfMocks.emitSelectionChange();
    embedPdfMocks.emitEndSelection();
  });
}

async function waitForStartPdfReader(label = "start.pdf reader") {
  await screen.findByLabelText(label);
  await waitFor(() => {
    expect(embedPdfMocks.PDFViewer).toHaveBeenCalled();
  });
  await act(async () => undefined);
}

function submitPageLocation(page: number) {
  const locationInput = screen.getByLabelText("Page or location");
  fireEvent.change(locationInput, {
    target: { value: String(page) }
  });
  fireEvent.submit(locationInput.closest("form")!);
}

async function addEmbedPdfAreaAnnotation() {
  await selectEmbedPdfText();
  fireEvent.change(screen.getByLabelText("Annotation type"), {
    target: { value: "area" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));
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
    annotations: [],
    pageCount: 100,
    epubSettings: {
      fontSize: 18,
      theme: "system"
    },
    openedAt: 1,
    updatedAt: 2
  };
}
