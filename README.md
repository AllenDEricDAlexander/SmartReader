# SmartReader

SmartReader is a macOS-first local reader MVP for PDF and EPUB files. The current goal is to keep the core reading loop fast and utility-like while proving the desktop shell, shared TypeScript reader state, and renderer adapter boundaries that later platform work can reuse.

## Current MVP Capabilities

- Desktop utility-style layout with tabs, compact toolbar, collapsible sidebar, and document-first reader surface.
- Warm paper-inspired macOS utility styling with compact chrome, subtle document shadows, responsive sidebar behavior, and narrow-window toolbar simplification.
- Local PDF and EPUB open entry points through browser file selection, drag/drop, and Tauri native file dialog.
- PDF reader path backed by PDF.js, lazy-loaded behind the reader boundary.
- Desktop PDF open validation, page-count metadata, outline extraction, and bounded search are backed by Rust/Tauri commands.
- EPUB reader path backed by Rust lazy metadata/chapter commands for Tauri desktop files, with a JSZip-based DRM-free EPUB parser kept for browser file fallback.
- Sidebar modes for contents, PDF thumbnails, bookmarks, and search results.
- Find bar, page/location controls, zoom controls, PDF fit modes, bookmark toggling, and preferences dialog.
- Recent files persisted in local storage with lightweight resume metadata.
- App-session restore for desktop-path tabs, active tab, sidebar state, preferences, bookmarks, zoom, and per-document reading position.
- Independent per-tab progress tracking so switching between open files keeps the last PDF page or EPUB chapter/location.
- Command registry for primary keyboard shortcuts such as open, close tab, find, sidebar, zoom, bookmark, preferences, location focus, and tab switching.
- EPUB HTML sanitization before chapter rendering.
- PDF outline entries resolve PDF destinations when available, keep the full resolved outline, and skip malformed entries.
- Tauri desktop host with native app window, native file dialog, PDF/EPUB file associations, Open With event handling, and path-backed recent-file reopen attempts.
- Runtime reader caching for open tabs, lazy PDF page rendering, and async Rust document reads to reduce repeat loading and keep large files more responsive.
- Rust-backed desktop EPUB search scans the book without requiring React to load every chapter into memory.
- Reader usability polish includes clearer tab progress, toolbar status, EPUB chapter progress, recent-file metadata, loading states, and narrow-window layout behavior.

## Tech Stack

- React 19
- TypeScript
- Vite
- Vitest
- PDF.js via `pdfjs-dist`
- JSZip for browser-file EPUB fallback parsing
- Tauri 2 desktop shell with dialog plugin, validated Rust document-read commands, Rust PDF metadata/outline/search commands, and Rust EPUB metadata/chapter/search commands
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

For a local macOS DMG build with dependency checks and the required web build step:

```bash
./scripts/build-dmg.sh
```

Use `./scripts/build-dmg.sh --debug` for a debug DMG. The script prints the generated DMG path under `src-tauri/target/*/bundle/dmg/` when the build completes.

For the shared local desktop packaging entry point:

```bash
./scripts/build-desktop.sh dmg
./scripts/build-desktop.sh win
./scripts/build-desktop.sh linux
./scripts/build-desktop.sh all
./scripts/build-desktop.sh dmg --debug
```

`build-desktop.sh` uses the project Tauri CLI through npm and prints the generated artifact paths. `dmg` must run on macOS, `win` builds Windows `nsis` and `msi` installers on Windows, and `linux` builds `deb` and `rpm` packages on Linux with the required system packaging tools. `all` only builds targets supported by the current host OS and skips the other operating systems with an explicit message.

Tauri runs the same Vite frontend and uses Rust commands for validated PDF/EPUB document reads instead of exposing broad renderer filesystem permissions.

## Shared TypeScript Adapter Boundary

- Browser file input, Tauri path access, future React Native file URIs, and future WASM memory-backed readers are represented as file-source boundaries rather than renderer internals.
- `DocumentSession` remains the UI state contract for opened files.
- `AppSessionSnapshot` stores only durable desktop-path session state and excludes runtime-heavy data such as browser `File` objects, object URLs, PDF proxies, parsed EPUB chapters, outlines, and search results.
- `RendererAdapter` and related adapter factory types in `src/reader/adapterBoundary.ts` are the extension point for PDF.js, the current EPUB reader, future PDFKit, future React Native renderers, and future WASM parser/search adapters.
- Tauri-specific APIs are isolated in `src/platform/tauriBridge.ts`, with native document reads plus desktop PDF and EPUB metadata/search routed through Rust validation instead of broad renderer filesystem permissions.

