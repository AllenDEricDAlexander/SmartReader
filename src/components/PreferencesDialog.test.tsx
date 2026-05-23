import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesDialog } from "./PreferencesDialog";
import type { PreferencesDialogProps } from "./PreferencesDialog";

const preferences: PreferencesDialogProps["preferences"] = {
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
  wasm: { enabled: true }
};

function renderDialog(overrides: Partial<PreferencesDialogProps> = {}) {
  const props: PreferencesDialogProps = {
    preferences,
    onChange: vi.fn(),
    onClose: vi.fn(),
    onClearRecent: vi.fn(),
    cacheInfo: {
      activePath: "/Users/mario/Library/Application Support/SmartReader/cache",
      defaultPath: "/Users/mario/Library/Application Support/SmartReader/cache",
      customPath: "/Volumes/ReaderCache",
      source: "custom"
    },
    cacheStatus: {
      state: "idle"
    },
    onChooseCacheDirectory: vi.fn(),
    onResetCacheDirectory: vi.fn(),
    onExportCache: vi.fn(),
    onImportCache: vi.fn(),
    onApplyImportedCache: vi.fn(),
    shortcuts: [
      {
        id: "file.open",
        command: "Open File",
        shortcut: "Meta+O",
        enabled: true,
        editable: true
      },
      {
        id: "find.open",
        command: "Find",
        shortcut: "Meta+O",
        enabled: false,
        editable: true
      }
    ],
    conflicts: [
      {
        shortcut: "Meta+O",
        commandIds: ["file.open", "find.open"],
        message: "Meta+O is already assigned."
      }
    ],
    onShortcutChange: vi.fn(),
    onShortcutReset: vi.fn(),
    wasm: {
      settings: {
        enabled: true
      },
      status: {
        enabled: true,
        adapterStatus: "ready",
        fallbackActive: false,
        message: "Native adapter is active."
      }
    },
    onToggleWasm: vi.fn(),
    ...overrides
  };

  render(<PreferencesDialog {...props} />);
  return props;
}

describe("PreferencesDialog", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders preference sections and routes cache directory changes with move-existing state", () => {
    const props = renderDialog();

    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("Cache")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("/Volumes/ReaderCache")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Move existing cache data"));
    fireEvent.click(screen.getByRole("button", { name: "Choose Directory" }));

    expect(props.onChooseCacheDirectory).toHaveBeenCalledWith({ moveExisting: true });
  });

  it("confirms cache import before invoking the import callback and applies staged imports separately", () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByText("Confirm cache import")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
    expect(props.onImportCache).toHaveBeenCalledTimes(1);

    cleanup();
    const stagedProps = renderDialog({
      cacheStatus: {
        state: "success",
        message: "Cache archive validated.",
        pendingImportName: "smartreader-cache.zip",
        pendingImportPath: "/Users/mario/Downloads/smartreader-cache.zip"
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply Imported Cache" }));
    expect(stagedProps.onApplyImportedCache).toHaveBeenCalledWith({ moveExisting: false });
  });

  it("shows import failures as failed and does not expose apply for failed imports", () => {
    renderDialog({
      cacheStatus: {
        state: "error",
        message: "Cache import is invalid.",
        pendingImportName: "broken-cache.zip",
        pendingImportPath: "/Users/mario/Downloads/broken-cache.zip"
      }
    });

    expect(screen.getByText("Cache import failed")).toBeInTheDocument();
    expect(screen.getByText("Cache import is invalid.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply Imported Cache" })).not.toBeInTheDocument();
  });

  it("separates validated pending imports from applied imports", () => {
    renderDialog({
      cacheStatus: {
        state: "success",
        message: "Cache archive validated.",
        pendingImportName: "smartreader-cache.zip",
        pendingImportPath: "/Users/mario/Downloads/smartreader-cache.zip"
      }
    });

    expect(screen.getByText("Import pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Imported Cache" })).toBeInTheDocument();

    cleanup();
    renderDialog({
      cacheStatus: {
        state: "success",
        message: "Imported cache applied."
      }
    });

    expect(screen.getByText("Cache applied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply Imported Cache" })).not.toBeInTheDocument();
  });

  it("renders fallback, unavailable, and error WASM states without labeling them ready", () => {
    renderDialog({
      wasm: {
        settings: { enabled: true },
        status: {
          enabled: true,
          adapterStatus: "ready",
          fallbackActive: true,
          message: "WASM adapter shell is available; fallback adapters stay active."
        }
      }
    });

    expect(screen.getAllByText("Fallback")).not.toHaveLength(0);
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();

    cleanup();
    renderDialog({
      wasm: {
        settings: { enabled: true },
        status: {
          enabled: false,
          adapterStatus: "unavailable",
          fallbackActive: true,
          message: "WASM is unavailable in this runtime."
        }
      }
    });

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();

    cleanup();
    renderDialog({
      wasm: {
        settings: { enabled: true },
        status: {
          enabled: false,
          adapterStatus: "error",
          fallbackActive: true,
          message: "WASM adapter failed to initialize."
        }
      }
    });

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("shows shortcut enabled state, conflict hints, and controlled edit callbacks", () => {
    const props = renderDialog();

    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getAllByText("Meta+O is already assigned.")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Shortcut for Open File"), {
      target: { value: "Meta+Shift+O" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset shortcut for Open File" }));

    expect(props.onShortcutChange).toHaveBeenCalledWith("file.open", "Meta+Shift+O");
    expect(props.onShortcutReset).toHaveBeenCalledWith("file.open");
  });
});
