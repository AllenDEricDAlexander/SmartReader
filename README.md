# SmartReader

SmartReader is a macOS-first local reader MVP for PDF and EPUB files. The current goal is to keep the core reading loop fast and utility-like while proving the desktop shell, shared TypeScript reader state, and renderer adapter boundaries that later platform work can reuse.

## Current MVP Capabilities

- Desktop utility-style layout with tabs, compact toolbar, collapsible sidebar, and document-first reader surface.
- Warm paper-inspired macOS utility styling with compact chrome, subtle document shadows, responsive sidebar behavior, and narrow-window toolbar simplification.
- Local PDF and EPUB open entry points through browser file selection, drag/drop, and Tauri native file dialog.
- PDF reader path backed by EmbedPDF/PDFium through blob URLs, with desktop-path bytes read through the Tauri fs plugin and a validated Rust read fallback.
- Desktop PDF open validation, page-count metadata, and outline extraction are backed by Rust/Tauri commands; PDF search opens the EmbedPDF search surface for both browser-file and desktop-path PDFs.
- EPUB reader path backed by Rust lazy metadata/chapter commands for Tauri desktop files, with NCX fallback, resource metadata, and legal DRM/encryption detection. JSZip remains the browser-file EPUB fallback.
- Sidebar modes for EPUB contents, bookmarks, annotations, and windowed search results. PDF outline and thumbnail navigation are handled inside EmbedPDF so SmartReader does not render a parallel PDF navigation pane.
- EPUB Find bar with current/total result feedback, next/previous result commands, clickable result rows, no-result feedback, and clear behavior. PDF search, page entry, zoom, fit, outline, thumbnails, selection, and annotation tools are delegated to EmbedPDF so SmartReader does not render a second PDF control layer.
- Search feedback uses the EmbedPDF PDF search state for visible PDF matches and marks the current EPUB match while keeping EPUB highlighting bounded to one current match.
- Back/Forward navigation now uses a real per-tab reading history for explicit jumps such as SmartReader page shortcuts, EPUB search result navigation, bookmarks, and EPUB chapter controls. Ordinary scroll, zoom, typing in the find bar, and preference changes do not create history entries.
- PDF continuous scrolling now treats ordinary wheel and trackpad scroll as reading-progress updates only; explicit SmartReader shortcuts, history/bookmark jumps, and EmbedPDF navigation remain hard navigation actions.
- The PDF reader supports trackpad pinch-style zoom through the reader viewport, syncs the requested zoom into EmbedPDF, and clamps zoom through the existing reader zoom range.
- The EPUB contents sidebar supports hierarchical outline expansion and collapse, with separate expand controls, title jump actions, anchor-fragment jumps, parent-before-child ordering, and windowed rendering for large outlines.
- Annotation MVP supports native EmbedPDF PDF annotations and EPUB text annotations for highlight, underline, strikethrough, wavy underline, red-text, text-note, and area workflows, with color, thickness, note font settings, academic tags, per-annotation visibility, filter/search management, automatic session/cache persistence, JSON export/import for native PDF annotations, Markdown export for SmartReader-managed notes, and supported macOS PDFKit managed-copy sync.
- Preferences manage session restore, reading defaults, cache storage location, cache export/import, editable shortcuts, WASM search runtime status, and the native PDFKit annotation-copy toggle.
- Recent files are presented as a grid-based library with PDF/EPUB filters, pinned/favorite filters, visible progress/position/content metadata, delayed hover summary cards that reveal paths only on hover, and a click-through detail panel before opening a document.
- Recent library organization supports multi-level custom categories, category create/rename/merge/delete flows, multi-category assignment, private tag create/edit/delete/color/group controls, default academic tags, tag filters, and batch classify/tag/untag/pin/favorite/delete actions.
- Category-level library encryption protects SmartReader-managed recent metadata, category/tag metadata, restorable session entries, and cache/search metadata for encrypted categories, with storage-atomic reseal and cleanup paths for unlock, move, delete, clear, retention eviction, and failed reopen removal.
- Recent files persist lightweight resume metadata; reopening a desktop recent item restores its saved PDF page or EPUB chapter/scroll position, and already-open desktop paths are focused instead of duplicated.
- App-session restore for desktop-path tabs, active tab, sidebar state, preferences, bookmarks, annotations, zoom, and per-document reading position, including EPUB chapter scroll position.
- Independent per-tab progress tracking so switching between open files keeps the last PDF page or EPUB chapter and chapter scroll position.
- Command registry for primary keyboard shortcuts such as open, close tab, find, find next/previous, sidebar, zoom, bookmark, preferences, location focus, history back/forward, and tab switching, with preference-level shortcut editing and conflict warnings.
- EPUB HTML sanitization before chapter rendering.
- PDF outline entries resolve PDF destinations when available, keep the full resolved outline, and skip malformed entries.
- Tauri desktop host with native app window, native file dialog, PDF/EPUB file associations, Open With event handling, and path-backed recent-file reopen attempts.
- Runtime reader caching for open tabs, EmbedPDF blob URLs, debounced cache persistence, and async desktop document reads to reduce repeat loading and keep large files more responsive.
- Rust-backed desktop EPUB search scans every chapter and returns every match without requiring React to load every chapter into memory.
- Browser EPUB fallback search also returns every same-chapter match without a hard result cap and can use the bundled WASM worker search runtime when indexed chapter text is available, with the JavaScript fallback kept active on failure.
- EmbedPDF now owns the PDF toolbar/sidebar navigation surface, and its light/dark theme is configured to match SmartReader's warm utility colors.
- Reader usability polish includes clearer tab progress, toolbar status, EPUB chapter progress, recent-file metadata, loading states, and narrow-window layout behavior.

