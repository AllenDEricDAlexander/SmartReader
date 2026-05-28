import { useState } from "react";
import type { FitMode, Preferences } from "../types/reader";

export type CachePathSource = "default" | "custom";

export interface CacheInfo {
  activePath: string;
  defaultPath: string;
  customPath?: string;
  source: CachePathSource;
}

export interface CacheStatus {
  state: "idle" | "loading" | "success" | "error" | "pending";
  operation?: "location" | "export" | "import" | "apply";
  message?: string;
  pendingImportName?: string;
  pendingImportPath?: string;
}

export interface ShortcutPreference {
  id: string;
  command: string;
  shortcut: string;
  enabled: boolean;
  editable?: boolean;
}

export interface ShortcutConflict {
  shortcut: string;
  commandIds: string[];
  message?: string;
}

export interface WasmPreferences {
  settings: {
    enabled: boolean;
  };
  status: {
    enabled: boolean;
    adapterStatus: "ready" | "loading" | "fallback" | "unavailable" | "error";
    fallbackActive: boolean;
    message?: string;
  };
}

export interface CacheActionOptions {
  moveExisting: boolean;
}

export interface PreferencesDialogProps {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
  onClearRecent: () => void;
  cacheInfo: CacheInfo;
  cacheStatus: CacheStatus;
  onChooseCacheDirectory: (options: CacheActionOptions) => void | Promise<void>;
  onResetCacheDirectory: () => void | Promise<void>;
  onExportCache: () => void | Promise<void>;
  onImportCache: () => void | Promise<void>;
  onApplyImportedCache: (options: CacheActionOptions) => void | Promise<void>;
  shortcuts: ShortcutPreference[];
  conflicts?: ShortcutConflict[];
  onShortcutChange?: (id: string, shortcut: string) => void;
  onShortcutReset?: (id: string) => void;
  wasm: WasmPreferences;
  onToggleWasm: (enabled: boolean) => void;
  onTogglePdfKit: (enabled: boolean) => void;
}

export function PreferencesDialog(props: PreferencesDialogProps) {
  const [moveExisting, setMoveExisting] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const hasPendingImport =
    props.cacheStatus.state !== "error" &&
    Boolean(props.cacheStatus.pendingImportName || props.cacheStatus.pendingImportPath);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="preferences-dialog preferences-dialog-expanded"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h1 id="preferences-title">Preferences</h1>
          <button type="button" aria-label="Close preferences" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="preferences-grid">
          <GeneralPreferences preferences={props.preferences} onChange={props.onChange} />
          <ReadingPreferences preferences={props.preferences} onChange={props.onChange} />
          <CachePreferences
            cacheInfo={props.cacheInfo}
            cacheStatus={props.cacheStatus}
            moveExisting={moveExisting}
            confirmingImport={confirmingImport}
            hasPendingImport={hasPendingImport}
            onMoveExistingChange={setMoveExisting}
            onChooseCacheDirectory={() => props.onChooseCacheDirectory({ moveExisting })}
            onResetCacheDirectory={props.onResetCacheDirectory}
            onExportCache={props.onExportCache}
            onImportCache={() => {
              if (!confirmingImport) {
                setConfirmingImport(true);
                return;
              }

              setConfirmingImport(false);
              props.onImportCache();
            }}
            onCancelImport={() => setConfirmingImport(false)}
            onApplyImportedCache={() => props.onApplyImportedCache({ moveExisting })}
          />
          <ShortcutsPreferences
            shortcuts={props.shortcuts}
            conflicts={props.conflicts ?? []}
            onShortcutChange={props.onShortcutChange}
            onShortcutReset={props.onShortcutReset}
          />
          <AdvancedPreferences
            wasm={props.wasm}
            pdfKitEnabled={props.preferences.pdfKit.enabled}
            onToggleWasm={props.onToggleWasm}
            onTogglePdfKit={props.onTogglePdfKit}
          />
          <fieldset className="preferences-section preferences-section-compact">
            <legend>Recent</legend>
            <label>
              Recent retention
              <input
                type="number"
                min="4"
                max="30"
                value={props.preferences.recentRetention}
                onChange={(event) =>
                  props.onChange({ ...props.preferences, recentRetention: Number(event.currentTarget.value) })
                }
              />
            </label>
            <button type="button" onClick={props.onClearRecent}>
              Clear recent files
            </button>
          </fieldset>
        </div>
      </section>
    </div>
  );
}

