# SmartReader PDF Reader MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 SmartReader desktop PDF reader MVP with React, TypeScript, Bun, Tauri v2, `@react-pdf-viewer`, and SQLite-backed session persistence.

**Architecture:** The app is a Tauri desktop shell with a React reader UI. PDF rendering and plugin-level search/navigation/zoom are isolated behind `src/viewer/PdfViewerBridge.tsx`; SmartReader owns document sessions, tabs, recent files, commands, cache lifecycles, and SQLite persistence through explicit Rust commands.

**Tech Stack:** Bun, Vite, React 18, TypeScript, Vitest, Tauri v2, Rust, rusqlite, `@react-pdf-viewer@3.12.0`, `pdfjs-dist@3.11.174`, lucide-react.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md`.

Included:

- project scaffold
- core state model
- command registry
- runtime byte and Blob URL cache
- SQLite schema and Rust persistence commands
- Tauri file open/read/validation commands
- reader shell layout
- `@react-pdf-viewer` integration
- local file picker, drag-drop, and native dialog open
- search, page navigation, and zoom command wiring
- recent files
- desktop-path session restore
- default shortcuts and keyboard listener wiring
- typecheck, unit tests, Rust tests, and production build validation

Deferred to later plans:

- full bookmarks UI and persistence
- full annotations/highlight UI and persistence
- Open With event handling
- PDF file association
- disk cache eviction policy
- shortcut editing and conflict UI
- trackpad pinch zoom polish

## External Facts To Re-check During Execution

- `@react-pdf-viewer/core` current npm version checked during planning: `3.12.0`.
- `@react-pdf-viewer/core@3.12.0` peer dependency accepts `pdfjs-dist` `^2.16.105 || ^3.0.279`; use `pdfjs-dist@3.11.174`, not the current 6.x release.
- `@react-pdf-viewer/core` npm license field points to `https://react-pdf-viewer.dev/license`; confirm the user accepts the license before implementation continues past dependency install.
- Tauri versions checked during planning: `@tauri-apps/api@2.11.0`, `@tauri-apps/cli@2.11.2`, Rust crate `tauri@2.11.2`, `tauri-plugin-dialog@2.7.1`, `tauri-plugin-fs@2.5.1`, `tauri-plugin-single-instance@2.4.2`.
- The npm package `@tauri-apps/plugin-single-instance` does not exist; single-instance/Open With handling is deferred to a later plan and should use the Rust crate path.

## Target File Structure

Create this structure during implementation:

```text
.
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.setup.ts
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── App.test.tsx
│   │   └── styles.css
│   ├── cache/
│   │   ├── blobUrlCache.ts
│   │   └── blobUrlCache.test.ts
│   ├── commands/
│   │   ├── commandRegistry.ts
│   │   └── commandRegistry.test.ts
│   │   ├── shortcutController.ts
│   │   └── shortcutController.test.ts
│   ├── documents/
│   │   ├── documentModels.ts
│   │   ├── documentSessionStore.ts
│   │   ├── documentSessionStore.test.ts
│   │   ├── readingHistory.ts
│   │   └── readingHistory.test.ts
│   ├── library/
│   │   ├── recentFiles.ts
│   │   └── recentFiles.test.ts
│   ├── persistence/
│   │   ├── persistenceApi.ts
│   │   └── persistenceApi.test.ts
│   ├── platform/
│   │   ├── dropZone.ts
│   │   ├── dropZone.test.ts
│   │   ├── fileSource.ts
│   │   ├── tauriBridge.ts
│   │   └── tauriBridge.test.ts
│   ├── test/
│   │   └── fixtures.ts
│   ├── viewer/
│   │   ├── viewerController.ts
│   │   ├── viewerController.test.ts
│   │   ├── PdfViewerBridge.tsx
│   │   ├── PdfViewerBridge.test.tsx
│   │   └── viewerTypes.ts
│   └── vite-env.d.ts
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    └── src/
        ├── db.rs
        ├── file_commands.rs
        ├── lib.rs
        ├── main.rs
        └── migrations/
            └── 001_init.sql
```

Ownership:

- `documents/` owns tabs, sessions, progress, and history.
- `platform/` owns browser/Tauri file source adaptation.
- `persistence/` owns typed frontend calls to Rust commands.
- `src-tauri/src/db.rs` owns SQLite connection, migrations, and persistence commands.
- `src-tauri/src/file_commands.rs` owns local file reading and PDF validation.
- `viewer/` is the only frontend module that imports `@react-pdf-viewer/*`.
- `commands/shortcutController.ts` owns DOM keyboard event translation into command IDs.
- `platform/dropZone.ts` owns browser drag-drop file filtering and conversion to file sources.

## Task 1: Scaffold The React/Tauri Project

**Files:**

- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/main.tsx`
- Create: `src/vite-env.d.ts`
- Create: `src/app/App.tsx`
- Create: `src/app/App.test.tsx`
- Create: `src/app/styles.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "smartreader",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b",
    "tauri": "tauri"
  },
  "dependencies": {
    "@react-pdf-viewer/core": "3.12.0",
    "@react-pdf-viewer/default-layout": "3.12.0",
    "@react-pdf-viewer/highlight": "3.12.0",
    "@react-pdf-viewer/page-navigation": "3.12.0",
    "@react-pdf-viewer/search": "3.12.0",
    "@react-pdf-viewer/toolbar": "3.12.0",
    "@react-pdf-viewer/zoom": "3.12.0",
    "@tauri-apps/api": "2.11.0",
    "@tauri-apps/plugin-dialog": "2.7.1",
    "@tauri-apps/plugin-fs": "2.5.1",
    "lucide-react": "1.18.0",
    "pdfjs-dist": "3.11.174",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "2.11.2",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@types/react": "18.3.31",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.0.2",
    "jsdom": "29.1.1",
    "typescript": "6.0.3",
    "vite": "8.0.16",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
bun install
```

Expected:

- `bun.lock` is created.
- Install completes.
- If `@react-pdf-viewer` license acceptance is not already handled with the user, stop and ask the user to confirm commercial license acceptability before writing app code that depends on it.

- [ ] **Step 3: Add Vite and TypeScript configuration**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SmartReader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Add the initial React shell**

Create `src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `src/app/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <section className="empty-reader" aria-label="SmartReader empty reader">
        <p className="eyebrow">SmartReader</p>
        <h1>Open a PDF to start reading</h1>
        <p>Use the file picker, drag a PDF here, or open one from the desktop app menu.</p>
      </section>
    </main>
  );
}
```

Create `src/app/styles.css`:

```css
:root {
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  color: #24211d;
  background: #f4efe7;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
}

button,
input {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(244, 239, 231, 0.92)),
    #f4efe7;
}

.empty-reader {
  width: min(520px, calc(100vw - 48px));
  padding: 32px;
  border: 1px solid rgba(93, 79, 61, 0.16);
  border-radius: 8px;
  background: rgba(255, 252, 246, 0.86);
  box-shadow: 0 18px 48px rgba(76, 62, 42, 0.12);
}

.empty-reader .eyebrow {
  margin: 0 0 8px;
  color: #8a6b3f;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.empty-reader h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.18;
}

.empty-reader p:last-child {
  margin: 14px 0 0;
  color: #6b6258;
  line-height: 1.6;
}
```

- [ ] **Step 5: Add a smoke test for the shell**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the empty reader shell', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Open a PDF to start reading')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Add the Tauri shell**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "smartreader"
version = "0.1.0"
description = "SmartReader desktop PDF reader"
authors = ["SmartReader"]
edition = "2021"

[lib]
name = "smartreader_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.5.1", features = [] }

[dependencies]
tauri = { version = "2.11.2", features = [] }
tauri-plugin-dialog = "2.7.1"
tauri-plugin-fs = "2.5.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
rusqlite = { version = "0.40.1", features = ["bundled"] }
time = { version = "0.3", features = ["formatting", "macros"] }
```

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "SmartReader",
  "version": "0.1.0",
  "identifier": "com.smartreader.app",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "SmartReader",
        "width": 1180,
        "height": 780,
        "minWidth": 860,
        "minHeight": 560
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

Create `src-tauri/src/main.rs`:

```rust
fn main() {
    smartreader_lib::run()
}
```

Create `src-tauri/src/lib.rs`:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
```

- [ ] **Step 7: Validate scaffold**

Run:

```bash
bun run typecheck
bun test
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- TypeScript typecheck passes.
- Vitest shows `1 passed`.
- Cargo test compiles and passes with zero tests.

- [ ] **Step 8: Commit scaffold**

Run:

```bash
git add package.json bun.lock index.html tsconfig.json tsconfig.node.json vite.config.ts vitest.setup.ts src src-tauri
git commit -m "chore: scaffold SmartReader desktop app"
```

## Task 2: Core Document Models And Session Store

**Files:**

- Create: `src/documents/documentModels.ts`
- Create: `src/documents/documentSessionStore.ts`
- Create: `src/documents/documentSessionStore.test.ts`
- Create: `src/test/fixtures.ts`

- [ ] **Step 1: Write failing session store tests**

Create `src/test/fixtures.ts`:

```ts
import type { FileSource } from '../platform/fileSource';

export function desktopPdfSource(path = '/Users/mario/Documents/sample.pdf'): FileSource {
  return {
    kind: 'desktop-path',
    path,
    name: path.split('/').at(-1) ?? 'sample.pdf',
  };
}
```

Create `src/documents/documentSessionStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { desktopPdfSource } from '../test/fixtures';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  updateSessionProgress,
} from './documentSessionStore';