## Tech Stack

- React 19
- TypeScript
- Vite
- Vitest
- EmbedPDF React viewer with bundled PDFium runtime for PDF rendering, selection, search state, scroll, and zoom
- JSZip for browser-file EPUB fallback parsing
- A bundled minimal WebAssembly search runtime loaded through a Vite module worker
- Tauri 2 desktop shell with dialog and fs plugins, validated Rust document-read fallback commands, Rust PDF metadata/outline/PDFKit-annotation commands, Rust EPUB metadata/chapter/search commands, and Rust cache import/export/location commands
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

Tauri runs the same Vite frontend and reads desktop PDF/EPUB bytes through the scoped Tauri fs plugin, with validated Rust read commands retained as the fallback path.

## Shared TypeScript Adapter Boundary

- Browser file input, Tauri path access, future React Native file URIs, and WASM-backed reader candidates are represented as file-source boundaries rather than renderer internals.
- `DocumentSession` remains the UI state contract for opened files, including durable bookmarks and annotations.
- `AppSessionSnapshot` stores only durable desktop-path session state and excludes runtime-heavy data such as browser `File` objects, object URLs, PDF proxies, parsed EPUB chapters, outlines, search results, and rendered annotation overlays.
- `RendererAdapter` and related adapter factory types in `src/reader/adapterBoundary.ts` are the extension point for EmbedPDF, the current EPUB reader, future native/React Native renderers, and WASM parser/search adapters.
- Annotation UI, PDF viewer integration, EPUB anchor synchronization, PDFKit annotation synchronization, list windowing, and export helpers are split into focused components, hooks, and reader utilities so `App.tsx` remains the orchestration layer instead of owning every reader detail.
- `src/lib/wasmAdapter.ts`, `src/workers/searchRuntime.worker.ts`, and `src/wasm/search_runtime.wasm` provide the current WASM search runtime boundary with explicit loading, ready, fallback, unavailable, and error states.
- Tauri-specific APIs are isolated in `src/platform/tauriBridge.ts`, with scoped fs-plugin document reads, validated Rust read fallback, Rust desktop PDF metadata/outline validation, and desktop EPUB metadata/search routed through Rust validation.

## Session Restore And Performance Notes

