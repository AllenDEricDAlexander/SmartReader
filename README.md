# SmartReader

SmartReader is a macOS-first local reader MVP for PDF and EPUB files. The current goal is to keep the core reading loop fast and utility-like while proving the desktop shell, shared TypeScript reader state, and renderer adapter boundaries that later platform work can reuse.

## Current MVP Capabilities

- Desktop utility-style layout with tabs, compact toolbar, collapsible sidebar, and document-first reader surface.
- Warm paper-inspired macOS utility styling with compact chrome, subtle document shadows, responsive sidebar behavior, and narrow-window toolbar simplification.
- Local PDF and EPUB open entry points through browser file selection, drag/drop, and Tauri native file dialog.
- PDF reader path backed by PDF.js, lazy-loaded behind the reader boundary, with an experimental macOS PDFKit raster path available behind a preference flag for desktop-path PDFs.
- Desktop PDF open validation, page-count metadata, outline extraction, and unbounded path-backed search are backed by Rust/Tauri commands.
- EPUB reader path backed by Rust lazy metadata/chapter commands for Tauri desktop files, with NCX fallback, resource metadata, and legal DRM/encryption detection. JSZip remains the browser-file EPUB fallback.
- Sidebar modes for contents, windowed PDF thumbnails, bookmarks, and windowed search results.
- Find bar with current/total result feedback, next/previous result commands, no-result feedback, clear behavior, page/location controls, zoom controls, PDF fit modes, bookmark toggling, and preferences dialog.
- Search feedback highlights PDF pages with matching results and marks the current EPUB match while keeping EPUB highlighting bounded to one current match.
- Back/Forward navigation now uses a real per-tab reading history for explicit jumps such as page input, outline clicks, thumbnail clicks, search result navigation, and EPUB chapter controls. Ordinary scroll, zoom, typing in the find bar, and preference changes do not create history entries.
- PDF continuous scrolling now treats ordinary wheel and trackpad scroll as reading-progress updates only; explicit page controls, shortcuts, page input, thumbnails, and outline title clicks remain hard navigation actions.
- The PDF reader supports trackpad pinch-style zoom through the reader viewport, keeps zoom controls in sync, and clamps zoom through the existing reader zoom range.
- The contents sidebar supports hierarchical outline expansion and collapse, with separate expand controls, title jump actions, and windowed rendering for large outlines.
- Preferences manage session restore, reading defaults, cache storage location, cache export/import, editable shortcuts, WASM search runtime status, and the experimental PDFKit renderer toggle.
- Recent files persist lightweight resume metadata; reopening a desktop recent item restores its saved PDF page or EPUB chapter/scroll position, and already-open desktop paths are focused instead of duplicated.
- App-session restore for desktop-path tabs, active tab, sidebar state, preferences, bookmarks, zoom, and per-document reading position, including EPUB chapter scroll position.
- Independent per-tab progress tracking so switching between open files keeps the last PDF page or EPUB chapter and chapter scroll position.
- Command registry for primary keyboard shortcuts such as open, close tab, find, find next/previous, sidebar, zoom, bookmark, preferences, location focus, history back/forward, and tab switching, with preference-level shortcut editing and conflict warnings.
- EPUB HTML sanitization before chapter rendering.
- PDF outline entries resolve PDF destinations when available, keep the full resolved outline, and skip malformed entries.
- Tauri desktop host with native app window, native file dialog, PDF/EPUB file associations, Open With event handling, and path-backed recent-file reopen attempts.
- Runtime reader caching for open tabs, lazy PDF page rendering, debounced cache persistence, and async Rust document reads to reduce repeat loading and keep large files more responsive.
- Rust-backed desktop EPUB search scans every chapter and returns every match without requiring React to load every chapter into memory.
- Browser-file PDF and EPUB fallback search also returns every same-page or same-chapter match without a hard result cap. Browser EPUB search can use the bundled WASM worker search runtime when indexed chapter text is available, with the JavaScript fallback kept active on failure.
- Desktop-path PDF thumbnails use the existing bounded PDFKit raster command for visible sidebar rows. Browser-file PDFs keep page-number thumbnail placeholders.
- Reader usability polish includes clearer tab progress, toolbar status, EPUB chapter progress, recent-file metadata, loading states, and narrow-window layout behavior.