## Session Restore And Performance Notes

- Desktop-path tabs are restored on app startup when `Reopen last session` is enabled. Browser-only file sessions are not restored because browser `File` handles cannot be reopened after restart.
- Reading progress is saved through session snapshots and recent-file metadata. Reopened desktop documents resume from their last saved PDF page or EPUB chapter/location when the file path remains accessible.
- Open PDF and EPUB tabs keep an in-memory reader cache during the current app session. Switching back to an already-open tab reuses loaded PDF proxies or parsed EPUB chapters instead of re-reading and re-parsing the file.
- PDF continuous mode renders visible and near-visible pages first through `IntersectionObserver`, leaving offscreen pages as placeholders until they approach the viewport.
- Desktop PDF opening validates the path and reads page-count/outline metadata in Rust before React renders pages. The renderer still uses PDF.js canvas output for visible page painting.
- Desktop PDF search uses a Rust command with a bounded result limit, so React does not scan page text for path-backed desktop PDFs.
- Tauri document reads run through an async Rust command that validates PDF/EPUB paths and performs blocking filesystem reads off the async command executor.
- Desktop EPUB opening uses Rust to read package/spine/nav metadata first, then loads the active chapter on demand. This avoids transferring and parsing the full book in React before first render.
- Desktop EPUB search uses a Rust command that scans chapters sequentially with a bounded result limit, so search is not limited to chapters already loaded in the React cache.
- Browser-file EPUBs still use the JSZip fallback path and are cleaned up by revoking object URLs when their tabs close.
- Reader caches, search handlers, async response guards, and HUD timers are cleaned up on tab close or unmount to reduce retained memory risks.

## UI Direction And QA Notes

- The current visual direction follows the latest local UI prototype in `/Users/mario/Downloads/app.html`: warm neutral chrome, paper-like reader surfaces, restrained brown accent states, and low-noise utility controls.
- The CSS implementation keeps the existing React structure and Tauri desktop shell behavior intact. The tab strip still preserves desktop drag regions while interactive tab, toolbar, and new-tab controls remain non-drag regions.
- Responsive checks cover wide desktop, 900px sidebar overlay behavior, 760px toolbar simplification, and 720px narrow-window overflow handling.
- The latest UI review passed shell, preferences, sidebar, recent-file, empty-state, build, and test checks. Real PDF/EPUB document visual QA should still be repeated manually in the Tauri app before a signed release.

## Roadmap Notes

React Native/mobile and WASM are future platform tracks, not current runtime capabilities. The intended next platform work is to harden the Tauri macOS path with signing, notarization, richer file-open lifecycle QA, and validation of whether PDF.js is sufficient or whether PDFKit should replace or augment the PDF path. React Native mobile clients, shared TypeScript state reuse, WASM parser/search adapters, and platform-specific PDF/EPUB bridges remain later expansion work after the desktop reading loop is stable.

## Current Limitations

- The Tauri shell is present, but release signing/notarization is not configured.
- DMG packaging is available through `npm run desktop:build:dmg` and `./scripts/build-desktop.sh dmg`, but it is not enabled in the default `desktop:build` target. The default desktop build still produces the macOS `.app` bundle.
- Windows and Linux installer packaging is exposed through `./scripts/build-desktop.sh`, but those targets still require matching host operating systems and their native packaging toolchains.
- PDFKit integration is not implemented; PDF rendering currently uses PDF.js.
- EPUB support is an MVP DRM-free parser and renderer. It does not provide full EPUB3 compatibility, DRM handling, embedded asset rewriting, annotations, or advanced layout fidelity.
- Printing, annotation editing, custom shortcut editing, and multi-window behavior are deferred.
- Browser-only recent entries may still require choosing the file again. Tauri recent entries store paths and attempt direct reopen.
- Mobile clients are not implemented.
- WASM parser/search adapters are not implemented.