function GeneralPreferences(props: {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
}) {
  return (
    <fieldset className="preferences-section preferences-section-compact">
      <legend>General</legend>
      <label>
        <input
          type="checkbox"
          checked={props.preferences.reopenLastSession}
          onChange={(event) =>
            props.onChange({ ...props.preferences, reopenLastSession: event.currentTarget.checked })
          }
        />
        Reopen last session
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.preferences.rememberPosition}
          onChange={(event) =>
            props.onChange({ ...props.preferences, rememberPosition: event.currentTarget.checked })
          }
        />
        Remember position
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.preferences.defaultSidebarVisible}
          onChange={(event) =>
            props.onChange({ ...props.preferences, defaultSidebarVisible: event.currentTarget.checked })
          }
        />
        Show sidebar by default
      </label>
    </fieldset>
  );
}

function ReadingPreferences(props: {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
}) {
  return (
    <fieldset className="preferences-section preferences-section-compact">
      <legend>Reading</legend>
      <label>
        PDF default fit
        <select
          value={props.preferences.defaultPdfFitMode}
          onChange={(event) =>
            props.onChange({ ...props.preferences, defaultPdfFitMode: event.currentTarget.value as FitMode })
          }
        >
          <option value="continuous">Continuous</option>
          <option value="single">Single</option>
          <option value="fit-width">Fit Width</option>
          <option value="fit-page">Fit Page</option>
          <option value="actual-size">Actual Size</option>
        </select>
      </label>
      <label>
        EPUB font size
        <input
          type="number"
          min="14"
          max="28"
          value={props.preferences.epubFontSize}
          onChange={(event) =>
            props.onChange({ ...props.preferences, epubFontSize: Number(event.currentTarget.value) })
          }
        />
      </label>
      <label>
        EPUB theme
        <select
          value={props.preferences.epubTheme}
          onChange={(event) =>
            props.onChange({ ...props.preferences, epubTheme: event.currentTarget.value as Preferences["epubTheme"] })
          }
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </fieldset>
  );
}

function CachePreferences(props: {
  cacheInfo: CacheInfo;
  cacheStatus: CacheStatus;
  moveExisting: boolean;
  confirmingImport: boolean;
  hasPendingImport: boolean;
  onMoveExistingChange: (enabled: boolean) => void;
  onChooseCacheDirectory: () => void;
  onResetCacheDirectory: () => void | Promise<void>;
  onExportCache: () => void | Promise<void>;
  onImportCache: () => void;
  onCancelImport: () => void;
  onApplyImportedCache: () => void;
}) {
  return (
    <fieldset className="preferences-section preferences-section-wide">
      <legend>Cache</legend>
      <div className="cache-paths">
        <PathRow label="Active" value={props.cacheInfo.activePath} />
        <PathRow label="Default" value={props.cacheInfo.defaultPath} />
        <PathRow label="Custom" value={props.cacheInfo.customPath ?? "Not set"} muted={!props.cacheInfo.customPath} />
      </div>
      <label>
        <input
          type="checkbox"
          checked={props.moveExisting}
          onChange={(event) => props.onMoveExistingChange(event.currentTarget.checked)}
        />
        Move existing cache data
      </label>
      <div className="preferences-actions">
        <button type="button" onClick={props.onChooseCacheDirectory}>
          Choose Directory
        </button>
        <button type="button" disabled={props.cacheInfo.source === "default"} onClick={props.onResetCacheDirectory}>
          Reset
        </button>
        <button type="button" onClick={props.onExportCache}>
          Export
        </button>
        <button type="button" onClick={props.onImportCache}>
          {props.confirmingImport ? "Confirm Import" : "Import"}
        </button>
      </div>
      {props.confirmingImport ? (
        <div className="cache-confirm" role="status">
          <strong>Confirm cache import</strong>
          <span>Importing a cache archive can replace indexed metadata after parent validation.</span>
          <button type="button" onClick={props.onCancelImport}>
            Cancel
          </button>
        </div>
      ) : null}
      {props.hasPendingImport ? (
        <div className="cache-pending" role="status">
          <strong>{props.cacheStatus.pendingImportName ?? "Imported cache ready"}</strong>
          {props.cacheStatus.pendingImportPath ? <span>{props.cacheStatus.pendingImportPath}</span> : null}
          <button type="button" onClick={props.onApplyImportedCache}>
            Apply Imported Cache
          </button>
        </div>
      ) : null}
      <StatusMessage status={props.cacheStatus} />
    </fieldset>
  );
}

function PathRow(props: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="cache-path-row">
      <span>{props.label}</span>
      <code className={props.muted ? "muted-path" : ""}>{props.value}</code>
    </div>
  );
}

