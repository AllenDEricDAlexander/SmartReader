import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../ai/aiService';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import type { LibraryStorage } from '../library/libraryStorage';
import type { PersistenceApi, PersistedReaderSession, PersistedDocument, PersistedAnnotation, PersistedBookmark } from '../persistence/persistenceApi';
import type { DroppedPdfPaths, OpenedDesktopPdf, TauriBridge } from '../platform/tauriBridge';
import { defaultReaderPreferences } from '../preferences/preferencesStore';
import type { PdfRenderer } from '../viewer/PdfViewerBridge';
import { ViewerController } from '../viewer/viewerController';
import { App } from './App';

vi.mock('../platform/openWithEvents', () => ({
  listenForOpenWith: vi.fn(async () => () => undefined),
}));

const nativeDropMock = vi.hoisted(() => vi.fn());
vi.mock('../platform/nativeFileDrop', () => ({ listenForNativeFileDrop: nativeDropMock }));

const title = 'Cognitive circuits research';
const secretNote = 'Private circuit interpretation';
const contentToken = 'hippocampus-sentinel';
const primaryPdf = () => new TextEncoder().encode('%PDF-1.7\nprimary paper');

const renderer: PdfRenderer = ({ fileUrl, annotations, onPageChange, onZoomChange, onHighlightSelection }) => (
  <section aria-label="测试 PDF 视图" data-url={fileUrl}>
    <p>PDF 已连接</p>
    <button type="button" onClick={() => onPageChange(1, 6)}>报告初始页面</button>
    <button type="button" onClick={() => { onPageChange(5, 6); onZoomChange(1.25); }}>阅读到第 5 页</button>
    <button type="button" onClick={() => onHighlightSelection?.({
      selectedText: 'Selected scientific evidence', page: 2, kind: 'note', color: '#38bdf8',
      areas: [{ pageIndex: 1, left: 10, top: 15, width: 30, height: 3 }],
    })}>模拟选择笔记</button>
    <ul>{annotations.map((annotation) => <li key={annotation.id}>{annotation.text || annotation.quote}</li>)}</ul>
  </section>
);

function basePersistence(): PersistenceApi {
  let session: PersistedReaderSession | null = null;
  return {
    saveDocument: vi.fn(async () => undefined),
    listRecentDocuments: vi.fn(async () => []),
    removeRecentDocument: vi.fn(async () => undefined),
    clearRecentDocuments: vi.fn(async () => undefined),
    saveReaderSession: vi.fn(async (next) => { session = structuredClone(next); }),
    loadReaderSession: vi.fn(async () => structuredClone(session)),
    saveBookmark: vi.fn(async (bookmark) => ({ ...bookmark, id: bookmark.id ?? 100 })),
    listBookmarks: vi.fn(async () => []),
    listAllBookmarks: vi.fn(async () => []),
    loadBookmarkDashboard: vi.fn(async () => ({ totalBookmarks: 0, groups: [] })),
    deleteBookmark: vi.fn(async () => undefined),
    saveAnnotation: vi.fn(async (annotation) => ({ ...annotation, id: annotation.id ?? 101 })),
    listAnnotations: vi.fn(async () => []),
    listAllAnnotations: vi.fn(async () => []),
    deleteAnnotation: vi.fn(async () => undefined),
    savePreferences: vi.fn(async () => undefined),
    loadPreferences: vi.fn(async () => null),
    loadCacheStats: vi.fn(async () => ({ usedBytes: 0, totalBytes: 1024 ** 3, fileCount: 0 })),
    setDocumentFavorite: vi.fn(async () => undefined),
    listFavoriteDocuments: vi.fn(async () => []),
    createTag: vi.fn(async () => { throw new Error('Unexpected tag creation'); }),
    renameTag: vi.fn(async () => { throw new Error('Unexpected tag rename'); }),
    deleteTag: vi.fn(async () => undefined),
    mergeTags: vi.fn(async () => { throw new Error('Unexpected tag merge'); }),
    listTags: vi.fn(async () => []),
    loadTagDashboard: vi.fn(async () => ({
      overview: { totalTags: 0, activeTags: 0, totalUsage: 0, orphanTags: 0 }, tags: [], details: [], recommendations: [],
    })),
    attachDocumentTag: vi.fn(async () => undefined),
    detachDocumentTag: vi.fn(async () => undefined),
    attachAnnotationTag: vi.fn(async () => undefined),
    detachAnnotationTag: vi.fn(async () => undefined),
  };
}

