# SmartReader Reading Progress Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `lastPage`, `pageCount`, and derived reading progress while refreshing SmartReader's in-memory recent-file/history data immediately after opening or paging through a PDF.

**Architecture:** Keep ownership in `ReaderApp`, because it already owns active `DocumentSession` state, `recentDocuments`, and persistence wiring. Add a small, typed recent-document synchronization helper and route document saves through a debounced flush, while preserving the existing viewer/opening/session-restore flow. No database migration is needed because the persistence model and SQLite schema already contain the required fields.

**Tech Stack:** React 19, TypeScript, Vite/Vitest, Tauri persistence commands, existing `createDebouncedFlush` helper.

---

## File Structure

- Modify `src/app/ReaderApp.tsx`: add document-save debounce, recent-document upsert helper, and synchronization from updated sessions to `recentDocuments`.
- Modify `src/reader/hooks/useDocumentOpening.ts`: replace direct `saveDocument()` with an optional callback that reports an opened session/document to `ReaderApp` for immediate memory sync and debounced persistence.
- Modify `src/app/App.test.tsx`: add focused tests for immediate recent-list refresh and progress persistence behavior.
- No Rust files and no migration files should change unless a test proves the existing persistence command cannot store current fields.

## Task 1: Add Failing Coverage For Opening Sync

**Files:**
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Update the test viewer helper to emit progress when requested**

At the top of `src/app/App.test.tsx`, replace the existing simple `testViewerRenderer` constant with a helper-capable renderer. Keep the same default behavior for existing tests.

```tsx
const testViewerRenderer: PdfRenderer = ({ fileUrl, onPageChange }) => {
  if (fileUrl === 'blob:progress-sync') {
    onPageChange(4, 10);
  }

  return <div>PDF {fileUrl}</div>;
};
```

- [ ] **Step 2: Add a failing test for newly opened PDF appearing in recent files immediately**

Add this test near the existing native-open tests in `src/app/App.test.tsx`, after `opens a PDF from the native dialog and displays a tab`.

```tsx
  it('adds a newly opened desktop PDF to recent files without reloading persistence', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '最近文件 1' }));

    expect(await screen.findByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByText('book.pdf')).toBeInTheDocument();
    expect(persistence.listRecentDocuments).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3: Run the targeted failing test**

Run:

```bash
bunx vitest run src/app/App.test.tsx -t "adds a newly opened desktop PDF to recent files without reloading persistence"
```

Expected: FAIL because `recentDocuments` is not updated in memory after direct document save/open.

- [ ] **Step 4: Commit the failing test**

```bash
git add src/app/App.test.tsx
git commit -m "test: cover immediate recent sync on pdf open"
```

## Task 2: Sync Newly Opened Desktop Documents Into Memory

**Files:**
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/reader/hooks/useDocumentOpening.ts`
- Test: `src/app/App.test.tsx`

- [ ] **Step 1: Add synchronization input to `useDocumentOpening`**

In `src/reader/hooks/useDocumentOpening.ts`, extend `UseDocumentOpeningInput` with a callback.

```ts
type UseDocumentOpeningInput = {
  blobUrlCache: BlobUrlCache;
  bridge: TauriBridge;
  documents: DocumentState;
  loadDocumentDecorations(documentKey: string): Promise<void>;
  onDocumentOpened(session: DocumentSession, metadata: OpenMetadata): void;
  pdfByteCache: PdfByteCache;
  persistence: PersistenceApi;
  setDocuments: Dispatch<SetStateAction<DocumentState>>;
  setRecentDocuments: Dispatch<SetStateAction<PersistedDocument[]>>;
  setViewerSource: Dispatch<SetStateAction<ViewerSource | null>>;
};
```

Also update the imports at the top of the file.

```ts
import type { DocumentSession, DocumentState } from '../../documents/documentModels';
```

- [ ] **Step 2: Replace direct open-time save with callback**

In the destructuring for `useDocumentOpening`, include `onDocumentOpened`. Inside `openBytes`, replace the existing `if (source.kind === 'desktop-path') { void persistence.saveDocument(...) }` block with:

```ts
          if (source.kind === 'desktop-path') {
            onDocumentOpened(session, metadata);
          }
```

Update the `openBytes` dependency array to include `onDocumentOpened` and remove `persistence` if it is no longer referenced by `openBytes`.

```ts
    [
      blobUrlCache,
      loadDocumentDecorations,
      onDocumentOpened,
      pdfByteCache,
      setDocuments,
      setViewerSource,
    ],
```

Keep `persistence` in the hook input for `reopenRecentDocument`, because it still marks missing records by saving an updated document.

- [ ] **Step 3: Add an upsert helper in `ReaderApp.tsx`**

In `src/app/ReaderApp.tsx`, add this helper below `mapSessionToPersistedDocument()`.

```ts
function upsertRecentDocument(
  documents: PersistedDocument[],
  document: PersistedDocument,
): PersistedDocument[] {
  const existingIndex = documents.findIndex(
    (candidate) => candidate.documentKey === document.documentKey,
  );

  if (existingIndex === -1) {
    return [document, ...documents];
  }

  return [
    document,
    ...documents.slice(0, existingIndex),
    ...documents.slice(existingIndex + 1),
  ];
}
```

