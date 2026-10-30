import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderRange } from './renderRange';

const require = createRequire(import.meta.url);
const viewerEntry = require.resolve('@react-pdf-viewer/core');

type RenderQueue = {
  setRange(start: number, end: number, visibleStart: number, visibleEnd: number): void;
  setVisibility(page: number, visibility: number): void;
  getHighestPriorityPage(): number;
  markRendering(page: number): void;
  markRendered(page: number): void;
  markNotRendered(): void;
  isInRange(page: number): boolean;
  getRenderingPages(): number[];
};

// The pinned Bun patch changes private scheduling code. Exercise that installed
// code and its real page layers without exporting internals in the application.
function loadViewerInternals(pdfApi: Record<string, unknown> = {}) {
  const source = readFileSync(join(dirname(viewerEntry), 'cjs/core.js'), 'utf8');
  return runInNewContext(`${source}\n({ useRenderQueue, Inner });`, {
    require: (id: string) => id === 'react' ? React : id === 'pdfjs-dist' ? pdfApi : require(id),
    exports: {},
    window,
    document,
    ResizeObserver: globalThis.ResizeObserver,
    IntersectionObserver: globalThis.IntersectionObserver,
  }) as {
    useRenderQueue(props: { doc: { numPages: number; loadingTask: { docId: string } } }): RenderQueue;
    Inner: React.ComponentType<Record<string, unknown>>;
  };
}

function createQueue(start = 30, end = 70, visibleStart = 50, visibleEnd = visibleStart) {
  const { useRenderQueue } = loadViewerInternals();
  const { result } = renderHook(() => useRenderQueue({ doc: { numPages: 200, loadingTask: { docId: 'queue' } } }));
  const queue = result.current;
  queue.setRange(start, end, visibleStart, visibleEnd);
  for (let page = start; page <= end; page += 1) queue.setVisibility(page, -1);
  return queue;
}

function finishNextPage(queue: RenderQueue) {
  const page = queue.getHighestPriorityPage();
  if (page >= 0) {
    queue.markRendering(page);
    queue.markRendered(page);
  }
  return page;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function mockViewerLayout() {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // No visibility notifications: scheduling must also work ahead of observers.
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 800));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
}