function ShortcutsPreferences(props: {
  shortcuts: ShortcutPreference[];
  conflicts: ShortcutConflict[];
  onShortcutChange?: (id: string, shortcut: string) => void;
  onShortcutReset?: (id: string) => void;
}) {
  return (
    <fieldset className="preferences-section preferences-section-wide">
      <legend>Shortcuts</legend>
      <div className="shortcut-list">
        {props.shortcuts.map((shortcut) => {
          const conflict = props.conflicts.find((item) =>
            item.commandIds.includes(shortcut.id) || item.shortcut === shortcut.shortcut
          );
          const canEdit = Boolean(shortcut.editable && props.onShortcutChange);

          return (
            <div key={shortcut.id} className={`shortcut-row ${conflict ? "has-conflict" : ""}`}>
              <div className="shortcut-command">
                <strong>{shortcut.command}</strong>
                <span>{shortcut.enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <input
                aria-label={`Shortcut for ${shortcut.command}`}
                value={shortcut.shortcut}
                readOnly={!canEdit}
                disabled={!canEdit}
                onChange={(event) => props.onShortcutChange?.(shortcut.id, event.currentTarget.value)}
              />
              <button
                type="button"
                aria-label={`Reset shortcut for ${shortcut.command}`}
                disabled={!props.onShortcutReset}
                onClick={() => props.onShortcutReset?.(shortcut.id)}
              >
                Reset
              </button>
              {conflict ? (
                <p className="shortcut-conflict">
                  {conflict.message ?? `${conflict.shortcut} is assigned to multiple commands.`}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function AdvancedPreferences(props: {
  wasm: WasmPreferences;
  pdfKitEnabled: boolean;
  onToggleWasm: (enabled: boolean) => void;
  onTogglePdfKit: (enabled: boolean) => void;
}) {
  const adapterStatus = visibleWasmAdapterStatus(props.wasm.status);

  return (
    <fieldset className="preferences-section preferences-section-compact">
      <legend>Advanced</legend>
      <label>
        <input
          type="checkbox"
          checked={props.wasm.settings.enabled}
          onChange={(event) => props.onToggleWasm(event.currentTarget.checked)}
        />
        Enable WASM adapter
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.pdfKitEnabled}
          onChange={(event) => props.onTogglePdfKit(event.currentTarget.checked)}
        />
        Enable native PDFKit annotation copy
      </label>
      <div className="advanced-status-grid">
        <StatusPair label="Enabled" value={props.wasm.status.enabled ? "Yes" : "No"} />
        <StatusPair label="Adapter" value={statusLabel(adapterStatus)} />
        <StatusPair label="Fallback" value={props.wasm.status.fallbackActive ? "Active" : "Inactive"} />
      </div>
      {props.wasm.status.message ? <p>{props.wasm.status.message}</p> : null}
    </fieldset>
  );
}

function StatusPair(props: { label: string; value: string }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function StatusMessage(props: { status: CacheStatus }) {
  if (props.status.state === "idle" && !props.status.message) {
    return null;
  }

  const view = cacheStatusView(props.status);

  return (
    <div className={`preferences-status ${view.tone}`} role="status">
      <strong>{view.title}</strong>
      {view.message ? <span>{view.message}</span> : null}
    </div>
  );
}

function cacheStatusView(status: CacheStatus): { title: string; message?: string; tone: CacheStatus["state"] } {
  const hasPendingImport = Boolean(status.pendingImportName || status.pendingImportPath);
  const message = status.message;

  if (status.state === "loading") {
    return { title: "Cache working", message, tone: status.state };
  }

  if (status.state === "error") {
    if (status.operation === "import" || hasPendingImport || message?.toLowerCase().includes("import")) {
      return { title: "Cache import failed", message, tone: status.state };
    }

    if (status.operation === "export" || message?.toLowerCase().includes("export")) {
      return { title: "Cache export failed", message, tone: status.state };
    }

    if (status.operation === "location" || message?.toLowerCase().includes("location")) {
      return { title: "Cache location failed", message, tone: status.state };
    }

    return { title: "Cache action failed", message, tone: status.state };
  }

  if (status.state === "pending" || hasPendingImport) {
    return { title: "Import pending", message, tone: "pending" };
  }

  if (status.operation === "apply" || message?.toLowerCase().includes("applied")) {
    return { title: "Cache applied", message, tone: status.state };
  }

  if (status.operation === "export" || message?.toLowerCase().includes("exported")) {
    return { title: "Cache exported", message, tone: status.state };
  }

  if (status.operation === "location") {
    return { title: "Cache location updated", message, tone: status.state };
  }

  return { title: statusLabel(status.state), message, tone: status.state };
}

function visibleWasmAdapterStatus(status: WasmPreferences["status"]): WasmPreferences["status"]["adapterStatus"] {
  if (status.adapterStatus === "error" || status.adapterStatus === "unavailable") {
    return status.adapterStatus;
  }

  if (status.fallbackActive || status.adapterStatus === "fallback") {
    return "fallback";
  }

  if (!status.enabled) {
    return "unavailable";
  }

  return status.adapterStatus;
}

function statusLabel(status: string): string {
  return status
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