- [ ] **Step 4: Add document-open synchronization callback in `ReaderApp.tsx`**

In `ReaderApp`, add this callback near other top-level callbacks before `useDocumentOpening()` is called.

```tsx
  const syncRecentDocument = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      void persistence.saveDocument(document);
    },
    [persistence],
  );

  const handleDocumentOpened = useCallback(
    (session: DocumentSession) => {
      syncRecentDocument(mapSessionToPersistedDocument(session));
    },
    [syncRecentDocument],
  );
```

This intentionally saves immediately for the initial open event so the document exists in persistence even before page count is known. Debounced progress persistence is added in Task 4.

- [ ] **Step 5: Pass the callback into `useDocumentOpening`**

Update the `useDocumentOpening` call in `ReaderApp.tsx` to include:

```tsx
    onDocumentOpened: handleDocumentOpened,
```

- [ ] **Step 6: Run the opening sync test**

Run:

```bash
bunx vitest run src/app/App.test.tsx -t "adds a newly opened desktop PDF to recent files without reloading persistence"
```

Expected: PASS.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/app/ReaderApp.tsx src/reader/hooks/useDocumentOpening.ts src/app/App.test.tsx
git commit -m "feat: sync opened pdfs into recent files"
```

## Task 3: Add Failing Coverage For Progress Sync

**Files:**
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add a failing test for progress updating recent files and persistence payloads**

Add this test near the test from Task 1 in `src/app/App.test.tsx`.

```tsx
  it('updates recent file progress from viewer page changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:progress-sync');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const persistence = createEmptyPersistence();
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/progress.pdf', name: 'progress.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    renderApp(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'progress.pdf' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '最近文件 1' }));

    expect(await screen.findByText('progress.pdf')).toBeInTheDocument();
    expect(screen.getByText('4 / 10 页')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();

    await vi.runOnlyPendingTimersAsync();

    expect(persistence.saveDocument).toHaveBeenLastCalledWith({
      documentKey: 'desktop:/tmp/progress.pdf',
      path: '/tmp/progress.pdf',
      displayName: 'progress.pdf',
      fileSize: null,
      modifiedAt: null,
      pageCount: 10,
      lastPage: 4,
      progress: 0.4,
      missing: false,
    });

    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
bunx vitest run src/app/App.test.tsx -t "updates recent file progress from viewer page changes"
```

Expected: FAIL because progress updates only mutate `documents.sessions`, not `recentDocuments` and not document persistence through a debounced save.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/app/App.test.tsx
git commit -m "test: cover recent progress refresh"
```

## Task 4: Add Debounced Progress Persistence

**Files:**
- Modify: `src/app/ReaderApp.tsx`
- Test: `src/app/App.test.tsx`

- [ ] **Step 1: Import the debounce helper**

In `src/app/ReaderApp.tsx`, add:

```ts
import { createDebouncedFlush } from '../persistence/debounce';
```

- [ ] **Step 2: Create a debounced document flush**

Inside `ReaderApp`, near `blobUrlCache` and `pdfByteCache`, add:

```tsx
  const documentPersistence = useMemo(
    () => createDebouncedFlush(persistence.saveDocument, 250),
    [persistence],
  );
```

- [ ] **Step 3: Add a progress-specific sync helper**

Replace the `syncRecentDocument` callback from Task 2 with two callbacks.

```tsx
  const syncRecentDocumentImmediately = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      void persistence.saveDocument(document);
    },
    [persistence],
  );

  const syncRecentDocumentProgress = useCallback(
    (document: PersistedDocument) => {
      setRecentDocuments((current) => upsertRecentDocument(current, document));
      documentPersistence.schedule(document);
    },
    [documentPersistence],
  );
```

Then update `handleDocumentOpened` to call `syncRecentDocumentImmediately()`.

```tsx
  const handleDocumentOpened = useCallback(
    (session: DocumentSession) => {
      syncRecentDocumentImmediately(mapSessionToPersistedDocument(session));
    },
    [syncRecentDocumentImmediately],
  );
```

- [ ] **Step 4: Add cleanup for pending document saves**

Add this effect near existing persistence-related effects in `ReaderApp.tsx`.

```tsx
  useEffect(() => {
    return () => {
      documentPersistence.cancel();
    };
  }, [documentPersistence]);
```

- [ ] **Step 5: Update `onProgressChange` to sync the updated session**

In the `PdfViewerBridge` `onProgressChange` prop in `ReaderApp.tsx`, replace the current `setDocuments` callback body with this version so the mapped document uses the updated session, not the stale active session.

```tsx
        onProgressChange={(progress) => {
          setDocuments((current) => {
            const next = updateSessionProgress(current, progress.sessionId, {
              page: progress.page,
              totalPages: progress.totalPages,
              zoom: progress.zoom,
            });
            const updatedSession = next.sessions.find(
              (session) => session.id === progress.sessionId,
            );

            if (updatedSession?.source.kind === 'desktop-path') {
              syncRecentDocumentProgress(mapSessionToPersistedDocument(updatedSession));
            }

            return next;
          });
        }}
```

Include `syncRecentDocumentProgress` in the surrounding render callback dependencies if this code is inside a `useMemo` or `useCallback`. If it is inline JSX in the component return, no dependency list change is needed.

- [ ] **Step 6: Run the progress sync test**

Run:

```bash
bunx vitest run src/app/App.test.tsx -t "updates recent file progress from viewer page changes"
```

Expected: PASS.

- [ ] **Step 7: Run both focused tests**

Run:

```bash
bunx vitest run src/app/App.test.tsx -t "recent|progress"
```

Expected: PASS for the newly added tests and any existing tests matching the filter.

- [ ] **Step 8: Commit the implementation**

```bash
git add src/app/ReaderApp.tsx src/app/App.test.tsx
git commit -m "feat: persist reader progress with debounced sync"
```

## Task 5: Preserve Metadata During Progress Updates

**Files:**
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add metadata preservation to `mapSessionToPersistedDocument`**

If the Task 3 test shows `fileSize` and `modifiedAt` are lost after progress sync, update `mapSessionToPersistedDocument` to accept an optional previous document.

```tsx
function mapSessionToPersistedDocument(
  session: DocumentSession,
  previousDocument?: PersistedDocument | null,
): PersistedDocument {
  return {
    documentKey: session.documentKey,
    path: session.source.kind === 'desktop-path' ? session.source.path : null,
    displayName: session.title,
    fileSize:
      session.source.kind === 'browser-file'
        ? session.source.file.size
        : previousDocument?.fileSize ?? null,
    modifiedAt:
      session.source.kind === 'browser-file'
        ? new Date(session.source.file.lastModified).toISOString()
        : previousDocument?.modifiedAt ?? null,
    pageCount: session.totalPages,
    lastPage: session.page,
    progress: session.progress,
    missing: false,
  };
}
```

- [ ] **Step 2: Use existing recent metadata during progress sync**

In the `onProgressChange` callback, find the existing recent document before mapping.

```tsx
            if (updatedSession?.source.kind === 'desktop-path') {
              const existingRecentDocument = recentDocuments.find(
                (document) => document.documentKey === updatedSession.documentKey,
              );
              syncRecentDocumentProgress(
                mapSessionToPersistedDocument(updatedSession, existingRecentDocument),
              );
            }
```

Because `recentDocuments` is used inside the callback, ensure the component scope already has access to it. If a dependency list exists around this JSX, include `recentDocuments`.

- [ ] **Step 3: Update the Task 3 test expectation**

In `updates recent file progress from viewer page changes`, update the expected persisted payload to preserve open metadata.

```tsx
    expect(persistence.saveDocument).toHaveBeenLastCalledWith({
      documentKey: 'desktop:/tmp/progress.pdf',
      path: '/tmp/progress.pdf',
      displayName: 'progress.pdf',
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
      pageCount: 10,
      lastPage: 4,
      progress: 0.4,
      missing: false,
    });
```

- [ ] **Step 4: Run the progress sync test**

Run:

```bash
bunx vitest run src/app/App.test.tsx -t "updates recent file progress from viewer page changes"
```

Expected: PASS.

- [ ] **Step 5: Commit metadata preservation**

```bash
git add src/app/ReaderApp.tsx src/app/App.test.tsx
git commit -m "fix: preserve recent pdf metadata during progress sync"
```

## Task 6: Final Validation

**Files:**
- Validate only; no planned file edits.

- [ ] **Step 1: Run focused app and document tests**

Run:

```bash
bunx vitest run src/app/App.test.tsx src/documents/documentSessionStore.test.ts src/persistence/debounce.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Check Rust test necessity**

Run:

```bash
git diff --name-only HEAD~5..HEAD | rg '^src-tauri/' || true
```

Expected: no output. If there is no `src-tauri/` output, do not run Cargo tests for this feature because no Rust persistence code changed.

If Rust files changed unexpectedly, run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Check final diff scope**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
```

Expected: only planned frontend/test/docs files are changed across the implementation commits; working tree is clean after commits.

## Self-Review Notes

Spec coverage:

- `SR-PROGRESS-001`, `SR-PROGRESS-003`: Task 3 and Task 4 verify `4 / 10 = 40%`; existing session store keeps clamped formula.
- `SR-PROGRESS-002`: Task 4 persists mapped `lastPage`, `pageCount`, and `progress`.
- `SR-PROGRESS-004`: Task 1 and Task 2 cover newly opened files appearing without a second persistence load.
- `SR-PROGRESS-005`: Task 3 and Task 4 cover page-change updates to recent/history UI.
- `SR-PROGRESS-006`: Task 4 uses `createDebouncedFlush` for progress saves.
- `SR-PROGRESS-007`: Tasks avoid viewer/rendering/schema changes and validate existing app behavior through focused tests.
- `SR-PROGRESS-008`: Plan keeps changes local to existing React state/persistence patterns and avoids new architecture.

No placeholder sections remain. Type names match existing code: `DocumentSession`, `PersistedDocument`, `PersistenceApi`, `PdfRenderer`, `createDebouncedFlush`, and `updateSessionProgress`.
