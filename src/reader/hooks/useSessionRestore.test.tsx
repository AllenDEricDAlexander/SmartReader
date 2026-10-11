import { webcrypto } from 'node:crypto';
import { StrictMode, useState, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import { PdfByteCache } from '../../cache/pdfByteCache';
import {
  addDocumentSession, closeDocumentSession, createEmptyDocumentState, selectSession, updateSessionProgress,
} from '../../documents/documentSessionStore';
import { libraryUiFixture, paperFixture } from '../../library/libraryUiTestUtils';
import { paperToPersistedDocument } from '../../library/libraryPersistence';
import { createPersistenceApi, type PersistedDocument, type PersistedReaderSession } from '../../persistence/persistenceApi';
import type { TauriBridge } from '../../platform/tauriBridge';
import { defaultReaderPreferences } from '../../preferences/preferencesStore';
import type { ViewerSource } from '../../viewer/viewerTypes';
import { useSessionRestore } from './useSessionRestore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function fixture(kind: 'desktop' | 'library') {
  const papers = [paperFixture('a'), paperFixture('b')];
  const { library } = await libraryUiFixture(papers);
  const documents: PersistedDocument[] = papers.map((paper) => ({
    ...paperToPersistedDocument(paper),
    documentKey: kind === 'library' ? `paper:${paper.id}` : `desktop:/tmp/${paper.id}.pdf`,
    path: kind === 'library' ? null : `/tmp/${paper.id}.pdf`, pageCount: 12,
  }));
  const session: PersistedReaderSession = {
    activeDocumentKey: documents[0].documentKey, sidebarOpen: true,
    tabs: documents.map((document, tabOrder) => ({ documentKey: document.documentKey, tabOrder,
      page: tabOrder ? 6 : 2, zoom: tabOrder ? 1.2 : 1.5,
      history: { currentPage: tabOrder ? 6 : 2, backStack: [], forwardStack: [] } })),
  };
  const reads = { a: deferred<Uint8Array>(), b: deferred<Uint8Array>() };
  const bridge: TauriBridge = {
    openNativePdf: vi.fn(async () => null),
    readDesktopPdf: vi.fn(async (path: string) => {
      const id = path === '/tmp/a.pdf' ? 'a' : 'b';
      return { source: { kind: 'desktop-path' as const, path, name: `${id}.pdf` }, bytes: await reads[id].promise,
        fileSize: 20, modifiedAt: null };
    }),
  };
  const readLibrary = vi.spyOn(library, 'readPdf').mockImplementation((id) => reads[id as 'a' | 'b'].promise);
  const persistence = {
    ...createPersistenceApi(async () => { throw new Error('Unexpected persistence call'); }),
    listRecentDocuments: vi.fn(async () => documents),
    loadReaderSession: vi.fn(async () => session),
  };
  const blobUrlCache = new BlobUrlCache();
  const pdfByteCache = new PdfByteCache();
  const createUrl = vi.spyOn(blobUrlCache, 'createForSession');
  const cacheBytes = vi.spyOn(pdfByteCache, 'set');
  const loadDocumentDecorations = vi.fn(async () => undefined);
  return { kind, library, readLibrary, documents, session, reads, bridge, persistence,
    blobUrlCache, pdfByteCache, createUrl, cacheBytes, loadDocumentDecorations };
}

function useRestoreHarness(setup: Awaited<ReturnType<typeof fixture>>, automatic = false) {
  const [documents, setDocuments] = useState(createEmptyDocumentState);
  const [viewerSource, setViewerSource] = useState<ViewerSource | null>(null);
  const [, setRecentDocuments] = useState(setup.documents);
  const [, setSidebarOpen] = useState(true);
  const { restoreSession } = useSessionRestore({
    bridge: setup.bridge, blobUrlCache: setup.blobUrlCache, pdfByteCache: setup.pdfByteCache,
    loadDocumentDecorations: setup.loadDocumentDecorations, persistence: setup.persistence,
    library: setup.kind === 'library' ? setup.library : undefined,
    preferences: defaultReaderPreferences, preferencesLoaded: automatic,
    setDocuments, setViewerSource, setRecentDocuments, setSidebarOpen,
  });
  return { documents, viewerSource, restoreSession, setDocuments, setViewerSource };
}

const bytes = (label: string) => new TextEncoder().encode(`%PDF-1.7 ${label}`);
const strict = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  let sequence = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:restore-${++sequence}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