- Desktop-path tabs are restored on app startup when `Reopen last session` is enabled. Browser-only file sessions are not restored because browser `File` handles cannot be reopened after restart.
- Reading progress is saved through session snapshots and recent-file metadata. Reopened desktop documents resume from their last saved PDF page or EPUB chapter/location, including EPUB chapter scroll position, when the file path remains accessible.
- Recent desktop documents that are already open are focused instead of duplicated. Closed recent desktop documents are access-checked, then reopened with the saved recent location.
- Open PDF and EPUB tabs keep an in-memory reader cache during the current app session. Switching back to an already-open tab reuses PDF viewer blob URLs, Rust metadata, or parsed EPUB chapters instead of re-reading and re-parsing the file.
- Back/Forward history is scoped per tab, capped at 100 entries, and cleaned up when the tab closes. Only explicit navigation actions enter the history stack.
- Search result rows update the current match selection before jumping for EPUB chapter navigation. PDF find next/previous and result navigation stay inside the EmbedPDF search UI.
- Recent library cards show progress percentage, page/chapter position, and content context in the grid. The file path is intentionally omitted from the default card and appears only in the delayed hover summary or the detail panel.
- Recent library categories are document metadata rather than copied files, so one paper can belong to multiple custom category folders without duplicating the source PDF/EPUB. Category merge guards reject self/descendant merge targets to keep multi-level trees acyclic.
- Recent library private tags and the built-in academic tags can be applied per document or in batches. Locked encrypted folders redact protected private tags, descendant categories, document metadata, session entries, and cache/search state from normal localStorage persistence.
- Encrypted-category mutations are resealed before redacted metadata is persisted. Failure paths restore the previous safe state, keep existing locked placeholders recoverable, and avoid writing newly protected paths, titles, category names, tag names, session entries, or cache entries in plaintext.
- Recent cleanup paths stay synchronized with encrypted library state: batch delete, Clear Recent, error-page Remove from Recent, moving the last protected document out of a folder, and recent-retention eviction prune orphan encrypted folder payloads or clear stale protection markers instead of leaving an unlock state with no UI entry.
- PDF continuous mode is handled by EmbedPDF scroll/layout state, while SmartReader records page changes without snapping ordinary scroll gestures.
- Visible-page tracking in PDF continuous mode updates the current page without snapping the viewport. Hard page jumps are reserved for explicit SmartReader navigation commands such as previous/next shortcuts, Back/Forward, bookmark jumps, and EmbedPDF navigation actions.
- PDF zoom changes from SmartReader shortcuts and trackpad pinch-style gestures share the same zoom state and `0.5` to `3` clamp. Pinch wheel events are coalesced per animation frame, then applied to the active EmbedPDF document through its zoom plugin.
- PDF text selection, copy, search highlighting, annotation creation, annotation selection/editing, automatic native annotation snapshot restore, and native annotation JSON export/import are handled through EmbedPDF plugins. SmartReader persists EmbedPDF annotation snapshots in the session/cache model and re-imports them when the PDF viewer is ready, but it no longer renders PDF annotation overlays for the default PDF path.
- EPUB contents outline folding is isolated per open document and tolerates jumped outline levels so malformed or partially resolved outlines remain readable instead of disappearing behind a neighboring collapsed row.
- Large EPUB contents outlines are window-rendered in React so the sidebar only mounts rows near the current scroll viewport. Profiling showed DOM volume, not Rust outline extraction or WASM data processing, was the primary bottleneck for large directories.
- Large search result lists and annotation lists are also window-rendered so the sidebar mounts only rows near the current scroll viewport. Search results and annotations remain unlimited at the data level; the UI avoids mounting all rows at once.
- Annotation select/cancel/edit/hide/show/delete actions avoid no-op state writes, imported annotation styles and PDFKit viewport metadata are sanitized, imported native-copy paths are dropped before reuse, EmbedPDF native annotation snapshots are JSON-sanitized before cache reuse, and Markdown export escapes document and user-provided text.
- EPUB text annotation anchors store chapter href, selected text, occurrence context, offsets, surrounding text, and hashes. Native anchor create/resolve/rebind failures persist explicit fallback metadata instead of silently hiding the fallback path.
- EPUB chapter scroll updates are debounced during ordinary scrolling and flushed when changing chapters or unmounting, reducing high-frequency session/recent/cache writes while preserving the latest chapter position.
- Desktop PDF opening validates the path and reads page-count/outline metadata in Rust before React renders through EmbedPDF.
- Desktop-path PDF bytes are read with `@tauri-apps/plugin-fs` and converted to a Blob URL for EmbedPDF. If the fs plugin scope rejects a path, SmartReader falls back to the existing validated Rust `read_document` command.
- Desktop-path PDF annotations can still request an experimental macOS PDFKit managed copy through validated Rust/Tauri commands when the PDFKit copy preference is enabled. Supported PDFKit writeback covers area, note, highlight, underline, strikethrough, and multi-rect text markup; wavy underline and red-text are native EmbedPDF tools in the default PDF path but are not written to the PDFKit managed copy. The original PDF is not overwritten, managed copies are app-owned and document-level, unsafe imported paths are ignored, and native sync is serialized per document to avoid concurrent PDFKit write races.
- PDF outline and thumbnail navigation is delegated to EmbedPDF; SmartReader no longer renders a second PDF contents or thumbnail sidebar outside the viewer.
- PDF search is fully delegated to EmbedPDF for both desktop-path and browser-file PDFs. SmartReader opens the package search surface and does not build parallel PDF search rows, page-result state, or highlight overlays.
- Tauri document reads prefer the fs plugin for direct bytes and retain an async Rust command fallback that validates PDF/EPUB paths and performs blocking filesystem reads off the async command executor.
- Desktop EPUB opening uses Rust to read package/spine/nav or NCX metadata first, then loads the active chapter on demand. This avoids transferring and parsing the full book in React before first render.
- Desktop EPUB search uses a Rust command that scans chapters sequentially and returns all matches, skipping unreadable chapter entries instead of failing the entire document search.
- Browser-file EPUB search uses the shared fallback adapter and collects every match within each chapter. Browser EPUB text payloads can be indexed by the bundled WASM worker search runtime; fallback remains active when WASM is unavailable or errors. EPUB browser/WASM results carry match occurrence metadata so Find next/previous can move the current mark within a chapter.
- Desktop EPUB parsing now detects `META-INF/rights.xml`, `META-INF/encryption.xml`, and encrypted spine/navigation/chapter resources. SmartReader reports encrypted/DRM books as unsupported encrypted documents and does not decrypt or bypass protection.
- Desktop EPUB metadata includes manifest resource entries, preserved EPUB nav/NCX anchor fragments, and parent-before-child outline ordering, which lets the UI expose safe resource availability and reliable chapter jumps without injecting raw resource URLs or unsanitized HTML.
- SmartReader cache data can stay in the default app state directory or move to a custom directory from Preferences. Cache export/import uses a schema-v1 JSON archive containing settings, recent-file metadata, reading progress, durable session state, and adapter metadata only.
- Runtime cache persistence is debounced during high-frequency reading progress changes such as continuous scrolling and pinch zooming, then flushed after the activity settles.
- Cache import/export deliberately excludes browser `File` objects, object URLs, PDF proxies, parsed EPUB chapter text, raw search payloads, raw document bytes, rendered annotation overlays, and other runtime-only data. Invalid or unsafe archives are rejected before they can overwrite the active cache.
- Browser-file EPUBs still use the JSZip fallback path and are cleaned up by revoking object URLs when their tabs close.
- Reader caches, search handlers, async response guards, and HUD timers are cleaned up on tab close or unmount to reduce retained memory risks.