describe('documentSessionStore', () => {
  it('adds a new desktop document session', () => {
    const state = createEmptyDocumentState();

    const next = addDocumentSession(state, desktopPdfSource('/tmp/book.pdf'));

    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).toBe(next.sessions[0].id);
    expect(next.sessions[0]).toMatchObject({
      documentKey: 'desktop:/tmp/book.pdf',
      title: 'book.pdf',
      page: 1,
      totalPages: null,
      zoom: 1,
      status: 'loading',
    });
  });

  it('focuses an existing desktop path instead of duplicating it', () => {
    const first = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/book.pdf'));
    const second = addDocumentSession(first, desktopPdfSource('/tmp/other.pdf'));
    const third = addDocumentSession(second, desktopPdfSource('/tmp/book.pdf'));

    expect(third.sessions).toHaveLength(2);
    expect(third.activeSessionId).toBe(first.sessions[0].id);
  });

  it('updates progress on the active session', () => {
    const state = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/book.pdf'));

    const next = updateSessionProgress(state, state.activeSessionId!, {
      page: 7,
      totalPages: 20,
      zoom: 1.25,
    });

    expect(next.sessions[0]).toMatchObject({
      page: 7,
      totalPages: 20,
      zoom: 1.25,
      progress: 0.35,
    });
  });

  it('selects a neighboring tab when closing the active session', () => {
    const first = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/a.pdf'));
    const second = addDocumentSession(first, desktopPdfSource('/tmp/b.pdf'));

    const next = closeDocumentSession(second, second.activeSessionId!);

    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0].title).toBe('a.pdf');
    expect(next.activeSessionId).toBe(next.sessions[0].id);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test src/documents/documentSessionStore.test.ts
```

Expected:

- FAIL because `platform/fileSource` and `documentSessionStore` do not exist.

- [ ] **Step 3: Add document and file source types**

Create `src/platform/fileSource.ts`:

```ts
export type DesktopPathFileSource = {
  kind: 'desktop-path';
  path: string;
  name: string;
};

export type BrowserFileSource = {
  kind: 'browser-file';
  file: File;
  name: string;
};

export type FileSource = DesktopPathFileSource | BrowserFileSource;

export function getFileSourceName(source: FileSource): string {
  return source.name.trim() || 'Untitled PDF';
}

export function getDocumentKey(source: FileSource): string {
  if (source.kind === 'desktop-path') {
    return `desktop:${source.path}`;
  }

  return `browser:${source.name}:${source.file.size}:${source.file.lastModified}`;
}
```

Create `src/documents/documentModels.ts`:

```ts
import type { FileSource } from '../platform/fileSource';

export type DocumentStatus = 'loading' | 'ready' | 'error';

export type DocumentSession = {
  id: string;
  documentKey: string;
  title: string;
  source: FileSource;
  page: number;
  totalPages: number | null;
  progress: number;
  zoom: number;
  status: DocumentStatus;
  errorMessage: string | null;
  updatedAt: string;
};

export type DocumentState = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
};

export type ProgressUpdate = {
  page: number;
  totalPages: number | null;
  zoom: number;
};
```

- [ ] **Step 4: Implement the session store**

Create `src/documents/documentSessionStore.ts`:

```ts
import { getDocumentKey, getFileSourceName, type FileSource } from '../platform/fileSource';
import type { DocumentSession, DocumentState, ProgressUpdate } from './documentModels';

export function createEmptyDocumentState(): DocumentState {
  return {
    sessions: [],
    activeSessionId: null,
  };
}

export function addDocumentSession(state: DocumentState, source: FileSource): DocumentState {
  const documentKey = getDocumentKey(source);
  const existing = state.sessions.find((session) => session.documentKey === documentKey);

  if (existing) {
    return {
      ...state,
      activeSessionId: existing.id,
    };
  }

  const session: DocumentSession = {
    id: createSessionId(documentKey),
    documentKey,
    title: getFileSourceName(source),
    source,
    page: 1,
    totalPages: null,
    progress: 0,
    zoom: 1,
    status: 'loading',
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  };

  return {
    sessions: [...state.sessions, session],
    activeSessionId: session.id,
  };
}

