import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../../documents/documentModels';
import type { LibraryService } from '../../library/libraryService';
import { useReadingTime } from './useReadingTime';

function session(id = 'paper-a', page = 1, zoom = 1): DocumentSession {
  return {
    id: `session-${id}`, documentKey: `paper:${id}`, title: `${id}.pdf`,
    source: { kind: 'library', paperId: id, name: `${id}.pdf` },
    page, totalPages: 20, progress: page / 20, zoom,
    history: { currentPage: page, backStack: [], forwardStack: [] },
    status: 'ready', errorMessage: null, restored: false, updatedAt: '2026-10-11',
  };
}

function libraryFixture() {
  let epoch = 0;
  const lockedIds = new Set<string>();
  const listeners = new Set<(ids: string[]) => void>();
  const recordReading = vi.fn(async (_id: string, _seconds: number, _page: number, _zoom: number) => undefined);
  const library = {
    recordReading,
    captureAccess: () => epoch,
    canAccess: (id: string, token: number) => token === epoch && !lockedIds.has(id),
    onLocked: (listener: (ids: string[]) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } as unknown as LibraryService;
  return {
    library, recordReading,
    lock(id: string) {
      epoch += 1;
      lockedIds.add(id);
      for (const listener of listeners) listener([id]);
    },
  };
}

let focused: boolean;
let visibility: DocumentVisibilityState;

beforeEach(() => {
  focused = true;
  visibility = 'visible';
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function advance(milliseconds: number) {
  await act(async () => { vi.advanceTimersByTime(milliseconds); });
}

async function setFocus(next: boolean) {
  await act(async () => {
    focused = next;
    window.dispatchEvent(new Event(next ? 'focus' : 'blur'));
  });
}

async function setVisibility(next: DocumentVisibilityState) {
  await act(async () => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('foreground reading time', () => {
  it('waits for the real PDF ready signal even when restored session status is ready', async () => {
    const { library, recordReading } = libraryFixture();
    const document = session();
    const rendered = renderHook(({ ready }) => useReadingTime({ library, session: document, active: true, ready }), {
      initialProps: { ready: false },
    });
    await advance(45_000);
    expect(recordReading).not.toHaveBeenCalled();
    rendered.rerender({ ready: true });
    await advance(15_000);
    expect(recordReading).toHaveBeenCalledExactlyOnceWith('paper-a', 15, 1, 1);
    rendered.unmount();
  });

  it('flushes foreground segments and never adds background time after focus or visibility returns', async () => {
    const { library, recordReading } = libraryFixture();
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true }));
    await advance(10_000);
    await setFocus(false);
    expect(recordReading).toHaveBeenCalledExactlyOnceWith('paper-a', 10, 1, 1);
    await advance(60_000);
    expect(recordReading).toHaveBeenCalledTimes(1);
    await setFocus(true);
    await advance(5_000);
    await setVisibility('hidden');
    await advance(30_000);
    await setVisibility('visible');
    await advance(10_000);
    rendered.unmount();
    expect(recordReading.mock.calls.reduce((sum, call) => sum + call[1], 0)).toBe(25);
  });

  it('attributes a closing tab segment to its latest page and zoom before starting the next tab', async () => {
    const { library, recordReading } = libraryFixture();
    const rendered = renderHook(({ current }) => useReadingTime({ library, session: current, active: true, ready: true }), {
      initialProps: { current: session('paper-a') },
    });
    await advance(8_000);
    rendered.rerender({ current: session('paper-a', 4, 1.5) });
    await advance(4_000);
    rendered.rerender({ current: session('paper-b', 7, 2) });
    expect(recordReading).toHaveBeenNthCalledWith(1, 'paper-a', 12, 4, 1.5);
    await advance(15_000);
    expect(recordReading).toHaveBeenNthCalledWith(2, 'paper-b', 15, 7, 2);
    rendered.unmount();
  });

  it('flushes when leaving the reader and does not count inactive or legacy sessions', async () => {
    const { library, recordReading } = libraryFixture();
    const rendered = renderHook(({ active, current }) => useReadingTime({ library, session: current, active, ready: true }), {
      initialProps: { active: true, current: session() },
    });
    await advance(6_000);
    rendered.rerender({ active: false, current: session() });
    expect(recordReading).toHaveBeenCalledExactlyOnceWith('paper-a', 6, 1, 1);
    await advance(60_000);
    rendered.rerender({ active: true, current: {
      ...session(), source: { kind: 'desktop-path', path: '/legacy.pdf', name: 'legacy.pdf' },
    } });
    await advance(30_000);
    expect(recordReading).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });

  it('does not count a hidden initial window or resume while the window is still blurred', async () => {
    const { library, recordReading } = libraryFixture();
    visibility = 'hidden';
    focused = false;
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true }));
    await advance(30_000);
    await setVisibility('visible');
    await advance(20_000);
    expect(recordReading).not.toHaveBeenCalled();
    await setFocus(true);
    await advance(10_000);
    rendered.unmount();
    expect(recordReading.mock.calls.reduce((sum, call) => sum + call[1], 0)).toBe(10);
  });

  it('discards buffered time when the current paper locks and never writes after locking', async () => {
    const { library, recordReading, lock } = libraryFixture();
    const onError = vi.fn();
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true, onError }));
    await advance(8_000);
    act(() => { lock('paper-a'); });
    await advance(45_000);
    await setFocus(false);
    await setFocus(true);
    rendered.unmount();
    expect(recordReading).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('continues counting the current paper when an unrelated vault changes the access epoch', async () => {
    const { library, recordReading, lock } = libraryFixture();
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true }));
    await advance(8_000);
    act(() => { lock('other-paper'); });
    await advance(7_000);
    expect(recordReading).toHaveBeenCalledExactlyOnceWith('paper-a', 15, 1, 1);
    rendered.unmount();
  });

  it('reports failed writes and retries the unrecorded segment during the next interval', async () => {
    const { library, recordReading } = libraryFixture();
    recordReading.mockRejectedValueOnce(new Error('磁盘写入失败'));
    const onError = vi.fn();
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true, onError }));
    await advance(15_000);
    expect(onError).toHaveBeenCalledWith('磁盘写入失败');
    await advance(15_000);
    expect(recordReading).toHaveBeenNthCalledWith(2, 'paper-a', 30, 1, 1);
    rendered.unmount();
  });

  it('suppresses stale in-flight write failures after the paper locks', async () => {
    const { library, recordReading, lock } = libraryFixture();
    let fail: (error: Error) => void = () => undefined;
    recordReading.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const onError = vi.fn();
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true, onError }));
    await advance(15_000);
    act(() => { lock('paper-a'); });
    await act(async () => { fail(new Error('请先解锁')); });
    await advance(30_000);
    rendered.unmount();
    expect(recordReading).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('splits delayed foreground segments to preserve time across the service increment limit', () => {
    const { library, recordReading } = libraryFixture();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const rendered = renderHook(() => useReadingTime({ library, session: session(), active: true, ready: true }));
    now.mockReturnValue(125_000);
    rendered.unmount();
    expect(recordReading.mock.calls.map((call) => call[1])).toEqual([60, 60, 5]);
  });
});