## UI Direction And QA Notes

- The current visual direction follows the latest local UI prototype in `/Users/mario/Downloads/app.html`: warm neutral chrome, paper-like reader surfaces, restrained brown accent states, and low-noise utility controls.
- The CSS implementation keeps the existing React structure and Tauri desktop shell behavior intact. The tab strip still preserves desktop drag regions while interactive tab, toolbar, and new-tab controls remain non-drag regions.
- Reader interaction checks cover continuous PDF scrolling without automatic page snapping, explicit previous/next page jumps, Back/Forward history, EPUB search next/previous, clickable EPUB search-result jumps, EPUB current-match highlighting, EmbedPDF selection/search/navigation integration, pinch-style zoom coalescing, debounced cache persistence, EPUB chapter scroll restore, EPUB anchor-fragment outline jumps, search-result windowing, annotation list windowing, EPUB contents outline expand/collapse behavior, and synthetic 10k-row outline windowing.
- Recent library checks cover grid rendering, delayed hover path disclosure, detail-before-open behavior, category/tag filters, multi-level category merge safety, batch delete, category/tag batch actions, storage-atomic folder encryption, unlock/reseal failure rollback, locked-placeholder deletion, protected real-path retention eviction, and 390px empty-workspace Open File hit testing.
- Annotation checks cover quick-menu creation, selected-state cancel/edit flows, rename, font settings, filter, hide/show, jump, delete with confirmation, Markdown export escaping, cache persistence, session restore, PDFKit native-copy status, failed sync retry, managed-copy path safety, serialized document sync, and large-list rendering behavior.
- Responsive checks cover wide desktop, 900px sidebar overlay behavior, 760px toolbar simplification, and 720px narrow-window overflow handling.
- The latest UI review passed shell, preferences, sidebar, recent-file, empty-state, reader interaction, build, and test checks. Real PDF/EPUB document visual QA and macOS trackpad pinch QA should still be repeated manually in the Tauri app before a signed release.