export function updateSessionProgress(
  state: DocumentState,
  sessionId: string,
  update: ProgressUpdate,
): DocumentState {
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      return {
        ...session,
        page: update.page,
        totalPages: update.totalPages,
        zoom: update.zoom,
        progress: calculateProgress(update.page, update.totalPages),
        status: 'ready',
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function closeDocumentSession(state: DocumentState, sessionId: string): DocumentState {
  const closingIndex = state.sessions.findIndex((session) => session.id === sessionId);
  const sessions = state.sessions.filter((session) => session.id !== sessionId);

  if (state.activeSessionId !== sessionId) {
    return {
      ...state,
      sessions,
    };
  }

  const fallbackIndex = Math.max(0, closingIndex - 1);
  const activeSessionId = sessions[fallbackIndex]?.id ?? null;

  return {
    sessions,
    activeSessionId,
  };
}

function calculateProgress(page: number, totalPages: number | null): number {
  if (!totalPages || totalPages <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, page / totalPages));
}

function createSessionId(documentKey: string): string {
  const encodedKey = btoa(unescape(encodeURIComponent(documentKey)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `session-${encodedKey}`;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test src/documents/documentSessionStore.test.ts
```

Expected:

- PASS with 4 tests.

- [ ] **Step 6: Commit document state**

Run:

```bash
git add src/platform/fileSource.ts src/documents/documentModels.ts src/documents/documentSessionStore.ts src/documents/documentSessionStore.test.ts src/test/fixtures.ts
git commit -m "feat: add document session state"
```

## Task 3: Reading History And Blob URL Cache

**Files:**

- Create: `src/documents/readingHistory.ts`
- Create: `src/documents/readingHistory.test.ts`
- Create: `src/cache/blobUrlCache.ts`
- Create: `src/cache/blobUrlCache.test.ts`

- [ ] **Step 1: Write failing reading history tests**

Create `src/documents/readingHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createReadingHistory,
  pushHardNavigation,
  recordProgressOnly,
  stepBack,
  stepForward,
} from './readingHistory';

describe('readingHistory', () => {
  it('records hard navigations in the back stack', () => {
    const history = createReadingHistory(1);
    const next = pushHardNavigation(history, 8);

    expect(next.currentPage).toBe(8);
    expect(next.backStack).toEqual([1]);
    expect(next.forwardStack).toEqual([]);
  });

  it('does not create history for ordinary progress updates', () => {
    const history = pushHardNavigation(createReadingHistory(1), 4);
    const next = recordProgressOnly(history, 5);

    expect(next.currentPage).toBe(5);
    expect(next.backStack).toEqual([1]);
  });

  it('steps back and forward through hard navigations', () => {
    const history = pushHardNavigation(pushHardNavigation(createReadingHistory(1), 5), 9);

    const back = stepBack(history);
    const forward = stepForward(back);

    expect(back.currentPage).toBe(5);
    expect(back.backStack).toEqual([1]);
    expect(back.forwardStack).toEqual([9]);
    expect(forward.currentPage).toBe(9);
  });
});
```

- [ ] **Step 2: Write failing Blob URL cache tests**

Create `src/cache/blobUrlCache.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from './blobUrlCache';

describe('BlobUrlCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores Blob URLs by session id', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const cache = new BlobUrlCache();
    const url = cache.createForSession('session-a', new Uint8Array([1, 2, 3]));

    expect(url).toBe('blob:one');
    expect(cache.getForSession('session-a')).toBe('blob:one');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes only the replaced session URL', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const cache = new BlobUrlCache();
    cache.createForSession('session-a', new Uint8Array([1]));
    cache.createForSession('session-a', new Uint8Array([2]));

    expect(cache.getForSession('session-a')).toBe('blob:two');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one');
  });

  it('revokes all URLs when cleared', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const cache = new BlobUrlCache();
    cache.createForSession('session-a', new Uint8Array([1]));
    cache.createForSession('session-b', new Uint8Array([2]));
    cache.clear();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:two');
    expect(cache.getForSession('session-a')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test src/documents/readingHistory.test.ts src/cache/blobUrlCache.test.ts
```

Expected:

- FAIL because the modules do not exist.

- [ ] **Step 4: Implement reading history**

Create `src/documents/readingHistory.ts`:

```ts
export type ReadingHistory = {
  currentPage: number;
  backStack: number[];
  forwardStack: number[];
};

export function createReadingHistory(initialPage: number): ReadingHistory {
  return {
    currentPage: initialPage,
    backStack: [],
    forwardStack: [],
  };
}

export function pushHardNavigation(history: ReadingHistory, nextPage: number): ReadingHistory {
  if (nextPage === history.currentPage) {
    return history;
  }

  return {
    currentPage: nextPage,
    backStack: [...history.backStack, history.currentPage],
    forwardStack: [],
  };
}

export function recordProgressOnly(history: ReadingHistory, nextPage: number): ReadingHistory {
  return {
    ...history,
    currentPage: nextPage,
  };
}

export function stepBack(history: ReadingHistory): ReadingHistory {
  const previous = history.backStack.at(-1);

  if (!previous) {
    return history;
  }

  return {
    currentPage: previous,
    backStack: history.backStack.slice(0, -1),
    forwardStack: [history.currentPage, ...history.forwardStack],
  };
}

export function stepForward(history: ReadingHistory): ReadingHistory {
  const next = history.forwardStack[0];

  if (!next) {
    return history;
  }

  return {
    currentPage: next,
    backStack: [...history.backStack, history.currentPage],
    forwardStack: history.forwardStack.slice(1),
  };
}
```

- [ ] **Step 5: Implement Blob URL cache**

Create `src/cache/blobUrlCache.ts`:

```ts
export class BlobUrlCache {
  private readonly urlsBySession = new Map<string, string>();

  createForSession(sessionId: string, bytes: Uint8Array): string {
    this.revokeForSession(sessionId);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    this.urlsBySession.set(sessionId, url);
    return url;
  }

  getForSession(sessionId: string): string | null {
    return this.urlsBySession.get(sessionId) ?? null;
  }

  revokeForSession(sessionId: string): void {
    const existing = this.urlsBySession.get(sessionId);

    if (!existing) {
      return;
    }

    URL.revokeObjectURL(existing);
    this.urlsBySession.delete(sessionId);
  }

  clear(): void {
    for (const url of this.urlsBySession.values()) {
      URL.revokeObjectURL(url);
    }

    this.urlsBySession.clear();
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/documents/readingHistory.test.ts src/cache/blobUrlCache.test.ts
```

Expected:

- PASS.

- [ ] **Step 7: Commit history and cache**

Run:

```bash
git add src/documents/readingHistory.ts src/documents/readingHistory.test.ts src/cache/blobUrlCache.ts src/cache/blobUrlCache.test.ts
git commit -m "feat: add reader history and blob cache"
```

## Task 4: Command Registry And Default Shortcuts

**Files:**

- Create: `src/commands/commandRegistry.ts`
- Create: `src/commands/commandRegistry.test.ts`

- [ ] **Step 1: Write failing command registry tests**

Create `src/commands/commandRegistry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, defaultShortcuts } from './commandRegistry';

describe('CommandRegistry', () => {
  it('registers and runs a command', () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();

    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: handler });
    registry.run('file.open');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns false for missing commands', () => {
    const registry = new CommandRegistry();

    expect(registry.run('missing.command')).toBe(false);
  });

  it('detects shortcut conflicts', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'file.open', label: 'Open File', shortcut: 'Meta+O', run: vi.fn() });
    registry.register({ id: 'tab.close', label: 'Close Tab', shortcut: 'Meta+O', run: vi.fn() });

    expect(registry.getShortcutConflicts()).toEqual([
      { shortcut: 'Meta+O', commandIds: ['file.open', 'tab.close'] },
    ]);
  });

  it('defines the MVP shortcuts', () => {
    expect(defaultShortcuts).toMatchObject({
      openFile: 'Meta+O',
      closeTab: 'Meta+W',
      find: 'Meta+F',
      zoomIn: 'Meta+=',
      zoomOut: 'Meta+-',
      toggleSidebar: 'Meta+B',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test src/commands/commandRegistry.test.ts
```

Expected:

- FAIL because `commandRegistry.ts` does not exist.

- [ ] **Step 3: Implement command registry**

Create `src/commands/commandRegistry.ts`:

```ts
export type CommandId =
  | 'file.open'
  | 'tab.close'
  | 'find.open'
  | 'find.next'
  | 'find.previous'
  | 'sidebar.toggle'
  | 'zoom.in'
  | 'zoom.out'
  | 'page.focus'
  | 'history.back'
  | 'history.forward'
  | 'tab.next'
  | 'tab.previous';

export type Command = {
  id: CommandId;
  label: string;
  shortcut: string | null;
  run: () => void;
};

export type ShortcutConflict = {
  shortcut: string;
  commandIds: CommandId[];
};

export const defaultShortcuts = {
  openFile: 'Meta+O',
  closeTab: 'Meta+W',
  find: 'Meta+F',
  findNext: 'Meta+G',
  findPrevious: 'Shift+Meta+G',
  toggleSidebar: 'Meta+B',
  zoomIn: 'Meta+=',
  zoomOut: 'Meta+-',
  focusPage: 'Meta+L',
  historyBack: 'Meta+[',
  historyForward: 'Meta+]',
  nextTab: 'Control+Tab',
  previousTab: 'Shift+Control+Tab',
} as const;

export class CommandRegistry {
  private readonly commands = new Map<CommandId, Command>();

  register(command: Command): void {
    this.commands.set(command.id, command);
  }

  run(commandId: CommandId): boolean {
    const command = this.commands.get(commandId);

    if (!command) {
      return false;
    }

    command.run();
    return true;
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  getShortcutConflicts(): ShortcutConflict[] {
    const byShortcut = new Map<string, CommandId[]>();

    for (const command of this.commands.values()) {
      if (!command.shortcut) {
        continue;
      }

      byShortcut.set(command.shortcut, [...(byShortcut.get(command.shortcut) ?? []), command.id]);
    }

    return [...byShortcut.entries()]
      .filter(([, commandIds]) => commandIds.length > 1)
      .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test src/commands/commandRegistry.test.ts
```

Expected:

- PASS.

- [ ] **Step 5: Commit command registry**

Run:

```bash
git add src/commands/commandRegistry.ts src/commands/commandRegistry.test.ts
git commit -m "feat: add reader command registry"
```

## Task 5: Rust SQLite Schema And Persistence Commands

**Files:**

- Create: `src-tauri/src/migrations/001_init.sql`
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust tests for persistence**

Create `src-tauri/src/migrations/001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL UNIQUE,
    path TEXT,
    display_name TEXT NOT NULL,
    file_size INTEGER,
    modified_at TEXT,
    page_count INTEGER,
    last_opened_at TEXT NOT NULL,
    last_page INTEGER NOT NULL DEFAULT 1,
    progress REAL NOT NULL DEFAULT 0,
    missing INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    active_document_id INTEGER,
    sidebar_open INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(active_document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS session_tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    document_id INTEGER NOT NULL,
    tab_order INTEGER NOT NULL,
    page INTEGER NOT NULL DEFAULT 1,
    zoom REAL NOT NULL DEFAULT 1,
    history_json TEXT NOT NULL DEFAULT '{"currentPage":1,"backStack":[],"forwardStack":[]}',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Create `src-tauri/src/db.rs`:

```rust
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

const INIT_SQL: &str = include_str!("migrations/001_init.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedDocument {
    pub document_key: String,
    pub path: Option<String>,
    pub display_name: String,
    pub file_size: Option<i64>,
    pub modified_at: Option<String>,
    pub page_count: Option<i64>,
    pub last_page: i64,
    pub progress: f64,
    pub missing: bool,
}

pub fn open_database(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    connection.execute_batch(INIT_SQL)?;
    Ok(connection)
}

pub fn default_database_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("smartreader.sqlite3")
}

pub fn upsert_document(connection: &Connection, document: &PersistedDocument) -> Result<(), DbError> {
    let now = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

    connection.execute(
        r#"
        INSERT INTO documents (
            document_key, path, display_name, file_size, modified_at, page_count,
            last_opened_at, last_page, progress, missing
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(document_key) DO UPDATE SET
            path = excluded.path,
            display_name = excluded.display_name,
            file_size = excluded.file_size,
            modified_at = excluded.modified_at,
            page_count = excluded.page_count,
            last_opened_at = excluded.last_opened_at,
            last_page = excluded.last_page,
            progress = excluded.progress,
            missing = excluded.missing
        "#,
        params![
            document.document_key,
            document.path,
            document.display_name,
            document.file_size,
            document.modified_at,
            document.page_count,
            now,
            document.last_page,
            document.progress,
            i64::from(document.missing),
        ],
    )?;

    Ok(())
}

pub fn list_documents(connection: &Connection) -> Result<Vec<PersistedDocument>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT document_key, path, display_name, file_size, modified_at, page_count,
               last_page, progress, missing
        FROM documents
        ORDER BY last_opened_at DESC
        "#,
    )?;

    let rows = statement.query_map([], |row| {
        Ok(PersistedDocument {
            document_key: row.get(0)?,
            path: row.get(1)?,
            display_name: row.get(2)?,
            file_size: row.get(3)?,
            modified_at: row.get(4)?,
            page_count: row.get(5)?,
            last_page: row.get(6)?,
            progress: row.get(7)?,
            missing: row.get::<_, i64>(8)? == 1,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_database_and_creates_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch(INIT_SQL).expect("schema applies");

        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
                [],
                |row| row.get(0),
            )
            .expect("table count");

        assert_eq!(table_count, 1);
    }

    #[test]
    fn upserts_and_lists_documents() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch(INIT_SQL).expect("schema applies");

        let document = PersistedDocument {
            document_key: "desktop:/tmp/book.pdf".to_string(),
            path: Some("/tmp/book.pdf".to_string()),
            display_name: "book.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-06-15T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 4,
            progress: 0.2,
            missing: false,
        };

        upsert_document(&connection, &document).expect("upsert");
        let documents = list_documents(&connection).expect("list");

        assert_eq!(documents, vec![document]);
    }
}
```

- [ ] **Step 2: Wire the module**

Modify `src-tauri/src/lib.rs`:

```rust
mod db;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
```

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db
```

Expected:

- PASS with the two `db` tests.

- [ ] **Step 4: Expose persistence commands**

Replace `src-tauri/src/db.rs` with this extended version:

```rust
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use time::OffsetDateTime;

const INIT_SQL: &str = include_str!("migrations/001_init.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("app data directory is not available")]
    AppDataDirUnavailable,
}

impl serde::Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct DatabaseState {
    connection: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedDocument {
    pub document_key: String,
    pub path: Option<String>,
    pub display_name: String,
    pub file_size: Option<i64>,
    pub modified_at: Option<String>,
    pub page_count: Option<i64>,
    pub last_page: i64,
    pub progress: f64,
    pub missing: bool,
}

pub fn setup_database(app: &AppHandle) -> Result<DatabaseState, DbError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| DbError::AppDataDirUnavailable)?;
    let connection = open_database(&default_database_path(app_data_dir))?;
    Ok(DatabaseState {
        connection: Mutex::new(connection),
    })
}

pub fn open_database(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    connection.execute_batch(INIT_SQL)?;
    Ok(connection)
}

pub fn default_database_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("smartreader.sqlite3")
}

#[tauri::command]
pub fn save_document(
    state: State<'_, DatabaseState>,
    document: PersistedDocument,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    upsert_document(&connection, &document)
}

#[tauri::command]
pub fn list_recent_documents(
    state: State<'_, DatabaseState>,
) -> Result<Vec<PersistedDocument>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_documents(&connection)
}

pub fn upsert_document(connection: &Connection, document: &PersistedDocument) -> Result<(), DbError> {
    let now = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

    connection.execute(
        r#"
        INSERT INTO documents (
            document_key, path, display_name, file_size, modified_at, page_count,
            last_opened_at, last_page, progress, missing
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(document_key) DO UPDATE SET
            path = excluded.path,
            display_name = excluded.display_name,
            file_size = excluded.file_size,
            modified_at = excluded.modified_at,
            page_count = excluded.page_count,
            last_opened_at = excluded.last_opened_at,
            last_page = excluded.last_page,
            progress = excluded.progress,
            missing = excluded.missing
        "#,
        params![
            document.document_key,
            document.path,
            document.display_name,
            document.file_size,
            document.modified_at,
            document.page_count,
            now,
            document.last_page,
            document.progress,
            i64::from(document.missing),
        ],
    )?;

    Ok(())
}

pub fn list_documents(connection: &Connection) -> Result<Vec<PersistedDocument>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT document_key, path, display_name, file_size, modified_at, page_count,
               last_page, progress, missing
        FROM documents
        ORDER BY last_opened_at DESC
        "#,
    )?;

    let rows = statement.query_map([], |row| {
        Ok(PersistedDocument {
            document_key: row.get(0)?,
            path: row.get(1)?,
            display_name: row.get(2)?,
            file_size: row.get(3)?,
            modified_at: row.get(4)?,
            page_count: row.get(5)?,
            last_page: row.get(6)?,
            progress: row.get(7)?,
            missing: row.get::<_, i64>(8)? == 1,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_database_and_creates_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch(INIT_SQL).expect("schema applies");

        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
                [],
                |row| row.get(0),
            )
            .expect("table count");

        assert_eq!(table_count, 1);
    }

    #[test]
    fn upserts_and_lists_documents() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch(INIT_SQL).expect("schema applies");

        let document = PersistedDocument {
            document_key: "desktop:/tmp/book.pdf".to_string(),
            path: Some("/tmp/book.pdf".to_string()),
            display_name: "book.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-06-15T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 4,
            progress: 0.2,
            missing: false,
        };

        upsert_document(&connection, &document).expect("upsert");
        let documents = list_documents(&connection).expect("list");

        assert_eq!(documents, vec![document]);
    }
}
```

Modify `src-tauri/src/lib.rs`:

```rust
mod db;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database = db::setup_database(app.handle())?;
            app.manage(database);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            db::save_document,
            db::list_recent_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
```

- [ ] **Step 5: Run Rust tests again**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db
```

Expected:

- PASS.

- [ ] **Step 6: Commit SQLite persistence**

Run:

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/src/migrations/001_init.sql src-tauri/Cargo.toml
git commit -m "feat: add SQLite persistence commands"
```

## Task 6: Frontend Persistence API And Recent Files

**Files:**

- Create: `src/persistence/persistenceApi.ts`
- Create: `src/persistence/persistenceApi.test.ts`
- Create: `src/library/recentFiles.ts`
- Create: `src/library/recentFiles.test.ts`

- [ ] **Step 1: Write failing persistence API tests**

Create `src/persistence/persistenceApi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPersistenceApi, type PersistedDocument } from './persistenceApi';

describe('persistenceApi', () => {
  it('saves a document through Tauri invoke', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createPersistenceApi(invoke);
    const document: PersistedDocument = {
      documentKey: 'desktop:/tmp/book.pdf',
      path: '/tmp/book.pdf',
      displayName: 'book.pdf',
      fileSize: 120,
      modifiedAt: '2026-06-15T00:00:00Z',
      pageCount: 20,
      lastPage: 3,
      progress: 0.15,
      missing: false,
    };

    await api.saveDocument(document);

    expect(invoke).toHaveBeenCalledWith('save_document', { document });
  });

  it('lists recent documents through Tauri invoke', async () => {
    const invoke = vi.fn().mockResolvedValue([{ documentKey: 'desktop:/tmp/book.pdf' }]);
    const api = createPersistenceApi(invoke);

    await expect(api.listRecentDocuments()).resolves.toEqual([
      { documentKey: 'desktop:/tmp/book.pdf' },
    ]);
  });
});
```

- [ ] **Step 2: Write failing recent file tests**

Create `src/library/recentFiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapDocumentsToRecentFiles, sortRecentFiles } from './recentFiles';

describe('recentFiles', () => {
  it('maps persisted documents into recent file cards', () => {
    const cards = mapDocumentsToRecentFiles([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 10,
        lastPage: 5,
        progress: 0.5,
        missing: false,
      },
    ]);

    expect(cards).toEqual([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        title: 'book.pdf',
        path: '/tmp/book.pdf',
        progressLabel: '50%',
        lastPageLabel: 'Page 5',
        missing: false,
      },
    ]);
  });

  it('keeps missing files visible at the end', () => {
    const sorted = sortRecentFiles([
      { documentKey: 'missing', title: 'missing.pdf', path: '/tmp/missing.pdf', progressLabel: '0%', lastPageLabel: 'Page 1', missing: true },
      { documentKey: 'ok', title: 'ok.pdf', path: '/tmp/ok.pdf', progressLabel: '20%', lastPageLabel: 'Page 2', missing: false },
    ]);

    expect(sorted.map((file) => file.documentKey)).toEqual(['ok', 'missing']);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test src/persistence/persistenceApi.test.ts src/library/recentFiles.test.ts
```

Expected:

- FAIL because modules do not exist.

- [ ] **Step 4: Implement frontend persistence API**

Create `src/persistence/persistenceApi.ts`:

```ts
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type PersistedDocument = {
  documentKey: string;
  path: string | null;
  displayName: string;
  fileSize: number | null;
  modifiedAt: string | null;
  pageCount: number | null;
  lastPage: number;
  progress: number;
  missing: boolean;
};

export type PersistenceApi = {
  saveDocument(document: PersistedDocument): Promise<void>;
  listRecentDocuments(): Promise<PersistedDocument[]>;
};

export function createPersistenceApi(invoke: Invoke = tauriInvoke): PersistenceApi {
  return {
    saveDocument(document) {
      return invoke<void>('save_document', { document });
    },
    listRecentDocuments() {
      return invoke<PersistedDocument[]>('list_recent_documents');
    },
  };
}
```

- [ ] **Step 5: Implement recent file mapping**

Create `src/library/recentFiles.ts`:

```ts
import type { PersistedDocument } from '../persistence/persistenceApi';

export type RecentFileCard = {
  documentKey: string;
  title: string;
  path: string | null;
  progressLabel: string;
  lastPageLabel: string;
  missing: boolean;
};

export function mapDocumentsToRecentFiles(documents: PersistedDocument[]): RecentFileCard[] {
  return sortRecentFiles(
    documents.map((document) => ({
      documentKey: document.documentKey,
      title: document.displayName,
      path: document.path,
      progressLabel: `${Math.round(document.progress * 100)}%`,
      lastPageLabel: `Page ${document.lastPage}`,
      missing: document.missing,
    })),
  );
}

export function sortRecentFiles(files: RecentFileCard[]): RecentFileCard[] {
  return [...files].sort((left, right) => Number(left.missing) - Number(right.missing));
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/persistence/persistenceApi.test.ts src/library/recentFiles.test.ts
```

Expected:

- PASS.

- [ ] **Step 7: Commit persistence API**

Run:

```bash
git add src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src/library/recentFiles.ts src/library/recentFiles.test.ts
git commit -m "feat: add recent file persistence API"
```

## Task 7: Tauri File Commands And Frontend Bridge

**Files:**

- Create: `src-tauri/src/file_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/platform/tauriBridge.ts`
- Create: `src/platform/tauriBridge.test.ts`

- [ ] **Step 1: Write Rust file command tests**

Create `src-tauri/src/file_commands.rs`:

```rust
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum FileCommandError {
    #[error("file does not exist")]
    Missing,
    #[error("path is not a file")]
    NotAFile,
    #[error("file is not a PDF")]
    InvalidPdf,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for FileCommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPdfFile {
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
    pub file_size: u64,
    pub modified_at: Option<String>,
}

pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), FileCommandError> {
    if bytes.starts_with(b"%PDF-") {
        Ok(())
    } else {
        Err(FileCommandError::InvalidPdf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_header() {
        assert!(validate_pdf_bytes(b"%PDF-1.7\nbody").is_ok());
    }

    #[test]
    fn rejects_non_pdf_header() {
        let error = validate_pdf_bytes(b"not a pdf").expect_err("invalid");
        assert!(matches!(error, FileCommandError::InvalidPdf));
    }
}
```

- [ ] **Step 2: Run Rust tests for expected compile issue**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml file_commands
```

Expected:

- PASS for validation tests.
- If the Rust compiler warns about unused imports, remove the unused imports before continuing.

- [ ] **Step 3: Implement Tauri read command**

Replace `src-tauri/src/file_commands.rs` with:

```rust
use serde::Serialize;
use std::fs;
use std::path::Path;
use time::OffsetDateTime;

#[derive(Debug, thiserror::Error)]
pub enum FileCommandError {
    #[error("file does not exist")]
    Missing,
    #[error("path is not a file")]
    NotAFile,
    #[error("file is not a PDF")]
    InvalidPdf,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for FileCommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPdfFile {
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
    pub file_size: u64,
    pub modified_at: Option<String>,
}

#[tauri::command]
pub fn read_desktop_pdf(path: String) -> Result<DesktopPdfFile, FileCommandError> {
    let path_ref = Path::new(&path);

    if !path_ref.exists() {
        return Err(FileCommandError::Missing);
    }

    if !path_ref.is_file() {
        return Err(FileCommandError::NotAFile);
    }

    let bytes = fs::read(path_ref)?;
    validate_pdf_bytes(&bytes)?;

    let metadata = fs::metadata(path_ref)?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|modified| OffsetDateTime::from(modified).format(&time::format_description::well_known::Rfc3339).ok());

    Ok(DesktopPdfFile {
        path: path_ref.to_string_lossy().to_string(),
        name: path_ref
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.pdf")
            .to_string(),
        bytes,
        file_size: metadata.len(),
        modified_at,
    })
}

pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), FileCommandError> {
    if bytes.starts_with(b"%PDF-") {
        Ok(())
    } else {
        Err(FileCommandError::InvalidPdf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_header() {
        assert!(validate_pdf_bytes(b"%PDF-1.7\nbody").is_ok());
    }

    #[test]
    fn rejects_non_pdf_header() {
        let error = validate_pdf_bytes(b"not a pdf").expect_err("invalid");
        assert!(matches!(error, FileCommandError::InvalidPdf));
    }
}
```

Modify `src-tauri/src/lib.rs`:

```rust
mod db;
mod file_commands;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database = db::setup_database(app.handle())?;
            app.manage(database);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            db::save_document,
            db::list_recent_documents,
            file_commands::read_desktop_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
```

- [ ] **Step 4: Write frontend bridge tests**

Create `src/platform/tauriBridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTauriBridge } from './tauriBridge';

describe('tauriBridge', () => {
  it('opens a native PDF path and reads bytes', async () => {
    const open = vi.fn().mockResolvedValue('/tmp/book.pdf');
    const invoke = vi.fn().mockResolvedValue({
      path: '/tmp/book.pdf',
      name: 'book.pdf',
      bytes: [37, 80, 68, 70, 45],
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });
    const bridge = createTauriBridge({ open, invoke });

    const file = await bridge.openNativePdf();

    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(invoke).toHaveBeenCalledWith('read_desktop_pdf', { path: '/tmp/book.pdf' });
    expect(file).toMatchObject({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
    });
  });

  it('returns null when native dialog is cancelled', async () => {
    const bridge = createTauriBridge({
      open: vi.fn().mockResolvedValue(null),
      invoke: vi.fn(),
    });

    await expect(bridge.openNativePdf()).resolves.toBeNull();
  });
});
```

- [ ] **Step 5: Implement frontend bridge**

Create `src/platform/tauriBridge.ts`:

```ts
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import type { DesktopPathFileSource } from './fileSource';

type OpenDialog = typeof tauriOpen;
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type DesktopPdfResponse = {
  path: string;
  name: string;
  bytes: number[];
  fileSize: number;
  modifiedAt: string | null;
};

export type OpenedDesktopPdf = {
  source: DesktopPathFileSource;
  bytes: Uint8Array;
  fileSize: number;
  modifiedAt: string | null;
};

export type TauriBridge = {
  openNativePdf(): Promise<OpenedDesktopPdf | null>;
  readDesktopPdf(path: string): Promise<OpenedDesktopPdf>;
};

export function createTauriBridge(dependencies: {
  open?: OpenDialog;
  invoke?: Invoke;
} = {}): TauriBridge {
  const open = dependencies.open ?? tauriOpen;
  const invoke = dependencies.invoke ?? tauriInvoke;

  return {
    async openNativePdf() {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (!selected || Array.isArray(selected)) {
        return null;
      }

      return readDesktopPdfWithInvoke(invoke, selected);
    },
    readDesktopPdf(path) {
      return readDesktopPdfWithInvoke(invoke, path);
    },
  };
}

async function readDesktopPdfWithInvoke(invoke: Invoke, path: string): Promise<OpenedDesktopPdf> {
  const response = await invoke<DesktopPdfResponse>('read_desktop_pdf', { path });

  return {
    source: {
      kind: 'desktop-path',
      path: response.path,
      name: response.name,
    },
    bytes: new Uint8Array(response.bytes),
    fileSize: response.fileSize,
    modifiedAt: response.modifiedAt,
  };
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test src/platform/tauriBridge.test.ts
cargo test --manifest-path src-tauri/Cargo.toml file_commands
```

Expected:

- Frontend bridge tests pass.
- Rust file command tests pass.

- [ ] **Step 7: Commit file bridge**

Run:

```bash
git add src-tauri/src/file_commands.rs src-tauri/src/lib.rs src/platform/tauriBridge.ts src/platform/tauriBridge.test.ts
git commit -m "feat: add desktop PDF file bridge"
```

## Task 8: PDF Viewer Bridge

**Files:**

- Create: `src/viewer/viewerTypes.ts`
- Create: `src/viewer/PdfViewerBridge.tsx`
- Create: `src/viewer/PdfViewerBridge.test.tsx`

- [ ] **Step 1: Write bridge tests with a mock renderer**

Create `src/viewer/PdfViewerBridge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';

describe('PdfViewerBridge', () => {
  it('shows an empty message without a source', () => {
    render(<PdfViewerBridge source={null} onProgressChange={vi.fn()} />);

    expect(screen.getByText('No PDF selected')).toBeInTheDocument();
  });

  it('passes source and callbacks to the renderer', () => {
    const renderer: PdfRenderer = ({ fileUrl, onPageChange, onZoomChange }) => (
      <button
        type="button"
        onClick={() => {
          onPageChange(4, 10);
          onZoomChange(1.25);
        }}
      >
        Render {fileUrl}
      </button>
    );
    const onProgressChange = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={onProgressChange}
      />,
    );

    screen.getByText('Render blob:book').click();

    expect(onProgressChange).toHaveBeenCalledWith({
      sessionId: 'session-a',
      page: 4,
      totalPages: 10,
      zoom: 1.25,
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test src/viewer/PdfViewerBridge.test.tsx
```

Expected:

- FAIL because viewer bridge does not exist.

- [ ] **Step 3: Implement viewer types and bridge**

Create `src/viewer/viewerTypes.ts`:

```ts
export type ViewerSource = {
  sessionId: string;
  url: string;
};

export type ViewerProgress = {
  sessionId: string;
  page: number;
  totalPages: number | null;
  zoom: number;
};
```

Create `src/viewer/PdfViewerBridge.tsx`:

```tsx
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { searchPlugin } from '@react-pdf-viewer/search';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import type { ViewerProgress, ViewerSource } from './viewerTypes';

export type PdfRendererProps = {
  fileUrl: string;
  onPageChange(page: number, totalPages: number | null): void;
  onZoomChange(zoom: number): void;
};

export type PdfRenderer = (props: PdfRendererProps) => JSX.Element;

export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  onProgressChange(progress: ViewerProgress): void;
  renderer?: PdfRenderer;
};

export function PdfViewerBridge({ source, onProgressChange, renderer }: PdfViewerBridgeProps) {
  if (!source) {
    return <div className="viewer-empty">No PDF selected</div>;
  }

  const reportPage = (page: number, totalPages: number | null) => {
    onProgressChange({
      sessionId: source.sessionId,
      page,
      totalPages,
      zoom: 1,
    });
  };

  const reportZoom = (zoom: number) => {
    onProgressChange({
      sessionId: source.sessionId,
      page: 1,
      totalPages: null,
      zoom,
    });
  };

  if (renderer) {
    return renderer({
      fileUrl: source.url,
      onPageChange: reportPage,
      onZoomChange: reportZoom,
    });
  }

  return <ReactPdfViewer fileUrl={source.url} onPageChange={reportPage} onZoomChange={reportZoom} />;
}

function ReactPdfViewer({ fileUrl, onPageChange, onZoomChange }: PdfRendererProps) {
  pageNavigationPlugin();
  searchPlugin();
  toolbarPlugin();
  zoomPlugin();

  return (
    <Worker workerUrl="/pdf.worker.min.js">
      <Viewer
        fileUrl={fileUrl}
        onPageChange={(event) => onPageChange(event.currentPage + 1, null)}
        onZoom={(event) => onZoomChange(event.scale)}
      />
    </Worker>
  );
}
```

Important implementation note:

- `pdf.worker.min.js` is copied from `node_modules/pdfjs-dist/build/pdf.worker.min.js` to `public/pdf.worker.min.js` in Task 13.
- If `@react-pdf-viewer` event names differ during implementation, adjust `ReactPdfViewer` only; do not leak plugin APIs outside this file.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test src/viewer/PdfViewerBridge.test.tsx
```

Expected:

- PASS.
- If TypeScript reports exact `@react-pdf-viewer` event type differences, correct only `src/viewer/PdfViewerBridge.tsx` and rerun.

- [ ] **Step 5: Commit viewer bridge**

Run:

```bash
git add src/viewer/viewerTypes.ts src/viewer/PdfViewerBridge.tsx src/viewer/PdfViewerBridge.test.tsx
git commit -m "feat: add PDF viewer bridge"
```

## Task 9: Viewer Command Controller

**Files:**

- Create: `src/viewer/viewerController.ts`
- Create: `src/viewer/viewerController.test.ts`
- Modify: `src/viewer/PdfViewerBridge.tsx`
- Modify: `src/viewer/PdfViewerBridge.test.tsx`

- [ ] **Step 1: Write failing controller tests**

Create `src/viewer/viewerController.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ViewerController } from './viewerController';

describe('ViewerController', () => {
  it('returns false when actions are not bound', () => {
    const controller = new ViewerController();

    expect(controller.jumpToPage(3)).toBe(false);
    expect(controller.searchNext()).toBe(false);
    expect(controller.zoomIn()).toBe(false);
  });

  it('delegates commands to bound viewer actions', () => {
    const actions = {
      jumpToPage: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    };
    const controller = new ViewerController();

    controller.bind(actions);

    expect(controller.jumpToPage(5)).toBe(true);
    expect(controller.searchNext()).toBe(true);
    expect(controller.searchPrevious()).toBe(true);
    expect(controller.zoomIn()).toBe(true);
    expect(controller.zoomOut()).toBe(true);
    expect(controller.fitWidth()).toBe(true);
    expect(controller.fitPage()).toBe(true);
    expect(actions.jumpToPage).toHaveBeenCalledWith(5);
  });

  it('clears viewer actions when a document unmounts', () => {
    const controller = new ViewerController();
    controller.bind({
      jumpToPage: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    });

    controller.clear();

    expect(controller.fitPage()).toBe(false);
  });
});
```

- [ ] **Step 2: Run controller test to verify failure**

Run:

```bash
bun test src/viewer/viewerController.test.ts
```

Expected:

- FAIL because `viewerController.ts` does not exist.

- [ ] **Step 3: Implement controller**

Create `src/viewer/viewerController.ts`:

```ts
export type ViewerActions = {
  jumpToPage(page: number): void;
  searchNext(): void;
  searchPrevious(): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  clear?(): void;
};

export class ViewerController {
  private actions: ViewerActions | null = null;

  bind(actions: ViewerActions): void {
    this.actions = actions;
  }

  clear(): void {
    this.actions = null;
  }

  jumpToPage(page: number): boolean {
    return this.run((actions) => actions.jumpToPage(page));
  }

  searchNext(): boolean {
    return this.run((actions) => actions.searchNext());
  }

  searchPrevious(): boolean {
    return this.run((actions) => actions.searchPrevious());
  }

  zoomIn(): boolean {
    return this.run((actions) => actions.zoomIn());
  }

  zoomOut(): boolean {
    return this.run((actions) => actions.zoomOut());
  }

  fitWidth(): boolean {
    return this.run((actions) => actions.fitWidth());
  }

  fitPage(): boolean {
    return this.run((actions) => actions.fitPage());
  }

  private run(command: (actions: ViewerActions) => void): boolean {
    if (!this.actions) {
      return false;
    }

    command(this.actions);
    return true;
  }
}
```

- [ ] **Step 4: Run controller tests**

Run:

```bash
bun test src/viewer/viewerController.test.ts
```

Expected:

- PASS.

- [ ] **Step 5: Extend bridge props and tests**

Replace `src/viewer/PdfViewerBridge.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';
import { ViewerController } from './viewerController';

describe('PdfViewerBridge', () => {
  it('shows an empty message without a source', () => {
    render(<PdfViewerBridge source={null} onProgressChange={vi.fn()} />);

    expect(screen.getByText('No PDF selected')).toBeInTheDocument();
  });

  it('passes source and callbacks to the renderer', () => {
    const renderer: PdfRenderer = ({ fileUrl, onPageChange, onZoomChange }) => (
      <button
        type="button"
        onClick={() => {
          onPageChange(4, 10);
          onZoomChange(1.25);
        }}
      >
        Render {fileUrl}
      </button>
    );
    const onProgressChange = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        onProgressChange={onProgressChange}
      />,
    );

    screen.getByText('Render blob:book').click();

    expect(onProgressChange).toHaveBeenCalledWith({
      sessionId: 'session-a',
      page: 4,
      totalPages: 10,
      zoom: 1.25,
    });
  });

  it('binds and clears a provided viewer controller', () => {
    const renderer: PdfRenderer = () => <div>Rendered PDF</div>;
    const controller = new ViewerController();
    const { unmount } = render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        controller={controller}
        onProgressChange={vi.fn()}
      />,
    );

    expect(controller.fitPage()).toBe(true);

    unmount();

    expect(controller.fitPage()).toBe(false);
  });
});
```

- [ ] **Step 6: Modify `PdfViewerBridge` to bind controller actions**

Modify `src/viewer/PdfViewerBridge.tsx`:

```tsx
import { SpecialZoomLevel, Worker, Viewer } from '@react-pdf-viewer/core';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { searchPlugin } from '@react-pdf-viewer/search';
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import { useEffect, useMemo, useRef } from 'react';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/page-navigation/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import type { ViewerProgress, ViewerSource } from './viewerTypes';
import type { ViewerActions } from './viewerController';

export type PdfRendererProps = {
  fileUrl: string;
  onPageChange(page: number, totalPages: number | null): void;
  onZoomChange(zoom: number): void;
};

export type PdfRenderer = (props: PdfRendererProps) => JSX.Element;

export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  onProgressChange(progress: ViewerProgress): void;
  controller?: ViewerActions;
  renderer?: PdfRenderer;
};

export function PdfViewerBridge({
  source,
  onProgressChange,
  controller,
  renderer,
}: PdfViewerBridgeProps) {
  if (!source) {
    return <div className="viewer-empty">No PDF selected</div>;
  }

  const reportPage = (page: number, totalPages: number | null) => {
    onProgressChange({
      sessionId: source.sessionId,
      page,
      totalPages,
      zoom: 1,
    });
  };

  const reportZoom = (zoom: number) => {
    onProgressChange({
      sessionId: source.sessionId,
      page: 1,
      totalPages: null,
      zoom,
    });
  };

  useEffect(() => {
    if (!renderer || !controller) {
      return undefined;
    }

    controller.bind({
      jumpToPage: () => undefined,
      searchNext: () => undefined,
      searchPrevious: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      fitWidth: () => undefined,
      fitPage: () => undefined,
    });

    return () => controller.clear?.();
  }, [controller, renderer]);

  if (renderer) {
    return renderer({
      fileUrl: source.url,
      onPageChange: reportPage,
      onZoomChange: reportZoom,
    });
  }

  return (
    <ReactPdfViewer
      fileUrl={source.url}
      controller={controller}
      onPageChange={reportPage}
      onZoomChange={reportZoom}
    />
  );
}

function ReactPdfViewer({
  fileUrl,
  controller,
  onPageChange,
  onZoomChange,
}: PdfRendererProps & { controller?: ViewerActions }) {
  const scaleRef = useRef(1);
  const pageNavigationPluginInstance = useMemo(
    () => pageNavigationPlugin({ enableShortcuts: false }),
    [],
  );
  const searchPluginInstance = useMemo(() => searchPlugin({ enableShortcuts: false }), []);
  const toolbarPluginInstance = useMemo(
    () =>
      toolbarPlugin({
        pageNavigationPlugin: { enableShortcuts: false },
        searchPlugin: { enableShortcuts: false },
        zoomPlugin: { enableShortcuts: false },
      }),
    [],
  );
  const zoomPluginInstance = toolbarPluginInstance.zoomPluginInstance;
  const { Toolbar } = toolbarPluginInstance;

  useEffect(() => {
    if (!controller) {
      return undefined;
    }

    controller.bind({
      jumpToPage: (page) => pageNavigationPluginInstance.jumpToPage(Math.max(0, page - 1)),
      searchNext: () => {
        searchPluginInstance.jumpToNextMatch();
      },
      searchPrevious: () => {
        searchPluginInstance.jumpToPreviousMatch();
      },
      zoomIn: () => {
        zoomPluginInstance.zoomTo(Math.min(3, scaleRef.current + 0.1));
      },
      zoomOut: () => {
        zoomPluginInstance.zoomTo(Math.max(0.3, scaleRef.current - 0.1));
      },
      fitWidth: () => zoomPluginInstance.zoomTo(SpecialZoomLevel.PageWidth),
      fitPage: () => zoomPluginInstance.zoomTo(SpecialZoomLevel.PageFit),
    });

    return () => controller.clear?.();
  }, [controller, pageNavigationPluginInstance, searchPluginInstance, zoomPluginInstance]);

  return (
    <div className="pdf-viewer-bridge">
      <div className="viewer-plugin-toolbar">
        <Toolbar>
          {(slots) => (
            <div className="viewer-plugin-toolbar-inner">
              <slots.GoToPreviousPageButton />
              <slots.CurrentPageInput />
              <slots.NumberOfPages>
                {({ numberOfPages }) => <span className="viewer-page-count">/ {numberOfPages}</span>}
              </slots.NumberOfPages>
              <slots.GoToNextPageButton />
              <slots.ShowSearchPopoverButton />
              <slots.ZoomOutButton />
              <slots.ZoomPopover />
              <slots.ZoomInButton />
            </div>
          )}
        </Toolbar>
      </div>
      <Worker workerUrl="/pdf.worker.min.js">
        <Viewer
          fileUrl={fileUrl}
          plugins={[toolbarPluginInstance, pageNavigationPluginInstance, searchPluginInstance]}
          onPageChange={(event) => onPageChange(event.currentPage + 1, null)}
          onZoom={(event) => {
            scaleRef.current = event.scale;
            onZoomChange(event.scale);
          }}
        />
      </Worker>
    </div>
  );
}
```

If TypeScript reports that JSX tag names such as `<slots.GoToPreviousPageButton />` are invalid, replace those with local uppercase aliases inside the toolbar render callback:

```tsx
const GoToPreviousPageButton = slots.GoToPreviousPageButton;
return <GoToPreviousPageButton />;
```

- [ ] **Step 7: Run viewer tests and typecheck**

Run:

```bash
bun test src/viewer/viewerController.test.ts src/viewer/PdfViewerBridge.test.tsx
bun run typecheck
```

Expected:

- Viewer tests pass.
- Typecheck passes.
- If the real plugin types require small JSX alias adjustments, keep the changes inside `src/viewer/PdfViewerBridge.tsx`.

- [ ] **Step 8: Commit viewer command controller**

Run:

```bash
git add src/viewer/viewerController.ts src/viewer/viewerController.test.ts src/viewer/PdfViewerBridge.tsx src/viewer/PdfViewerBridge.test.tsx
git commit -m "feat: wire PDF viewer commands"
```

## Task 10: Reader Shell Integration

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Replace app test with shell behavior tests**

Replace `src/app/App.test.tsx` with:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens a PDF from the native dialog and displays a tab', async () => {
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    render(<App bridge={{ openNativePdf, readDesktopPdf: vi.fn() }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });
  });

  it('does not create a duplicate tab for the same path', async () => {
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    render(<App bridge={{ openNativePdf, readDesktopPdf: vi.fn() }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: 'book.pdf' })).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test src/app/App.test.tsx
```

Expected:

- FAIL because `App` does not accept a bridge and does not render tabs.

- [ ] **Step 3: Implement reader shell**

Replace `src/app/App.tsx` with:

```tsx
import { FileText, FolderOpen, PanelLeftClose, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BlobUrlCache } from '../cache/blobUrlCache';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  updateSessionProgress,
} from '../documents/documentSessionStore';
import { getDocumentKey } from '../platform/fileSource';
import { createTauriBridge, type TauriBridge } from '../platform/tauriBridge';
import { PdfViewerBridge } from '../viewer/PdfViewerBridge';
import { ViewerController, type ViewerActions } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';

type AppProps = {
  bridge?: TauriBridge;
  viewerController?: ViewerActions;
};

export function App({
  bridge = createTauriBridge(),
  viewerController,
}: AppProps) {
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const blobUrlCache = useMemo(() => new BlobUrlCache(), []);
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;

  const activeSession =
    documents.sessions.find((session) => session.id === documents.activeSessionId) ?? null;

  const openPdf = async () => {
    const opened = await bridge.openNativePdf();

    if (!opened) {
      return;
    }

    setDocuments((current) => {
      const next = addDocumentSession(current, opened.source);
      const session = next.sessions.find((candidate) => candidate.documentKey === getDocumentKey(opened.source));

      if (session) {
        const url = blobUrlCache.createForSession(session.id, opened.bytes);
        setViewerSource({ sessionId: session.id, url });
      }

      return next;
    });
  };

  const closeActiveTab = () => {
    if (!activeSession) {
      return;
    }

    blobUrlCache.revokeForSession(activeSession.id);
    setDocuments((current) => closeDocumentSession(current, activeSession.id));
    setViewerSource(null);
  };

  return (
    <main className="app-shell">
      <header className="tab-strip" aria-label="Open documents">
        {documents.sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="tab"
            aria-selected={session.id === documents.activeSessionId}
            className={session.id === documents.activeSessionId ? 'tab active' : 'tab'}
            onClick={() => {
              setDocuments((current) => ({ ...current, activeSessionId: session.id }));
              const url = blobUrlCache.getForSession(session.id);
              setViewerSource(url ? { sessionId: session.id, url } : null);
            }}
          >
            <FileText size={14} />
            {session.title}
          </button>
        ))}
      </header>

      <section className="toolbar" aria-label="Reader tools">
        <button type="button" onClick={openPdf} aria-label="Open PDF">
          <FolderOpen size={16} />
          Open PDF
        </button>
        <button type="button" aria-label="Find in PDF">
          <Search size={16} />
        </button>
        <button type="button" onClick={() => activeViewerController.zoomOut()} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={() => activeViewerController.zoomIn()} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button type="button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle sidebar">
          <PanelLeftClose size={16} />
        </button>
        <button type="button" onClick={closeActiveTab} disabled={!activeSession}>
          Close
        </button>
        {activeSession ? (
          <span className="toolbar-status">
            Page {activeSession.page}
            {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''}
          </span>
        ) : null}
      </section>

      <section className={sidebarOpen ? 'reader-grid' : 'reader-grid sidebar-collapsed'}>
        {sidebarOpen ? (
          <aside className="side-panel">
            <h2>Reading</h2>
            {activeSession ? (
              <p>{Math.round(activeSession.progress * 100)}% complete</p>
            ) : (
              <p>No document selected</p>
            )}
          </aside>
        ) : null}

        <section className="viewer-pane">
          {activeSession ? (
            <PdfViewerBridge
              source={viewerSource}
              controller={activeViewerController}
              onProgressChange={(progress) => {
                setDocuments((current) =>
                  updateSessionProgress(current, progress.sessionId, {
                    page: progress.page,
                    totalPages: progress.totalPages,
                    zoom: progress.zoom,
                  }),
                );
              }}
            />
          ) : (
            <section className="empty-reader" aria-label="SmartReader empty reader">
              <p className="eyebrow">SmartReader</p>
              <h1>Open a PDF to start reading</h1>
              <p>Use the file picker, drag a PDF here, or open one from the desktop app menu.</p>
            </section>
          )}
        </section>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Replace styles with reader layout styles**

Replace `src/app/styles.css` with:

```css
:root {
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  color: #24211d;
  background: #f4efe7;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

button,
input {
  font: inherit;
}

button {
  border: 1px solid rgba(93, 79, 61, 0.16);
  border-radius: 7px;
  background: rgba(255, 252, 246, 0.92);
  color: #332d26;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.app-shell {
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-rows: 40px 44px minmax(0, 1fr);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(244, 239, 231, 0.92)),
    #f4efe7;
}

.tab-strip {
  display: flex;
  align-items: end;
  gap: 6px;
  padding: 6px 10px 0;
  border-bottom: 1px solid rgba(93, 79, 61, 0.14);
  overflow-x: auto;
}

.tab {
  min-width: 120px;
  max-width: 220px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  white-space: nowrap;
}

.tab.active {
  background: #fffaf0;
  border-color: rgba(93, 79, 61, 0.24);
  box-shadow: 0 -1px 0 #fffaf0 inset;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(93, 79, 61, 0.12);
  background: rgba(255, 250, 240, 0.76);
}

.toolbar button {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
}

.toolbar-status {
  margin-left: auto;
  color: #6b6258;
  font-size: 13px;
}

.reader-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
}

.reader-grid.sidebar-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.side-panel {
  min-height: 0;
  padding: 16px;
  border-right: 1px solid rgba(93, 79, 61, 0.12);
  background: rgba(255, 252, 246, 0.66);
  overflow: auto;
}

.side-panel h2 {
  margin: 0 0 10px;
  font-size: 13px;
  text-transform: uppercase;
}

.side-panel p {
  margin: 0;
  color: #6b6258;
  font-size: 13px;
}

.viewer-pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: stretch;
  overflow: hidden;
}

.viewer-empty {
  display: grid;
  place-items: center;
  color: #6b6258;
}

.empty-reader {
  width: min(520px, calc(100vw - 48px));
  align-self: center;
  justify-self: center;
  padding: 32px;
  border: 1px solid rgba(93, 79, 61, 0.16);
  border-radius: 8px;
  background: rgba(255, 252, 246, 0.86);
  box-shadow: 0 18px 48px rgba(76, 62, 42, 0.12);
}

.empty-reader .eyebrow {
  margin: 0 0 8px;
  color: #8a6b3f;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.empty-reader h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.18;
}

.empty-reader p:last-child {
  margin: 14px 0 0;
  color: #6b6258;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .app-shell {
    grid-template-rows: 40px 44px minmax(0, 1fr);
  }

  .toolbar button:not(:first-child) {
    width: 32px;
    padding: 0;
    justify-content: center;
  }

  .toolbar button:not(:first-child) {
    font-size: 0;
  }

  .reader-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .side-panel {
    display: none;
  }
}
```

- [ ] **Step 5: Run app tests**

Run:

```bash
bun test src/app/App.test.tsx
```

Expected:

- PASS.

- [ ] **Step 6: Commit shell integration**

Run:

```bash
git add src/app/App.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "feat: add reader shell integration"
```

## Task 11: Drag-Drop PDF Open Flow

**Files:**

- Create: `src/platform/dropZone.ts`
- Create: `src/platform/dropZone.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write failing drop-zone tests**

Create `src/platform/dropZone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPdfFilesFromDrop } from './dropZone';

describe('dropZone', () => {
  it('returns only dropped PDF files', () => {
    const pdf = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    expect(getPdfFilesFromDrop([pdf, text])).toEqual([pdf]);
  });

  it('accepts PDFs with missing MIME type when the extension is pdf', () => {
    const pdf = new File(['%PDF-1.7'], 'paper.PDF', { type: '' });

    expect(getPdfFilesFromDrop([pdf])).toEqual([pdf]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test src/platform/dropZone.test.ts
```

Expected:

- FAIL because `dropZone.ts` does not exist.

- [ ] **Step 3: Implement drop-zone file filtering**

Create `src/platform/dropZone.ts`:

```ts
export function getPdfFilesFromDrop(files: Iterable<File>): File[] {
  return [...files].filter(isPdfFile);
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
```

- [ ] **Step 4: Add drag-drop app tests**

Append to `src/app/App.test.tsx` inside the `describe('App', () => { ... })` block:

```tsx
  it('opens a dropped browser PDF file', async () => {
    const file = new File(['%PDF-1.7'], 'drop.pdf', { type: 'application/pdf' });

    render(<App bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }} />);

    fireEvent.drop(screen.getByLabelText('Reader workspace'), {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'drop.pdf' })).toBeInTheDocument();
    });
  });
```

- [ ] **Step 5: Modify App to handle dropped PDFs**

Modify `src/app/App.tsx` imports:

```tsx
import { getPdfFilesFromDrop } from '../platform/dropZone';
import type { FileSource } from '../platform/fileSource';
```

Add this helper inside `App` before `openPdf`:

```tsx
  const openBytes = (source: FileSource, bytes: Uint8Array) => {
    setDocuments((current) => {
      const next = addDocumentSession(current, source);
      const session = next.sessions.find((candidate) => candidate.documentKey === getDocumentKey(source));

      if (session) {
        const url = blobUrlCache.createForSession(session.id, bytes);
        setViewerSource({ sessionId: session.id, url });
      }

      return next;
    });
  };
```

Replace the body of `openPdf` with:

```tsx
  const openPdf = async () => {
    const opened = await bridge.openNativePdf();

    if (!opened) {
      return;
    }

    openBytes(opened.source, opened.bytes);
  };
```

Add this handler inside `App`:

```tsx
  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const [file] = getPdfFilesFromDrop(event.dataTransfer.files);

    if (!file) {
      return;
    }

    openBytes(
      {
        kind: 'browser-file',
        file,
        name: file.name,
      },
      new Uint8Array(await file.arrayBuffer()),
    );
  };
```

Change the root element:

```tsx
    <main
      className="app-shell"
      aria-label="Reader workspace"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
```

- [ ] **Step 6: Run drag-drop tests**

Run:

```bash
bun test src/platform/dropZone.test.ts src/app/App.test.tsx
```

Expected:

- PASS.

- [ ] **Step 7: Commit drag-drop support**

Run:

```bash
git add src/platform/dropZone.ts src/platform/dropZone.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add PDF drag and drop open flow"
```

## Task 12: Keyboard Shortcuts And Viewer Command Wiring

**Files:**

- Create: `src/commands/shortcutController.ts`
- Create: `src/commands/shortcutController.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write failing shortcut tests**

Create `src/commands/shortcutController.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from './commandRegistry';
import { getShortcutFromKeyboardEvent, handleShortcutEvent } from './shortcutController';

describe('shortcutController', () => {
  it('normalizes keyboard events into shortcut strings', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      metaKey: true,
    });

    expect(getShortcutFromKeyboardEvent(event)).toBe('Meta+O');
  });

  it('runs matching commands and prevents browser defaults', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'file.open', label: 'Open', shortcut: 'Meta+O', run });
    const event = new KeyboardEvent('keydown', {
      key: 'o',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    expect(handleShortcutEvent(event, registry)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run shortcut tests to verify failure**

Run:

```bash
bun test src/commands/shortcutController.test.ts
```

Expected:

- FAIL because `shortcutController.ts` does not exist.

- [ ] **Step 3: Implement shortcut controller**

Create `src/commands/shortcutController.ts`:

```ts
import type { CommandRegistry } from './commandRegistry';

export function getShortcutFromKeyboardEvent(event: KeyboardEvent): string {
  const keys: string[] = [];

  if (event.ctrlKey) {
    keys.push('Control');
  }

  if (event.shiftKey) {
    keys.push('Shift');
  }

  if (event.metaKey) {
    keys.push('Meta');
  }

  if (event.altKey) {
    keys.push('Alt');
  }

  keys.push(normalizeKey(event.key));
  return keys.join('+');
}

export function handleShortcutEvent(event: KeyboardEvent, registry: CommandRegistry): boolean {
  const shortcut = getShortcutFromKeyboardEvent(event);
  const command = registry.list().find((candidate) => candidate.shortcut === shortcut);

  if (!command) {
    return false;
  }

  event.preventDefault();
  registry.run(command.id);
  return true;
}

function normalizeKey(key: string): string {
  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key;
}
```

- [ ] **Step 4: Add app shortcut tests**

Append to `src/app/App.test.tsx` inside the `describe('App', () => { ... })` block:

```tsx
  it('runs viewer zoom shortcuts', () => {
    const viewerController = {
      jumpToPage: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    };

    render(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        viewerController={viewerController}
      />,
    );

    fireEvent.keyDown(window, { key: '=', metaKey: true });
    fireEvent.keyDown(window, { key: '-', metaKey: true });

    expect(viewerController.zoomIn).toHaveBeenCalledTimes(1);
    expect(viewerController.zoomOut).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 5: Wire command registry in App**

Modify `src/app/App.tsx` imports:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { CommandRegistry, defaultShortcuts } from '../commands/commandRegistry';
import { handleShortcutEvent } from '../commands/shortcutController';
```

Change `AppProps` so tests can pass a controller-like object:

```tsx
import { ViewerController, type ViewerActions } from '../viewer/viewerController';

type AppProps = {
  bridge?: TauriBridge;
  viewerController?: ViewerActions;
};
```

Add these controller constants after state declarations:

```tsx
  const defaultViewerController = useMemo(() => new ViewerController(), []);
  const activeViewerController = viewerController ?? defaultViewerController;
```

Add this memoized command registry inside `App` after `activeSession`:

```tsx
  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();
    registry.register({ id: 'file.open', label: 'Open File', shortcut: defaultShortcuts.openFile, run: () => void openPdf() });
    registry.register({ id: 'tab.close', label: 'Close Tab', shortcut: defaultShortcuts.closeTab, run: closeActiveTab });
    registry.register({ id: 'find.next', label: 'Find Next', shortcut: defaultShortcuts.findNext, run: () => activeViewerController.searchNext() });
    registry.register({ id: 'find.previous', label: 'Find Previous', shortcut: defaultShortcuts.findPrevious, run: () => activeViewerController.searchPrevious() });
    registry.register({ id: 'sidebar.toggle', label: 'Toggle Sidebar', shortcut: defaultShortcuts.toggleSidebar, run: () => setSidebarOpen((open) => !open) });
    registry.register({ id: 'zoom.in', label: 'Zoom In', shortcut: defaultShortcuts.zoomIn, run: () => activeViewerController.zoomIn() });
    registry.register({ id: 'zoom.out', label: 'Zoom Out', shortcut: defaultShortcuts.zoomOut, run: () => activeViewerController.zoomOut() });
    registry.register({ id: 'history.back', label: 'History Back', shortcut: defaultShortcuts.historyBack, run: () => undefined });
    registry.register({ id: 'history.forward', label: 'History Forward', shortcut: defaultShortcuts.historyForward, run: () => undefined });
    registry.register({ id: 'tab.next', label: 'Next Tab', shortcut: defaultShortcuts.nextTab, run: () => undefined });
    registry.register({ id: 'tab.previous', label: 'Previous Tab', shortcut: defaultShortcuts.previousTab, run: () => undefined });
    return registry;
  }, [activeViewerController, sidebarOpen, activeSession]);
```

Add keyboard effect after the registry:

```tsx
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleShortcutEvent(event, commandRegistry);
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [commandRegistry]);
```

Because `openPdf` and `closeActiveTab` are referenced by `commandRegistry`, place their declarations above `commandRegistry`. Use this final order inside `App`:

1. state declarations
2. `activeSession`
3. `openBytes`
4. `openPdf`
5. `closeActiveTab`
6. `commandRegistry`
7. shortcut `useEffect`
8. `handleDrop`
9. JSX return

- [ ] **Step 6: Run shortcut tests**

Run:

```bash
bun test src/commands/shortcutController.test.ts src/app/App.test.tsx
bun run typecheck
```

Expected:

- Shortcut tests pass.
- App tests pass.
- Typecheck passes.

- [ ] **Step 7: Commit shortcut wiring**

Run:

```bash
git add src/commands/shortcutController.ts src/commands/shortcutController.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: wire reader keyboard shortcuts"
```

## Task 13: Worker Asset And Build Validation

**Files:**

- Create: `public/pdf.worker.min.js`
- Modify: `package.json`

- [ ] **Step 1: Add a worker copy script**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "postinstall": "mkdir -p public && cp node_modules/pdfjs-dist/build/pdf.worker.min.js public/pdf.worker.min.js",
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b",
    "tauri": "tauri"
  }
}
```

- [ ] **Step 2: Run postinstall script**

Run:

```bash
bun run postinstall
```

Expected:

- `public/pdf.worker.min.js` exists.

- [ ] **Step 3: Run full frontend validation**

Run:

```bash
bun run typecheck
bun test
bun run build
```

Expected:

- Typecheck passes.
- All Vitest tests pass.
- Vite build produces `dist/`.

- [ ] **Step 4: Run Rust validation**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- Rust tests pass.

- [ ] **Step 5: Commit worker and build fixes**

Run:

```bash
git add package.json public/pdf.worker.min.js
git commit -m "chore: add PDF worker asset"
```

## Task 14: Session Restore Wiring

**Files:**

- Modify: `src/documents/documentSessionStore.ts`
- Modify: `src/documents/documentSessionStore.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add restore tests to document session store**

Append to `src/documents/documentSessionStore.test.ts`:

```ts
import { restoreDocumentSessions } from './documentSessionStore';

describe('restoreDocumentSessions', () => {
  it('restores desktop path sessions with saved progress', () => {
    const state = restoreDocumentSessions([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 20,
        lastPage: 6,
        progress: 0.3,
        missing: false,
      },
    ]);

    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    expect(state.sessions[0]).toMatchObject({
      documentKey: 'desktop:/tmp/book.pdf',
      page: 6,
      totalPages: 20,
      progress: 0.3,
      status: 'ready',
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test src/documents/documentSessionStore.test.ts
```

Expected:

- FAIL because `restoreDocumentSessions` does not exist.

- [ ] **Step 3: Implement restore in session store**

Modify `src/documents/documentSessionStore.ts` by adding:

```ts
import type { PersistedDocument } from '../persistence/persistenceApi';
```

Add this function:

```ts
export function restoreDocumentSessions(documents: PersistedDocument[]): DocumentState {
  const sessions = documents
    .filter((document) => document.path)
    .map((document) => {
      const source: FileSource = {
        kind: 'desktop-path',
        path: document.path!,
        name: document.displayName,
      };

      return {
        id: createSessionId(document.documentKey),
        documentKey: document.documentKey,
        title: document.displayName,
        source,
        page: document.lastPage,
        totalPages: document.pageCount,
        progress: document.progress,
        zoom: 1,
        status: document.missing ? 'error' : 'ready',
        errorMessage: document.missing ? 'File is missing' : null,
        updatedAt: new Date().toISOString(),
      } satisfies DocumentSession;
    });

  return {
    sessions,
    activeSessionId: sessions[0]?.id ?? null,
  };
}
```

- [ ] **Step 4: Add app restore behavior test**

Append to `src/app/App.test.tsx`:

```tsx
it('restores recent desktop sessions on startup', async () => {
  const persistence = {
    saveDocument: vi.fn(),
    listRecentDocuments: vi.fn().mockResolvedValue([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 20,
        lastPage: 6,
        progress: 0.3,
        missing: false,
      },
    ]),
  };

  render(<App bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }} persistence={persistence} />);

  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Modify App to accept persistence and restore documents**

Modify `src/app/App.tsx` imports:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { createPersistenceApi, type PersistenceApi } from '../persistence/persistenceApi';
```

Modify props:

```tsx
type AppProps = {
  bridge?: TauriBridge;
  persistence?: PersistenceApi;
};
```

Modify function signature:

```tsx
export function App({ bridge = createTauriBridge(), persistence = createPersistenceApi() }: AppProps) {
```

Add restore effect after state declarations:

```tsx
  useEffect(() => {
    let cancelled = false;

    persistence
      .listRecentDocuments()
      .then((documents) => {
        if (!cancelled && documents.length > 0) {
          setDocuments(restoreDocumentSessions(documents));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocuments(createEmptyDocumentState());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [persistence]);
```

Update document store import to include:

```tsx
  restoreDocumentSessions,
```

- [ ] **Step 6: Run restore tests**

Run:

```bash
bun test src/documents/documentSessionStore.test.ts src/app/App.test.tsx
```

Expected:

- PASS.

- [ ] **Step 7: Commit session restore**

Run:

```bash
git add src/documents/documentSessionStore.ts src/documents/documentSessionStore.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: restore recent PDF sessions"
```

## Task 15: Final Validation Pass

**Files:**

- Modify only files required by validation failures.

- [ ] **Step 1: Run full frontend checks**

Run:

```bash
bun run typecheck
bun test
bun run build
```

Expected:

- Typecheck passes.
- All tests pass.
- Build passes.

- [ ] **Step 2: Run Rust checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- Rust tests pass.

- [ ] **Step 3: Check changed files**

Run:

```bash
git status --short
```

Expected:

- Only intentional files are modified.
- Existing unrelated `README.md` changes remain unstaged unless the user explicitly asks to include them.

- [ ] **Step 4: Commit final validation fixes if any**

If validation required fixes, run:

```bash
git add <only-files-fixed-for-validation>
git commit -m "fix: stabilize SmartReader MVP validation"
```

If no fixes were required, do not create an empty commit.

## Plan Self-Review

Spec coverage:

- Local file picker/native dialog: Task 7 and Task 10.
- Drag-drop: Task 11.
- Tauri desktop path reading: Task 7.
- Multi-tab reading and duplicate path focus: Task 2 and Task 10.
- Search/navigation/zoom: Task 8 and Task 9.
- SQLite persistence: Task 5 and Task 6.
- Recent files/session restore: Task 6 and Task 14.
- Shortcuts and keyboard listener: Task 4 and Task 12.
- Cache: Task 3.

Deferred scope already excluded from this MVP plan:

- Bookmarks and annotations are covered by the Phase 2 plan.
- Open With and file association are covered by the desktop polish plan.

Placeholder scan:

- Scanned for incomplete placeholder markers and removed them.
- Every task includes concrete files, commands, and expected results.

Type consistency:

- Frontend persistence uses camelCase to match Rust `serde(rename_all = "camelCase")`.
- `FileSource`, `DocumentSession`, `PersistedDocument`, and `ViewerSource` are shared through explicit module imports.
- `PdfViewerBridge` is the only file that imports `@react-pdf-viewer/*`.