describe.each(['desktop', 'library'] as const)('%s session restore race protection', (kind) => {
  it('uses the current active tab after A resolves and current B progress when B finishes', async () => {
    const setup = await fixture(kind);
    const { result } = renderHook(() => useRestoreHarness(setup));
    let restoring!: Promise<void>;
    act(() => { restoring = result.current.restoreSession(); });
    await waitFor(() => expect(result.current.documents.sessions).toHaveLength(2));
    const [a, b] = result.current.documents.sessions;
    act(() => result.current.setDocuments((current) => selectSession(current, b.id)));
    await act(async () => { setup.reads.a.resolve(bytes('A')); });
    expect(result.current.documents.activeSessionId).toBe(b.id);
    expect(result.current.viewerSource).toBeNull();
    expect(setup.blobUrlCache.getForSession(a.id)).not.toBeNull();
    act(() => result.current.setDocuments((current) => updateSessionProgress(current, b.id, {
      page: 9, totalPages: 12, zoom: 1.7,
    })));
    await act(async () => { setup.reads.b.resolve(bytes('B')); await restoring; });
    expect(result.current.viewerSource).toEqual({ sessionId: b.id,
      url: setup.blobUrlCache.getForSession(b.id), restore: { page: 9, zoom: 1.7 } });
    expect(setup.cacheBytes).toHaveBeenCalledTimes(2);
  });

  it('does not create bytes or a blob URL for a tab closed before its read completes', async () => {
    const setup = await fixture(kind);
    const { result } = renderHook(() => useRestoreHarness(setup));
    let restoring!: Promise<void>;
    act(() => { restoring = result.current.restoreSession(); });
    await waitFor(() => expect(result.current.documents.sessions).toHaveLength(2));
    const [a, b] = result.current.documents.sessions;
    act(() => result.current.setDocuments((current) => closeDocumentSession(current, a.id)));
    await act(async () => { setup.reads.a.resolve(bytes('A')); });
    expect(setup.blobUrlCache.getForSession(a.id)).toBeNull();
    expect(setup.pdfByteCache.get(a.documentKey)).toBeNull();
    expect(setup.createUrl).not.toHaveBeenCalled();
    await act(async () => { setup.reads.b.resolve(bytes('B')); await restoring; });
    expect(result.current.documents.sessions.map((item) => item.id)).toEqual([b.id]);
    expect(result.current.viewerSource?.sessionId).toBe(b.id);
    expect(setup.createUrl).toHaveBeenCalledOnce();
  });

  it('keeps the result of reopening the same document while the original restore is still pending', async () => {
    const setup = await fixture(kind);
    const { result } = renderHook(() => useRestoreHarness(setup));
    let restoring!: Promise<void>;
    act(() => { restoring = result.current.restoreSession(); });
    await waitFor(() => expect(result.current.documents.sessions).toHaveLength(2));
    const [a] = result.current.documents.sessions;
    act(() => result.current.setDocuments((current) =>
      addDocumentSession(closeDocumentSession(current, a.id), { ...a.source })));
    await act(async () => { setup.reads.a.resolve(bytes('Stale A')); setup.reads.b.resolve(bytes('B')); await restoring; });
    expect(setup.blobUrlCache.getForSession(a.id)).toBeNull();
    expect(setup.pdfByteCache.get(a.documentKey)).toBeNull();
    expect(result.current.viewerSource).toBeNull();
    expect(result.current.documents.sessions.find((item) => item.id === a.id)?.restored).toBe(false);
  });

  it('keeps caller cancellation effective before publishing late reads', async () => {
    const setup = await fixture(kind);
    const { result } = renderHook(() => useRestoreHarness(setup));
    let cancelled = false;
    let restoring!: Promise<void>;
    act(() => { restoring = result.current.restoreSession(() => cancelled); });
    await waitFor(() => expect(result.current.documents.sessions).toHaveLength(2));
    cancelled = true;
    await act(async () => { setup.reads.a.resolve(bytes('A')); setup.reads.b.resolve(bytes('B')); await restoring; });
    expect(result.current.viewerSource).toBeNull();
    expect(setup.createUrl).not.toHaveBeenCalled();
    expect(setup.cacheBytes).not.toHaveBeenCalled();
  });

  it('finishes StrictMode restoration without duplicated URLs or repeated reads on later state updates', async () => {
    const setup = await fixture(kind);
    const { result } = renderHook(() => useRestoreHarness(setup, true), { wrapper: strict });
    await waitFor(() => expect(result.current.documents.sessions).toHaveLength(2));
    const [a, b] = result.current.documents.sessions;
    await act(async () => { setup.reads.a.resolve(bytes('A')); setup.reads.b.resolve(bytes('B')); });
    await waitFor(() => expect(result.current.viewerSource?.sessionId).toBe(a.id));
    expect(setup.createUrl).toHaveBeenCalledTimes(2);
    expect(setup.cacheBytes).toHaveBeenCalledTimes(2);
    const reader = kind === 'library' ? setup.readLibrary : setup.bridge.readDesktopPdf;
    expect(reader).toHaveBeenCalledTimes(2);
    act(() => result.current.setDocuments((current) => selectSession(current, b.id)));
    expect(reader).toHaveBeenCalledTimes(2);
    expect(result.current.documents.activeSessionId).toBe(b.id);
  });
});

describe('library restore access', () => {
  it('does not cache or publish a managed paper when its vault locks while reading', async () => {
    const setup = await fixture('library');
    const folder = await setup.library.createFolder('Private');
    await setup.library.categorize(['a'], [folder.id], 'move');
    const vault = await setup.library.encryptFolder(folder.id, 'strong password');
    const { result } = renderHook(() => useRestoreHarness(setup));
    let restoring!: Promise<void>;
    act(() => { restoring = result.current.restoreSession(); });
    await waitFor(() => expect(result.current.documents.sessions).toHaveLength(2));
    const [a] = result.current.documents.sessions;
    await act(() => setup.library.lockVault(vault.id));
    await act(async () => { setup.reads.a.resolve(bytes('A')); setup.reads.b.resolve(bytes('B')); await restoring; });
    expect(result.current.viewerSource).toBeNull();
    expect(setup.blobUrlCache.getForSession(a.id)).toBeNull();
    expect(setup.pdfByteCache.get(a.documentKey)).toBeNull();
  });
});