## Roadmap Notes

React Native/mobile remains a future platform track. Current roadmap work is frozen around desktop reading-loop stability until normal PDF/EPUB opening, scrolling, zooming, outlines, search, annotations, and page rendering stay reliable on real documents. Near-term work should stay focused on Tauri macOS reading hardening, real-document QA, annotation anchoring quality, and export polish. Signing, notarization, deeper PDFKit editing/printing work, deeper parser/runtime expansion, Rust-side outline indexing, and full PDF/EPUB parsing in WASM remain later work unless profiling shows React-side windowing is no longer the dominant fix.

## Current Limitations

- The Tauri shell is present, but release signing/notarization is not configured.
- DMG packaging is available through `bun run desktop:build:dmg` and `./scripts/build-desktop.sh dmg`, but it is not enabled in the default `desktop:build` target. The default desktop build still produces the macOS `.app` bundle.
- Windows and Linux installer packaging is exposed through `./scripts/build-desktop.sh`, but those targets still require matching host operating systems and their native packaging toolchains.
- PDFKit support is limited to experimental macOS managed-copy annotation sync. Native PDFKit view embedding, native PDFKit text selection, direct in-PDF annotation editing UI, page raster rendering, and printing are not implemented. Native PDFKit annotation sync writes only to an app-owned managed copy and never overwrites the source PDF.
- EPUB support now includes EPUB3 nav plus NCX fallback, anchor-fragment outline jumps, resource metadata, legal DRM/encryption detection, and CFI-style front-end text annotation anchors with occurrence and context metadata. It still does not provide full EPUB3 fixed-layout/media-overlay/advanced CSS fidelity, DRM provider integration, decryption, full EPUB CFI spec interoperability, or advanced layout fidelity.
- Annotation creation, selected-state editing, rename, Markdown export, persistence, wavy underline, red text override, box/area annotations, font-customized notes, visibility/filter management, and supported native PDFKit managed-copy sync are implemented. Printing, multi-window behavior, native writeback for wavy/red-text styles, and direct native PDFKit edit UI remain deferred.
- Browser-only recent entries may still require choosing the file again. Tauri recent entries store paths and attempt direct reopen.
- Recent library folder encryption protects SmartReader-managed metadata and recovery/cache state. It does not encrypt, move, duplicate, or overwrite the original PDF/EPUB files on disk; source-file protection remains the responsibility of the operating system or the storage location chosen by the user.
- Browser-file PDF annotations work in the current open tab, but automatic session/cache restore applies only to restorable desktop-path PDF sessions; browser `File` handles still cannot be reopened after restart.
- Browser-file and desktop-path PDFs render, select, annotate, and search through EmbedPDF. Desktop-path PDFs still add Rust page-count and outline metadata before the viewer renders.
- Desktop EPUB search results currently provide per-chapter occurrence ordering rather than exact Rust-side character offsets, so current-match highlighting is occurrence-based until a richer Rust search contract is added.
- Default PDF annotations are native EmbedPDF annotations with automatic session/cache snapshot restore plus JSON export/import through the PDF annotation toolbar actions. EPUB text annotations store a CFI-style front-end anchor with occurrence/context data and still rebind against chapter content, so heavily duplicated text with identical surrounding context can still require fallback handling.
- Mobile clients are not implemented.
- A minimal bundled WASM worker search runtime is implemented for indexed text payloads. Full PDF/EPUB parser/search runtimes in WASM are not implemented yet.