function fixture() {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const storage: LibraryStorage = {
    load: vi.fn(async () => ({ revision, data: structuredClone(data) })),
    commit: vi.fn(async (expected, next, writes) => {
      if (expected !== revision) throw new Error('LIBRARY_CONFLICT');
      for (const write of writes) {
        if (write.bytes) files.set(write.id, write.bytes.slice());
        else files.delete(write.id);
      }
      data = structuredClone(next);
      return ++revision;
    }),
    readFile: vi.fn(async (id) => {
      const bytes = files.get(id);
      if (!bytes) throw new Error('PDF missing');
      return bytes.slice();
    }),
  };
  const extract = vi.fn(async (bytes: Uint8Array) => {
    const primary = new TextDecoder().decode(bytes).includes('primary');
    return {
      metadata: { ...emptyMetadata(primary ? title : 'Other study'), authors: ['Researcher A'],
        abstract: primary ? 'Private abstract about cognitive evidence.' : 'General biology.', year: '2026' },
      pages: [
        { page: 1, text: 'General scientific introduction.' },
        { page: 4, text: primary ? `${contentToken} identifies the main finding.` : 'Unrelated cell biology.' },
      ],
      pageCount: 6,
    };
  });
  const library = new LibraryService(storage, extract);
  const completion = vi.fn(async (..._args: unknown[]) => 'No live AI request in integration tests.');
  // The assistant streams, and no native transport exists under jsdom, so the
  // streaming dependency replays the completion mock through its delta callback.
  const streaming = vi.fn(async (provider: never, key: never, messages: never, options: { onDelta?(text: string): void }) => {
    const text = await completion(provider, key, messages, options);
    options.onDelta?.(text);
    return text;
  });
  const ai = new AiService(library, completion, {}, streaming as never);
  const persistence = basePersistence();
  const opened: OpenedDesktopPdf = {
    source: { kind: 'desktop-path', path: '/research/cognition.pdf', name: 'cognition.pdf' },
    bytes: primaryPdf(), fileSize: primaryPdf().length, modifiedAt: '2026-10-11T00:00:00Z',
  };
  const bridge: TauriBridge = {
    canOpenNativePdf: () => true,
    openNativePdf: vi.fn(async () => opened),
    readDesktopPdf: vi.fn(async () => { throw new Error('Managed papers must open from library storage'); }),
  };
  return { library, ai, research: { library, ai }, persistence, bridge, opened, storage, extract, completion, streaming,
    snapshot: () => structuredClone(data) };
}

function configureLegacyRecord(app: ReturnType<typeof fixture>, visibleInRecent: boolean) {
  const document: PersistedDocument = {
    documentKey: 'desktop:/research/cognition.pdf', path: '/research/cognition.pdf', displayName: 'cognition.pdf',
    fileSize: app.opened.fileSize, modifiedAt: app.opened.modifiedAt, pageCount: 6, lastPage: 3, progress: 0.5,
    missing: false, lastOpenedAt: '2026-10-10T00:00:00Z', tagIds: [],
  };
  const bookmark: PersistedBookmark = {
    id: 17, documentKey: document.documentKey, page: 6, title: 'Legacy conclusion landmark', note: 'Keep this reference',
    createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  };
  const annotation: PersistedAnnotation = {
    id: 18, documentKey: document.documentKey, page: 2, type: 'note', color: '#38bdf8',
    text: 'Legacy personal interpretation', quote: 'Original evidence', areas: [], tagIds: [],
    createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  };
  app.persistence.getDocument = vi.fn(async (key) => key === document.documentKey ? document : null);
  vi.mocked(app.persistence.listRecentDocuments).mockResolvedValue(visibleInRecent ? [document] : []);
  vi.mocked(app.persistence.listBookmarks).mockImplementation(async (key) => key === document.documentKey ? [bookmark] : []);
  vi.mocked(app.persistence.listAnnotations).mockImplementation(async (key) => key === document.documentKey ? [annotation] : []);
  vi.mocked(app.persistence.loadBookmarkDashboard).mockResolvedValue({
    totalBookmarks: 1, groups: [{ document, bookmarkCount: 1, bookmarks: [bookmark] }],
  });
  vi.mocked(app.bridge.readDesktopPdf).mockResolvedValue(app.opened);
  return { document, bookmark, annotation };
}