## Tech Stack

- React 19
- TypeScript
- Vite
- Vitest
- PDF.js via `pdfjs-dist`
- JSZip for browser-file EPUB fallback parsing
- A bundled minimal WebAssembly search runtime loaded through a Vite module worker
- Tauri 2 desktop shell with dialog plugin, validated Rust document-read commands, Rust PDF metadata/outline/search/PDFKit-raster commands, Rust EPUB metadata/chapter/search commands, and Rust cache import/export/location commands
- Bun for frontend dependency installation, script execution, tests, web builds, and Tauri command entry points
- CSS modules are not used; styling is in `src/styles.css`

## Web Run, Test, And Build

Install dependencies:

```bash
bun install
```

Start the local development server:

```bash
bun run dev
```

The dev server binds to `127.0.0.1` through the configured Vite script.

Run tests:

```bash
bun run test
```

Build the production web shell:

```bash
bun run build
```

Optional watch mode for tests:

```bash
bun run test:watch
```

## Desktop / Tauri Run And Build

Run the macOS desktop app in development:

```bash
bun run desktop:dev
```

Build the macOS desktop app bundle:

```bash
bun run desktop:build
```

The default desktop build target remains the macOS `.app` bundle. For explicit packaging flows:

```bash
bun run desktop:build:app
bun run desktop:build:dmg
bun run desktop:build:debug
bun run desktop:build:debug:dmg
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

`build-desktop.sh` uses the project Tauri CLI through Bun and prints the generated artifact paths. `dmg` must run on macOS, `win` builds Windows `nsis` and `msi` installers on Windows, and `linux` builds `deb` and `rpm` packages on Linux with the required system packaging tools. `all` only builds targets supported by the current host OS and skips the other operating systems with an explicit message.

Tauri runs the same Vite frontend and uses Rust commands for validated PDF/EPUB document reads instead of exposing broad renderer filesystem permissions.

## Shared TypeScript Adapter Boundary

- Browser file input, Tauri path access, future React Native file URIs, and WASM-backed reader candidates are represented as file-source boundaries rather than renderer internals.
- `DocumentSession` remains the UI state contract for opened files.
- `AppSessionSnapshot` stores only durable desktop-path session state and excludes runtime-heavy data such as browser `File` objects, object URLs, PDF proxies, parsed EPUB chapters, outlines, and search results.
- `RendererAdapter` and related adapter factory types in `src/reader/adapterBoundary.ts` are the extension point for PDF.js, the current EPUB reader, the experimental PDFKit raster bridge, future React Native renderers, and WASM parser/search adapters.
- `src/lib/wasmAdapter.ts`, `src/workers/searchRuntime.worker.ts`, and `src/wasm/search_runtime.wasm` provide the current WASM search runtime boundary with explicit loading, ready, fallback, unavailable, and error states.
- Tauri-specific APIs are isolated in `src/platform/tauriBridge.ts`, with native document reads plus desktop PDF and EPUB metadata/search routed through Rust validation instead of broad renderer filesystem permissions.

## Session Restore And Performance Notes

- Desktop-path tabs are restored on app startup when `Reopen last session` is enabled. Browser-only file sessions are not restored because browser `File` handles cannot be reopened after restart.
- Reading progress is saved through session snapshots and recent-file metadata. Reopened desktop documents resume from their last saved PDF page or EPUB chapter/location, including EPUB chapter scroll position, when the file path remains accessible.
- Recent desktop documents that are already open are focused instead of duplicated. Closed recent desktop documents are access-checked, then reopened with the saved recent location.
- Open PDF and EPUB tabs keep an in-memory reader cache during the current app session. Switching back to an already-open tab reuses loaded PDF proxies or parsed EPUB chapters instead of re-reading and re-parsing the file.
- Back/Forward history is scoped per tab, capped at 100 entries, and cleaned up when the tab closes. Only explicit navigation actions enter the history stack.
- PDF continuous mode renders visible and near-visible pages first through `IntersectionObserver`, leaving offscreen pages as placeholders until they approach the viewport.
- Visible-page tracking in PDF continuous mode updates the current page without snapping the viewport. Hard page jumps are reserved for explicit navigation commands such as previous/next shortcuts, page input, thumbnail clicks, and outline title clicks.
- PDF zoom changes from toolbar controls and trackpad pinch-style gestures share the same zoom state and `0.5` to `3` clamp. Pinch wheel events are coalesced per animation frame to avoid repeated full-page rerenders while the gesture is still moving.
- PDF page rendering cancels stale PDF.js render tasks during zoom, scroll, and unmount transitions so cancelled work does not surface as a user-facing page render failure.
- Contents outline folding is isolated per open document and tolerates jumped outline levels so malformed or partially resolved outlines remain readable instead of disappearing behind a neighboring collapsed row.
- Large contents outlines are window-rendered in React so the sidebar only mounts rows near the current scroll viewport. Profiling showed DOM volume, not Rust outline extraction or WASM data processing, was the primary bottleneck for large directories.
- Large search result lists and PDF thumbnail lists are also window-rendered so the sidebar mounts only rows near the current scroll viewport. Search results remain unlimited at the data level; the UI avoids mounting all rows at once.
- EPUB chapter scroll updates are debounced during ordinary scrolling and flushed when changing chapters or unmounting, reducing high-frequency session/recent/cache writes while preserving the latest chapter position.
- Desktop PDF opening validates the path and reads page-count/outline metadata in Rust before React renders pages. The default renderer still uses PDF.js canvas output for visible page painting.
- The experimental macOS PDFKit renderer can rasterize desktop-path PDF pages through a bounded Rust/Tauri command. It is opt-in, macOS-only, and falls back to PDF.js if the command is unavailable or fails.
- Desktop-path PDF thumbnail previews reuse the bounded macOS PDFKit raster command for individual visible pages, with per-page failure placeholders so one failed thumbnail does not affect the main reader.
- Desktop PDF search uses a Rust command that returns all matching pages for path-backed desktop PDFs, so React does not scan page text for those files.
- Tauri document reads run through an async Rust command that validates PDF/EPUB paths and performs blocking filesystem reads off the async command executor.
- Desktop EPUB opening uses Rust to read package/spine/nav or NCX metadata first, then loads the active chapter on demand. This avoids transferring and parsing the full book in React before first render.
- Desktop EPUB search uses a Rust command that scans chapters sequentially and returns all matches, skipping unreadable chapter entries instead of failing the entire document search.
- Browser-file PDF and EPUB search use the shared fallback search adapter and collect every match within each page or chapter. Browser EPUB text payloads can be indexed by the bundled WASM worker search runtime; fallback remains active when WASM is unavailable or errors. EPUB browser/WASM results carry match occurrence metadata so Find next/previous can move the current mark within a chapter.
- Desktop EPUB parsing now detects `META-INF/rights.xml`, `META-INF/encryption.xml`, and encrypted spine/navigation/chapter resources. SmartReader reports encrypted/DRM books as unsupported encrypted documents and does not decrypt or bypass protection.
- Desktop EPUB metadata includes manifest resource entries and NCX fallback outlines, which lets the UI expose safe resource availability without injecting raw resource URLs or unsanitized HTML.
- SmartReader cache data can stay in the default app state directory or move to a custom directory from Preferences. Cache export/import uses a schema-v1 JSON archive containing settings, recent-file metadata, reading progress, durable session state, and adapter metadata only.
- Runtime cache persistence is debounced during high-frequency reading progress changes such as continuous scrolling and pinch zooming, then flushed after the activity settles.
- Cache import/export deliberately excludes browser `File` objects, object URLs, PDF proxies, parsed EPUB chapter text, raw search payloads, raw document bytes, and other runtime-only data. Invalid or unsafe archives are rejected before they can overwrite the active cache.
- Browser-file EPUBs still use the JSZip fallback path and are cleaned up by revoking object URLs when their tabs close.
- Reader caches, search handlers, async response guards, and HUD timers are cleaned up on tab close or unmount to reduce retained memory risks.

## UI Direction And QA Notes

- The current visual direction follows the latest local UI prototype in `/Users/mario/Downloads/app.html`: warm neutral chrome, paper-like reader surfaces, restrained brown accent states, and low-noise utility controls.
- The CSS implementation keeps the existing React structure and Tauri desktop shell behavior intact. The tab strip still preserves desktop drag regions while interactive tab, toolbar, and new-tab controls remain non-drag regions.
- Reader interaction checks cover continuous PDF scrolling without automatic page snapping, explicit previous/next page jumps, Back/Forward history, search next/previous, current search highlights, pinch-style zoom coalescing, stale PDF.js render cancellation, debounced cache persistence, EPUB chapter scroll restore, PDF thumbnail windowing, search-result windowing, contents outline expand/collapse behavior, and synthetic 10k-row outline windowing.
- Responsive checks cover wide desktop, 900px sidebar overlay behavior, 760px toolbar simplification, and 720px narrow-window overflow handling.
- The latest UI review passed shell, preferences, sidebar, recent-file, empty-state, reader interaction, build, and test checks. Real PDF/EPUB document visual QA and macOS trackpad pinch QA should still be repeated manually in the Tauri app before a signed release.

## Roadmap Notes

React Native/mobile remains a future platform track. Current roadmap work is frozen around desktop reading-loop stability until normal PDF/EPUB opening, scrolling, zooming, outlines, and page rendering stay reliable on real documents. The only near-term roadmap work in this iteration is Tauri macOS reading hardening and real-document QA. Signing, notarization, broader PDFKit work, deeper parser/runtime expansion, Rust-side outline indexing, and full PDF/EPUB parsing in WASM remain later work unless profiling shows React-side windowing is no longer the dominant fix.

## Current Limitations

- The Tauri shell is present, but release signing/notarization is not configured.
- DMG packaging is available through `bun run desktop:build:dmg` and `./scripts/build-desktop.sh dmg`, but it is not enabled in the default `desktop:build` target. The default desktop build still produces the macOS `.app` bundle.
- Windows and Linux installer packaging is exposed through `./scripts/build-desktop.sh`, but those targets still require matching host operating systems and their native packaging toolchains.
- PDFKit support is experimental, macOS-only, page-raster based, and opt-in. PDF.js remains the default renderer and fallback; native PDFKit view embedding, selection, annotations, and printing are not implemented.
- EPUB support now includes EPUB3 nav plus NCX fallback, resource metadata, and legal DRM/encryption detection. It still does not provide full EPUB3 fixed-layout/media-overlay/advanced CSS fidelity, DRM provider integration, decryption, annotations, or advanced layout fidelity.
- Printing, annotation editing, and multi-window behavior are deferred.
- Browser-only recent entries may still require choosing the file again. Tauri recent entries store paths and attempt direct reopen.
- Browser-file PDF thumbnail rows use page-number placeholders because the image preview path currently depends on the desktop PDFKit raster command.
- PDF thumbnail raster calls are windowed by visible sidebar rows but are not globally cancellable; fast scrubbing through very large PDFs may still queue native raster work.
- Desktop EPUB search results currently provide per-chapter occurrence ordering rather than exact Rust-side character offsets, so current-match highlighting is occurrence-based until a richer Rust search contract is added.
- Mobile clients are not implemented.
- A minimal bundled WASM worker search runtime is implemented for indexed text payloads. Full PDF/EPUB parser/search runtimes in WASM are not implemented yet.
