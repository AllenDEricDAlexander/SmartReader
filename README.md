# SmartReader

SmartReader is a macOS-first local reader MVP for PDF and EPUB files. The current goal is to keep the core reading loop fast and utility-like while proving the desktop shell, shared TypeScript reader state, and renderer adapter boundaries that later platform work can reuse.

## Current MVP Capabilities

- Desktop utility-style layout with tabs, compact toolbar, collapsible sidebar, and document-first reader surface.
- Local PDF and EPUB open entry points through browser file selection, drag/drop, and Tauri native file dialog.
- PDF reader path backed by PDF.js, lazy-loaded behind the reader boundary.
- EPUB reader path backed by a JSZip-based DRM-free EPUB package/spine parser.
- Sidebar modes for contents, PDF thumbnails, bookmarks, and search results.
- Find bar, page/location controls, zoom controls, PDF fit modes, bookmark toggling, and preferences dialog.
- Recent files persisted in local storage with lightweight resume metadata.
- Command registry for primary keyboard shortcuts such as open, close tab, find, sidebar, zoom, bookmark, preferences, location focus, and tab switching.
- EPUB HTML sanitization before chapter rendering.
- PDF outline entries resolve PDF destinations when available and skip malformed entries.
- Tauri desktop host with native app window, native file dialog, PDF/EPUB file associations, Open With event handling, and path-backed recent-file reopen attempts.

## Tech Stack

- React 19
- TypeScript
- Vite
- Vitest
- PDF.js via `pdfjs-dist`
- JSZip for MVP EPUB package parsing
- Tauri 2 desktop shell with dialog plugin and validated Rust document-read commands
- CSS modules are not used; styling is in `src/styles.css`

## Web Run, Test, And Build

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

The dev server binds to `127.0.0.1` through the configured Vite script.

Run tests:

```bash
npm test
```

Build the production web shell:

```bash
npm run build
```

Optional watch mode for tests:

```bash
npm run test:watch
```

## Desktop / Tauri Run And Build

Run the macOS desktop app in development:

```bash
npm run desktop:dev
```

Build the macOS desktop app bundle:

```bash
npm run desktop:build
```

The default desktop build target remains the macOS `.app` bundle. For explicit packaging flows:

```bash
npm run desktop:build:app
npm run desktop:build:dmg
npm run desktop:build:debug
npm run desktop:build:debug:dmg
```

`desktop:build:app` produces only the `.app` bundle. `desktop:build:dmg` uses Tauri's native macOS bundler to produce a DMG installer. The debug variants keep the same bundle choices while building the Rust/Tauri shell with debug settings.

Tauri runs the same Vite frontend and uses Rust commands for validated PDF/EPUB document reads instead of exposing broad renderer filesystem permissions.

## Shared TypeScript Adapter Boundary

- Browser file input, Tauri path access, future React Native file URIs, and future WASM memory-backed readers are represented as file-source boundaries rather than renderer internals.
- `DocumentSession` remains the UI state contract for opened files.
- `RendererAdapter` and related adapter factory types in `src/reader/adapterBoundary.ts` are the extension point for PDF.js, the current EPUB reader, future PDFKit, future React Native renderers, and future WASM parser/search adapters.
- Tauri-specific APIs are isolated in `src/platform/tauriBridge.ts`, with native document reads routed through Rust validation instead of broad renderer filesystem permissions.

## Roadmap Notes

React Native/mobile and WASM are future platform tracks, not current runtime capabilities. The intended next platform work is to harden the Tauri macOS path with signing, notarization, richer file-open lifecycle QA, and validation of whether PDF.js is sufficient or whether PDFKit should replace or augment the PDF path. React Native mobile clients, shared TypeScript state reuse, WASM parser/search adapters, and platform-specific PDF/EPUB bridges remain later expansion work after the desktop reading loop is stable.

## Current Limitations

- The Tauri shell is present, but release signing/notarization is not configured.
- DMG packaging is available through `npm run desktop:build:dmg`, but it is not enabled in the default `desktop:build` target. The default desktop build still produces the macOS `.app` bundle.
- PDFKit integration is not implemented; PDF rendering currently uses PDF.js.
- EPUB support is an MVP DRM-free parser and renderer. It does not provide full EPUB3 compatibility, DRM handling, embedded asset rewriting, annotations, or advanced layout fidelity.
- Printing, annotation editing, custom shortcut editing, and multi-window behavior are deferred.
- Browser-only recent entries may still require choosing the file again. Tauri recent entries store paths and attempt direct reopen.
- Mobile clients are not implemented.
- WASM parser/search adapters are not implemented.