async function openNative() {
  fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));
  await screen.findByRole('tab', { name: 'cognition.pdf' });
  await screen.findByLabelText('测试 PDF 视图');
}

function directoryDrop(files: File[]) {
  const entries = files.map((file) => ({
    isDirectory: false, isFile: true, name: file.name, file: (resolve: (value: File) => void) => resolve(file),
  }));
  return {
    files: [],
    items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({
      isDirectory: true, isFile: false, name: 'papers',
      createReader: () => {
        let read = false;
        return { readEntries: (resolve: (value: unknown[]) => void) => { resolve(read ? [] : entries); read = true; } };
      },
    }) }],
  };
}

function openGlobalSearch() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return screen.findByRole('dialog', { name: '全局搜索' });
}

beforeEach(() => {
  nativeDropMock.mockReset().mockResolvedValue(null);
  vi.stubGlobal('crypto', webcrypto);
  let sequence = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:research-app-${++sequence}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('desktop research App integration', () => {
  it.each([1, 3])('batch imports a dropped folder containing %i PDFs without opening reader tabs', async (count) => {
    const app = fixture();
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    const files = [new File([primaryPdf()], 'first.pdf', { type: 'application/pdf' })];
    if (count === 3) files.push(new File(['%PDF-1.7\nsecond paper'], 'second.pdf'), new File([primaryPdf()], 'duplicate.pdf'));
    fireEvent.drop(screen.getByRole('group', { name: 'PDF 拖拽区域' }), { dataTransfer: directoryDrop(files) });
    await waitFor(() => expect(app.snapshot()?.papers).toHaveLength(count === 1 ? 1 : 2));
    expect(await screen.findByText(new RegExp(`已导入 ${count} 份 PDF`))).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(app.bridge.openNativePdf).not.toHaveBeenCalled();
    expect(app.bridge.readDesktopPdf).not.toHaveBeenCalled();
  });

  it('opens a single PDF dropped into the same import box for immediate reading', async () => {
    const app = fixture();
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.drop(screen.getByRole('group', { name: 'PDF 拖拽区域' }), {
      dataTransfer: { files: [new File([primaryPdf()], 'single.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByRole('tab', { name: 'single.pdf' })).toBeInTheDocument();
    expect(await screen.findByLabelText('测试 PDF 视图')).toBeInTheDocument();
    expect(app.snapshot()?.papers).toHaveLength(1);
    expect(app.bridge.openNativePdf).not.toHaveBeenCalled();
  });

  it('continues a native folder import after one PDF fails and reports the partial result', async () => {
    const app = fixture();
    nativeDropMock.mockResolvedValue(vi.fn());
    app.bridge.resolveDroppedPdfPaths = vi.fn(async () => ({ pdfPaths: ['/papers/broken.pdf', '/papers/cognition.pdf'], hasDirectories: true }));
    vi.mocked(app.bridge.readDesktopPdf).mockRejectedValueOnce(new Error('invalid PDF')).mockResolvedValueOnce(app.opened);
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await waitFor(() => expect(nativeDropMock).toHaveBeenCalled());
    await act(async () => { nativeDropMock.mock.calls.at(-1)![1](['/papers']); });
    expect(await screen.findByText(/已导入 1 份 PDF.*1 份失败/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('部分文件导入失败：invalid PDF');
    expect(app.snapshot()?.papers).toHaveLength(1);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(app.bridge.resolveDroppedPdfPaths).toHaveBeenCalledExactlyOnceWith(['/papers']);
    expect(app.bridge.openNativePdf).not.toHaveBeenCalled();
  });

  it('opens a single native PDF drop without displaying a file selection dialog', async () => {
    const app = fixture();
    nativeDropMock.mockResolvedValue(vi.fn());
    app.bridge.resolveDroppedPdfPaths = vi.fn(async () => ({ pdfPaths: ['/research/cognition.pdf'], hasDirectories: false }));
    vi.mocked(app.bridge.readDesktopPdf).mockResolvedValue(app.opened);
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await waitFor(() => expect(nativeDropMock).toHaveBeenCalled());
    await act(async () => { nativeDropMock.mock.calls.at(-1)![1](['/research/cognition.pdf']); });
    expect(await screen.findByRole('tab', { name: 'cognition.pdf' })).toBeInTheDocument();
    expect(await screen.findByLabelText('测试 PDF 视图')).toBeInTheDocument();
    expect(app.bridge.readDesktopPdf).toHaveBeenCalledExactlyOnceWith('/research/cognition.pdf');
    expect(app.bridge.openNativePdf).not.toHaveBeenCalled();
  });

  it('reports an empty folder without importing or opening documents', async () => {
    const app = fixture();
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.drop(screen.getByRole('group', { name: 'PDF 拖拽区域' }), { dataTransfer: directoryDrop([]) });
    expect(await screen.findByRole('alert')).toHaveTextContent('拖入的文件夹中没有 PDF。');
    expect(app.snapshot()?.papers ?? []).toHaveLength(0);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('ignores repeated native drops while directory scanning or importing is still running', async () => {
    const app = fixture();
    nativeDropMock.mockResolvedValue(vi.fn());
    let resolvePaths!: (value: DroppedPdfPaths) => void;
    app.bridge.resolveDroppedPdfPaths = vi.fn(() => new Promise<DroppedPdfPaths>((resolve) => { resolvePaths = resolve; }));
    vi.mocked(app.bridge.readDesktopPdf).mockResolvedValue(app.opened);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const extract = app.extract.getMockImplementation()!;
    app.extract.mockImplementationOnce(async (bytes) => { await pending; return extract(bytes); });
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await waitFor(() => expect(nativeDropMock).toHaveBeenCalled());
    const drop = nativeDropMock.mock.calls.at(-1)![1];
    await act(async () => { drop(['/research']); });
    await waitFor(() => expect(app.bridge.resolveDroppedPdfPaths).toHaveBeenCalledOnce());
    await act(async () => { drop(['/research']); });
    expect(app.bridge.resolveDroppedPdfPaths).toHaveBeenCalledOnce();
    await act(async () => { resolvePaths({ pdfPaths: ['/research/cognition.pdf'], hasDirectories: true }); });
    await waitFor(() => expect(app.extract).toHaveBeenCalledOnce());
    await act(async () => { drop(['/research']); });
    expect(app.bridge.resolveDroppedPdfPaths).toHaveBeenCalledOnce();
    await act(async () => { release(); });
    expect(await screen.findByText(/已导入 1 份 PDF/)).toBeInTheDocument();
    expect(app.snapshot()?.papers).toHaveLength(1);
  });

  it('imports a local PDF into an empty knowledge library from the AI assistant and answers using that selected file', async () => {
    const app = fixture();
    await app.ai.saveProvider({ name: 'Aliyun compatible', baseUrl: 'https://api.example.org/v1', model: 'chat-model' }, 'test-key');
    app.completion.mockResolvedValue('Selected knowledge evidence [S1]');
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 科研助手' }));
    await screen.findByText(/知识库还没有文件/);
    fireEvent.click(screen.getByRole('button', { name: '添加本地 PDF' }));
    const checkbox = await screen.findByRole('checkbox', { name: `选择知识库文件 ${title}` });
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(app.bridge.openNativePdf).toHaveBeenCalledOnce();
    expect(app.snapshot()?.papers).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: contentToken } });
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('Selected knowledge evidence [S1]');
    expect(screen.getByRole('button', { name: new RegExp(`S1 ${title} 第 4 页`) })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: 'A follow-up after reading the citation' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`S1 ${title} 第 4 页`) }));
    await screen.findByLabelText('测试 PDF 视图');
    fireEvent.click(within(screen.getByLabelText('文档导航栏')).getByRole('button', { name: '首页' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI 科研助手' }));
    expect(screen.getByText('Selected knowledge evidence [S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('A follow-up after reading the citation');
    expect(screen.getByRole('checkbox', { name: `选择知识库文件 ${title}` })).toBeChecked();
    app.completion.mockResolvedValue('Follow-up keeps the cited context [S1]');
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('Follow-up keeps the cited context [S1]');
    const messages = app.completion.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1].content).toBe(contentToken);
    await act(async () => { await app.ai.flushAssistantSession(); });
    expect(JSON.stringify(app.snapshot())).toContain('Selected knowledge evidence');
    expect(JSON.stringify(app.snapshot())).toContain('A follow-up after reading the citation');
    app.ai.dispose();
  });
  it('imports a native PDF into the managed reader and persists bookmarks, editable notes and favorites only in the library', async () => {
    const app = fixture();
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await openNative();
    fireEvent.click(screen.getByRole('button', { name: '报告初始页面' }));
    const paper = app.library.getView().papers[0];
    expect(paper.metadata.title).toBe(title);
    expect(paper.indexStatus).toBe('ready');
    expect(app.extract).toHaveBeenCalledOnce();
    expect(app.bridge.openNativePdf).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('文献预览')).toHaveTextContent(title);

    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }));
    await waitFor(() => expect(app.library.getPaper(paper.id)?.bookmarks).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '模拟选择笔记' }));
    const note = await screen.findByLabelText('Annotation note');
    fireEvent.change(note, { target: { value: secretNote } });
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));
    await waitFor(() => expect(app.library.getPaper(paper.id)?.annotations[0]).toMatchObject({
      documentKey: `paper:${paper.id}`, type: 'note', text: secretNote, quote: 'Selected scientific evidence',
    }));
    fireEvent.click(screen.getByRole('button', { name: '收藏当前文档' }));
    await waitFor(() => expect(app.library.getPaper(paper.id)?.favorite).toBe(true));
    expect(app.library.getPaper(paper.id)?.bookmarks[0].id).toBeLessThan(0);
    expect(app.library.getPaper(paper.id)?.annotations[0].id).toBeLessThan(0);
    expect(app.persistence.saveDocument).not.toHaveBeenCalled();
    expect(app.persistence.saveBookmark).not.toHaveBeenCalled();
    expect(app.persistence.saveAnnotation).not.toHaveBeenCalled();
    expect(app.persistence.setDocumentFavorite).not.toHaveBeenCalled();
    expect(app.bridge.readDesktopPdf).not.toHaveBeenCalled();
  });

  it.each([
    ['list', 'remove'],
    ['cards', 'clear'],
  ] as const)('resumes managed PDFs from %s view and preserves library data when records %s', async (homeRecentViewMode, action) => {
    const app = fixture();
    vi.mocked(app.persistence.loadPreferences).mockResolvedValue({ ...defaultReaderPreferences, homeRecentViewMode });
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await openNative();
    fireEvent.click(screen.getByRole('button', { name: '阅读到第 5 页' }));
    const id = app.library.getView().papers[0].id;
    await waitFor(() => expect(app.library.getPaper(id)).toMatchObject({ lastPage: 5, zoom: 1.25 }));
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }));
    await waitFor(() => expect(app.library.getPaper(id)?.bookmarks).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '收藏当前文档' }));
    await waitFor(() => expect(app.library.getPaper(id)?.favorite).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '模拟选择笔记' }));
    fireEvent.change(await screen.findByLabelText('Annotation note'), { target: { value: secretNote } });
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));
    await waitFor(() => expect(app.library.getPaper(id)?.annotations[0]?.text).toBe(secretNote));

    fireEvent.click(within(screen.getByLabelText('文档导航栏')).getByRole('button', { name: '首页' }));
    let recentRegion = screen.getByRole('region', { name: '最近阅读' });
    expect(within(recentRegion).getByText('上次阅读到 第 5 / 6 页')).toBeInTheDocument();
    expect(within(recentRegion).getAllByText('cognition.pdf')).toHaveLength(1);
    if (homeRecentViewMode === 'cards') {
      expect(within(recentRegion).getByRole('article', { name: 'cognition.pdf' })).toBeInTheDocument();
    } else {
      expect(within(recentRegion).getByRole('table')).toBeInTheDocument();
    }
    fireEvent.click(within(recentRegion).getByRole('button', { name: '打开 cognition.pdf' }));
    await screen.findByLabelText('测试 PDF 视图');
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('第 5 / 6 页');
    fireEvent.click(within(screen.getByLabelText('文档导航栏')).getByRole('button', { name: '首页' }));
    recentRegion = screen.getByRole('region', { name: '最近阅读' });

    if (action === 'remove') {
      fireEvent.click(within(recentRegion).getByRole('button', { name: '更多操作 cognition.pdf' }));
      fireEvent.click(within(recentRegion).getByRole('menuitem', { name: '从最近记录移除' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: '清除记录' }));
      fireEvent.click(screen.getByRole('button', { name: '清空记录' }));
    }
    await waitFor(() => expect(app.library.getPaper(id)?.recentHidden).toBe(true));
    expect(within(screen.getByRole('region', { name: '最近阅读' })).getByText('暂无最近阅读记录')).toBeInTheDocument();
    const reloaded = new LibraryService(app.storage, app.extract);
    await reloaded.initialize();
    expect(reloaded.getPaper(id)).toMatchObject({ recentHidden: true, lastPage: 5, zoom: 1.25, favorite: true });
    expect(reloaded.getPaper(id)?.bookmarks).toHaveLength(1);
    expect(reloaded.getPaper(id)?.annotations[0]?.text).toBe(secretNote);
    expect(Array.from(await app.storage.readFile(id))).toEqual(Array.from(primaryPdf()));
    expect(app.persistence.removeRecentDocument).not.toHaveBeenCalled();
  });

  it('reopens a legacy desktop document hidden from recent files with its original notes and bookmarks', async () => {
    const app = fixture();
    const legacy = configureLegacyRecord(app, false);
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await openNative();
    expect(app.persistence.getDocument).toHaveBeenCalledWith(legacy.document.documentKey);
    await waitFor(() => expect(screen.getAllByText(legacy.annotation.text!).length).toBeGreaterThan(0));
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Annotation panel tabs' })).getByRole('tab', { name: /^书签/ }));
    expect(screen.getByRole('button', { name: /Legacy conclusion landmark.*第 6 页/ })).toBeInTheDocument();
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('本地文件');
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('第 3 / 6 页');
    expect(app.persistence.listAnnotations).toHaveBeenCalledWith(legacy.document.documentKey);
    expect(app.persistence.listBookmarks).toHaveBeenCalledWith(legacy.document.documentKey);
    expect(app.persistence.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ documentKey: legacy.document.documentKey }));
    expect(app.library.getView().papers).toEqual([]);
    expect(app.extract).not.toHaveBeenCalled();
  });

  it('opens a legacy bookmark from global search at its target page without changing the desktop document key', async () => {
    const app = fixture();
    const legacy = configureLegacyRecord(app, true);
    const jump = vi.spyOn(ViewerController.prototype, 'jumpToPage');
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.click(screen.getByRole('searchbox', { name: '全局搜索' }));
    const search = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(search).getByLabelText('全局搜索关键词'), { target: { value: 'conclusion landmark' } });
    fireEvent.click(await within(search).findByRole('button', { name: /书签.*Legacy conclusion landmark.*第 6 页.*跳转书签/ }));
    await screen.findByRole('tab', { name: 'cognition.pdf' });
    await screen.findByLabelText('测试 PDF 视图');
    await waitFor(() => expect(jump).toHaveBeenCalledWith(6));
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('第 6 / 6 页');
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('本地文件');
    expect(app.bridge.readDesktopPdf).toHaveBeenCalledWith(legacy.document.path);
    expect(app.persistence.getDocument).toHaveBeenCalledWith(legacy.document.documentKey);
    expect(app.persistence.listAnnotations).toHaveBeenCalledWith(legacy.document.documentKey);
    expect(app.library.getView().papers).toEqual([]);
    expect(app.extract).not.toHaveBeenCalled();
  });

  it('connects My Documents and its AI settings action to live library and provider configuration', async () => {
    const app = fixture();
    await app.library.importPdf(primaryPdf(), 'cognition.pdf');
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '我的文献' }));
    expect(await screen.findByLabelText('科研文献库')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `阅读 ${title}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    expect(await screen.findByRole('form', { name: 'AI 厂商配置' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('厂商名称'), { target: { value: 'Research provider' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.example.org/v1' } });
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'research-model' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fake-session-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await waitFor(() => expect(app.library.getView().snapshot.ai.providers).toHaveLength(1));
    expect(app.library.getView().snapshot.ai.providers[0]).toMatchObject({
      name: 'Research provider', baseUrl: 'https://api.example.org/v1/chat/completions', model: 'research-model',
    });
    expect(JSON.stringify(app.snapshot())).not.toContain('fake-session-key');
    expect(app.completion).not.toHaveBeenCalled();
  });

  it('finds imported full text globally and opens the matching managed paper at its indexed page', async () => {
    const app = fixture();
    const paper = await app.library.importPdf(primaryPdf(), 'cognition.pdf');
    await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond paper'), 'biology.pdf');
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.click(screen.getByRole('searchbox', { name: '全局搜索' }));
    const search = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(search).getByRole('searchbox', { name: '全局搜索关键词' }), { target: { value: contentToken } });
    const hit = within(search).getByRole('button', { name: new RegExp(`文献全文.*${title}.*第 4 页`) });
    fireEvent.click(hit);
    await screen.findByRole('tab', { name: 'cognition.pdf' });
    expect(await screen.findByLabelText('测试 PDF 视图')).toBeInTheDocument();
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('第 4 / 6 页');
    expect(app.library.getPaper(paper.id)?.lastPage).toBe(4);
    expect(screen.queryByRole('tab', { name: 'biology.pdf' })).not.toBeInTheDocument();
    expect(app.bridge.readDesktopPdf).not.toHaveBeenCalled();
  });

  it('removes an encrypted paper tab, metadata, annotations and old search results when its vault locks', async () => {
    const app = fixture();
    const paper = await app.library.importPdf(primaryPdf(), 'cognition.pdf');
    await app.library.saveAnnotation(paper.id, {
      id: null, documentKey: `paper:${paper.id}`, page: 4, type: 'note', color: '#fff',
      text: secretNote, quote: null, areas: [], createdAt: paper.addedAt, updatedAt: paper.updatedAt,
    });
    const folder = await app.library.createFolder('Private project');
    await app.library.categorize([paper.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'strong password');
    render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '我的文献' }));
    fireEvent.click(await screen.findByRole('button', { name: `阅读 ${title}` }));
    await screen.findByLabelText('测试 PDF 视图');
    expect(screen.getByLabelText('文献预览')).toHaveTextContent(title);
    await waitFor(() => expect(screen.getAllByText(secretNote).length).toBeGreaterThan(0));
    const search = await openGlobalSearch();
    fireEvent.change(within(search).getByLabelText('全局搜索关键词'), { target: { value: contentToken } });
    expect(within(search).getByRole('button', { name: new RegExp(`文献全文.*${title}`) })).toBeInTheDocument();
    await act(() => app.library.lockVault(vault.id));
    expect(screen.queryByRole('tab', { name: 'cognition.pdf' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('测试 PDF 视图')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    expect(screen.queryByText(secretNote)).not.toBeInTheDocument();
    expect(screen.queryByText(title, { exact: true })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    const freshSearch = await openGlobalSearch();
    fireEvent.change(within(freshSearch).getByLabelText('全局搜索关键词'), { target: { value: contentToken } });
    expect(within(freshSearch).queryByRole('button', { name: new RegExp(title) })).not.toBeInTheDocument();
    expect(within(freshSearch).getByText('没有找到匹配结果。')).toBeInTheDocument();
  });

  it('restores managed reading progress from the same storage after the App and library service are recreated', async () => {
    const app = fixture();
    const mounted = render(<App research={app.research} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    await openNative();
    fireEvent.click(screen.getByRole('button', { name: '阅读到第 5 页' }));
    const id = app.library.getView().papers[0].id;
    await waitFor(() => {
      expect(app.library.getPaper(id)).toMatchObject({ lastPage: 5, zoom: 1.25 });
      expect(app.snapshot()?.readerSession?.openPaperIds).toEqual([id]);
    });
    const sessionWrites = vi.mocked(app.persistence.saveReaderSession).mock.calls;
    expect(sessionWrites.length).toBeGreaterThan(0);
    expect(sessionWrites.at(-1)?.[0].tabs).toEqual([]);
    mounted.unmount();
    const library = new LibraryService(app.storage, app.extract);
    const ai = new AiService(library, app.completion);
    render(<App research={{ library, ai }} bridge={app.bridge} persistence={app.persistence} viewerRenderer={renderer} />);
    const restored = await screen.findByRole('tab', { name: 'cognition.pdf' });
    fireEvent.click(restored);
    await screen.findByLabelText('测试 PDF 视图');
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('第 5 / 6 页');
    expect(screen.getByLabelText('阅读状态')).toHaveTextContent('125%');
    expect(library.getPaper(id)).toMatchObject({ lastPage: 5, zoom: 1.25 });
    expect(app.bridge.openNativePdf).toHaveBeenCalledOnce();
    expect(app.bridge.readDesktopPdf).not.toHaveBeenCalled();
    expect(app.extract).toHaveBeenCalledOnce();
  });
});