function renderSlowViewer(delayFirstPage = false) {
  mockViewerLayout();
  const tasks = new Map<number, ReturnType<typeof deferred<void>> & { cancel: ReturnType<typeof vi.fn> }>();
  const firstText = deferred<{ items: never[]; styles: object; pageIndex: number }>();
  const renderTextLayer = vi.fn(({ container }: { container: HTMLElement; textContentSource: { pageIndex: number } }) => {
    container.appendChild(document.createElement('span'));
    return { promise: Promise.resolve(), cancel: vi.fn() };
  });
  const onCanvasLayerRender = vi.fn();
  const { Inner } = loadViewerInternals({ renderTextLayer });
  const createPage = (pageIndex: number) => ({
    getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) => ({
      width: 600 * scale, height: 1000 * scale, rotation,
      clone() { return this; },
    }),
    getAnnotations: async () => [],
    getTextContent: () => pageIndex === 0 ? firstText.promise : Promise.resolve({ items: [], styles: {}, pageIndex }),
    render: () => {
      const task = deferred<void>();
      const cancel = vi.fn(() => task.reject(new Error('Rendering cancelled')));
      tasks.set(pageIndex, { ...task, cancel });
      return { promise: task.promise, cancel };
    },
  });
  const firstPage = deferred<ReturnType<typeof createPage>>();
  const getPage = vi.fn(async (number: number) => number === 1 && delayFirstPage ? firstPage.promise : createPage(number - 1));
  const doc = { numPages: 200, loadingTask: { docId: 'slow-render' }, getOutline: async () => [], getPage };
  const view = render(<Inner
    currentFile={{ data: 'blob:slow', name: 'Slow.pdf' }}
    doc={doc}
    initialPage={0}
    initialScale={1}
    initialRotation={0}
    enableSmoothScroll={false}
    scrollMode="Vertical"
    viewMode="SinglePage"
    pageSizes={Array.from({ length: doc.numPages }, () => ({ pageWidth: 600, pageHeight: 1000, rotation: 0 }))}
    setRenderRange={createRenderRange()}
    plugins={[{ onCanvasLayerRender }]}
    viewerState={{ pageIndex: 0, scale: 1, rotation: 0, scrollMode: 'Vertical', viewMode: 'SinglePage', fullScreenMode: 'Normal' }}
    onDocumentLoad={vi.fn()}
    onPageChange={vi.fn()}
  />);
  return {
    ...view, tasks, getPage, renderTextLayer, onCanvasLayerRender,
    pages: screen.getByTestId('core__inner-pages'),
    resolveFirstPage: () => firstPage.resolve(createPage(0)),
    resolveFirstText: () => firstText.resolve({ items: [], styles: {}, pageIndex: 0 }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PDF page render scheduling', () => {
  it('renders the current page before offscreen pages even before visibility observers respond', () => {
    const queue = createQueue();
    expect(Array.from({ length: 5 }, () => finishNextPage(queue))).toEqual([50, 51, 52, 49, 53]);
  });

  it('finishes every visible page before starting the nearest offscreen pages', () => {
    const queue = createQueue(30, 71, 50, 51);
    queue.setVisibility(50, 0.9);
    queue.setVisibility(51, 0.1);
    expect(Array.from({ length: 5 }, () => finishNextPage(queue))).toEqual([50, 51, 52, 53, 49]);
  });

  it('pre-renders all 41 pages without requiring offscreen pages to become visible', () => {
    const queue = createQueue();
    queue.setVisibility(50, 1);
    const rendered = Array.from({ length: 41 }, () => finishNextPage(queue));
    expect([...rendered].sort((a, b) => a - b)).toEqual(Array.from({ length: 41 }, (_, i) => i + 30));
    expect(queue.getHighestPriorityPage()).toBe(-1);
  });

  it('prefers nearby pages in the new direction after scrolling backward', () => {
    const queue = createQueue();
    queue.setRange(29, 69, 49, 49);
    queue.setVisibility(29, -1);
    expect(Array.from({ length: 5 }, () => finishNextPage(queue))).toEqual([49, 48, 47, 50, 46]);
  });

  it('renders three pages concurrently and reuses completed pages in an overlapping window', () => {
    const queue = createQueue();
    queue.markRendering(50);
    expect(queue.getHighestPriorityPage()).toBe(51);
    queue.markRendering(51);
    expect(queue.getHighestPriorityPage()).toBe(52);
    queue.markRendering(52);
    expect(queue.getRenderingPages()).toEqual([50, 51, 52]);
    expect(queue.getHighestPriorityPage()).toBe(-1);
    queue.markRendered(50);
    queue.setRange(31, 71, 51, 51);
    queue.setVisibility(71, -1);
    expect(finishNextPage(queue)).toBe(53);
    queue.markRendered(51);
    queue.markRendered(52);
    expect(queue.getRenderingPages()).toEqual([]);
  });

  it('preempts unfinished offscreen work for a newly visible page and ignores stale completion', () => {
    const queue = createQueue();
    for (const page of [50, 51, 52]) queue.markRendering(page);
    queue.setRange(35, 75, 55, 55);
    expect(queue.getHighestPriorityPage()).toBe(55);
    queue.markRendering(55);
    expect(queue.getRenderingPages()).toEqual([51, 52, 55]);
    queue.markRendered(50);
    queue.setRange(30, 70, 50, 50);
    expect(queue.getHighestPriorityPage()).toBe(50);
  });

  it('drops old work after a distant jump and invalidates completed pages on zoom', () => {
    const queue = createQueue();
    queue.markRendering(50);
    queue.setRange(130, 170, 150, 150);
    for (let page = 130; page <= 170; page += 1) queue.setVisibility(page, -1);
    expect(queue.isInRange(50)).toBe(false);
    expect(finishNextPage(queue)).toBe(150);
    expect(finishNextPage(queue)).toBe(151);
    queue.markNotRendered();
    expect(finishNextPage(queue)).toBe(150);
  });

  it.each([
    [0, 20, 0, [0, 1, 2]],
    [179, 199, 199, [199, 198, 197]],
    [0, 0, 0, [0, -1, -1]],
  ] as const)('keeps scheduling inside document bounds %i..%i', (start, end, visible, expected) => {
    const queue = createQueue(start, end, visible);
    expect(Array.from({ length: 3 }, () => finishNextPage(queue))).toEqual(expected);
  });

  it.each(['development', 'production'])('uses the patched queue in %s builds', (mode) => {
    const load = vi.fn();
    runInNewContext(readFileSync(viewerEntry, 'utf8'), {
      process: { env: { NODE_ENV: mode } }, module: { exports: {} }, require: load,
    });
    expect(load).toHaveBeenCalledExactlyOnceWith('./cjs/core.js');
  });

  it('starts actual offscreen canvas rendering while the current page is still unfinished', async () => {
    const view = renderSlowViewer();
    await waitFor(() => expect([...view.tasks.keys()]).toEqual([0, 1, 2]));
    expect(screen.queryByTestId('core__canvas-layer-0')).not.toBeInTheDocument();
    expect(view.pages.scrollTop).toBe(0);
    expect(view.getPage).toHaveBeenCalledWith(2);
    expect(view.getPage).toHaveBeenCalledWith(3);
    for (const task of view.tasks.values()) expect(task.cancel).not.toHaveBeenCalled();
    view.unmount();
    for (const task of view.tasks.values()) expect(task.cancel).toHaveBeenCalledOnce();
  });

  it('finishes both twenty-page sides while the current canvas is still pending', async () => {
    const view = renderSlowViewer();
    await waitFor(() => expect(view.tasks.size).toBe(3));
    fireEvent.scroll(view.pages, { target: { scrollTop: 50_000 } });
    await waitFor(() => expect(view.tasks.has(52)).toBe(true));
    const completed = new Set<number>();
    while (completed.size < 40) {
      const batch = [...view.tasks.entries()].filter(([page, task]) =>
        page >= 30 && page <= 70 && page !== 50 && !completed.has(page) && task.cancel.mock.calls.length === 0);
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(2);
      await act(async () => {
        for (const [page, task] of batch) {
          completed.add(page);
          task.resolve();
        }
      });
    }
    for (let page = 30; page <= 70; page += 1) {
      if (page === 50) continue;
      expect(screen.getByTestId(`core__canvas-layer-${page}`)).toBeInTheDocument();
      expect(screen.getByTestId(`core__text-layer-${page}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('core__canvas-layer-50')).not.toBeInTheDocument();
    const nextCanvas = screen.getByTestId('core__canvas-layer-51');
    fireEvent.scroll(view.pages, { target: { scrollTop: 51_000 } });
    expect(screen.getByTestId('core__canvas-layer-51')).toBe(nextCanvas);
    expect(view.tasks.get(50)?.cancel).not.toHaveBeenCalled();
    view.unmount();
  });

  it('starts each fast-scroll target while preserving the nearer in-flight pre-render jobs', async () => {
    const view = renderSlowViewer();
    await waitFor(() => expect(view.tasks.size).toBe(3));
    const cancelledPages = [0, 1, 2, 5];
    for (const [index, page] of [5, 10, 15, 12].entries()) {
      fireEvent.scroll(view.pages, { target: { scrollTop: page * 1000 } });
      await waitFor(() => expect(view.tasks.has(page)).toBe(true));
      expect(view.tasks.get(cancelledPages[index])?.cancel).toHaveBeenCalledOnce();
      expect([...view.tasks.values()].filter((task) => task.cancel.mock.calls.length === 0)).toHaveLength(3);
    }
    await act(async () => { view.resolveFirstText(); });
    expect(view.renderTextLayer.mock.calls.some(([props]) => props.textContentSource.pageIndex === 0)).toBe(false);
    expect(view.onCanvasLayerRender.mock.calls.some(([props]) => props.pageIndex === 0 && props.status === 'DidRender')).toBe(false);

    await act(async () => { view.tasks.get(12)!.resolve(); });
    await waitFor(() => expect(screen.getByTestId('core__canvas-layer-12')).toBeInTheDocument());
    expect(view.tasks.get(12)?.cancel).not.toHaveBeenCalled();
    expect(screen.getByTestId('core__text-layer-12')).toBeInTheDocument();
    view.unmount();
    for (const task of view.tasks.values()) expect(task.cancel).toHaveBeenCalledOnce();
  });

  it('does not start rendering an abandoned page when its delayed page request resolves', async () => {
    const view = renderSlowViewer(true);
    await waitFor(() => expect(view.getPage).toHaveBeenCalledWith(1));
    fireEvent.scroll(view.pages, { target: { scrollTop: 5000 } });
    await waitFor(() => expect(view.tasks.has(5)).toBe(true));
    await act(async () => { view.resolveFirstPage(); });
    expect(view.tasks.has(0)).toBe(false);
    view.unmount();
    expect(view.tasks.get(5)?.cancel).toHaveBeenCalledOnce();
  });

  it('completes real canvas and text layers for the entire window before any further scrolling', async () => {
    mockViewerLayout();
    const started: number[] = [];
    const { Inner } = loadViewerInternals({
      renderTextLayer: ({ container }: { container: HTMLElement }) => {
        container.appendChild(document.createElement('span'));
        return { promise: Promise.resolve(), cancel: vi.fn() };
      },
    });
    const doc = {
      numPages: 200,
      loadingTask: { docId: 'prerender-window' },
      getOutline: async () => [],
      getPage: async (number: number) => ({
        getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) => ({
          width: 600 * scale, height: 1000 * scale, rotation,
          clone() { return this; },
        }),
        getAnnotations: async () => [],
        getTextContent: async () => ({ items: [], styles: {} }),
        render: () => {
          started.push(number - 1);
          return { promise: Promise.resolve(), cancel: vi.fn() };
        },
      }),
    };
    render(<Inner
      currentFile={{ data: 'blob:queue', name: 'Queue.pdf' }}
      doc={doc}
      initialPage={0}
      initialScale={1}
      initialRotation={0}
      enableSmoothScroll={false}
      scrollMode="Vertical"
      viewMode="SinglePage"
      pageSizes={Array.from({ length: doc.numPages }, () => ({ pageWidth: 600, pageHeight: 1000, rotation: 0 }))}
      setRenderRange={createRenderRange()}
      plugins={[]}
      viewerState={{ pageIndex: 0, scale: 1, rotation: 0, scrollMode: 'Vertical', viewMode: 'SinglePage', fullScreenMode: 'Normal' }}
      onDocumentLoad={vi.fn()}
      onPageChange={vi.fn()}
    />);
    const pages = screen.getByTestId('core__inner-pages');
    fireEvent.scroll(pages, { target: { scrollTop: 50_000 } });

    await waitFor(() => expect(screen.getByTestId('core__canvas-layer-70')).toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId('core__text-layer-30')).toBeInTheDocument(), { timeout: 5000 });
    expect(started.slice(0, 5)).toEqual([50, 51, 52, 49, 53]);
    expect(started).toHaveLength(41);
    expect(screen.queryByTestId('core__page-layer-29')).not.toBeInTheDocument();
    expect(screen.queryByTestId('core__page-layer-71')).not.toBeInTheDocument();
    expect(pages.scrollTop).toBe(50_000);

    const nextCanvas = screen.getByTestId('core__canvas-layer-51');
    fireEvent.scroll(pages, { target: { scrollTop: 51_000 } });
    await waitFor(() => expect(screen.getByTestId('core__text-layer-71')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByTestId('core__canvas-layer-51')).toBe(nextCanvas);
    expect(started.slice(41)).toEqual([71]);
    expect(screen.queryByTestId('core__page-layer-30')).not.toBeInTheDocument();

    fireEvent.scroll(pages, { target: { scrollTop: 50_000 } });
    await waitFor(() => expect(screen.getByTestId('core__text-layer-30')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByTestId('core__canvas-layer-51')).toBe(nextCanvas);
    expect(started.slice(42)).toEqual([30]);

    fireEvent.scroll(pages, { target: { scrollTop: 150_000 } });
    await waitFor(() => expect(screen.getByTestId('core__text-layer-130')).toBeInTheDocument(), { timeout: 5000 });
    expect(started.slice(43, 48)).toEqual([150, 151, 152, 149, 153]);
    expect(started).toHaveLength(84);
    expect(screen.queryByTestId('core__page-layer-50')).not.toBeInTheDocument();
  }, 15000);
});
