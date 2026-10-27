import { describe, expect, it, vi } from 'vitest';
import { createTauriBridge } from './tauriBridge';

describe('tauriBridge', () => {
  it('updates the native theme, window, webview and backing layers through one command', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const bridge = createTauriBridge({ invoke });

    await bridge.setWindowBackgroundColor?.('#C7EDCC', 'light');

    expect(invoke.mock.calls).toEqual([
      ['set_window_background_color', { color: '#C7EDCC', theme: 'light' }],
    ]);
  });

  it('preserves color-only callers without overriding the native theme', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    await createTauriBridge({ invoke }).setWindowBackgroundColor?.('#C7EDCC');

    expect(invoke).toHaveBeenCalledExactlyOnceWith('set_window_background_color', { color: '#C7EDCC' });
  });

  it('finishes paired background and native theme updates in order before IPC completes', async () => {
    let resolveWindow!: () => void;
    const pendingWindow = new Promise<void>((resolve) => { resolveWindow = resolve; });
    const invoke = vi.fn().mockResolvedValue(undefined).mockReturnValueOnce(pendingWindow);
    const bridge = createTauriBridge({ invoke });

    const first = bridge.setWindowBackgroundColor?.('#C7EDCC', 'light');
    const second = bridge.setWindowBackgroundColor?.('#0f172a', 'dark');
    const third = bridge.setWindowBackgroundColor?.('#f5f6f8', 'light');
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('set_window_background_color', { color: '#C7EDCC', theme: 'light' });

    resolveWindow();
    await Promise.all([first, second, third]);

    expect(invoke.mock.calls).toEqual([
      ['set_window_background_color', { color: '#C7EDCC', theme: 'light' }],
      ['set_window_background_color', { color: '#0f172a', theme: 'dark' }],
      ['set_window_background_color', { color: '#f5f6f8', theme: 'light' }],
    ]);
  });

  it('reports background failures and allows the next update to succeed', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue(undefined);
    const bridge = createTauriBridge({ invoke });

    await expect(bridge.setWindowBackgroundColor?.('#C7EDCC', 'light')).rejects.toThrow('permission denied');
    await expect(bridge.setWindowBackgroundColor?.('#0f172a', 'dark')).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith('set_window_background_color', { color: '#0f172a', theme: 'dark' });
  });

  it('skips native background updates outside the Tauri runtime', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

    await expect(createTauriBridge().setWindowBackgroundColor?.('#C7EDCC', 'light')).resolves.toBeUndefined();
  });

  it('opens a native PDF path and reads bytes', async () => {
    const open = vi.fn().mockResolvedValue('/tmp/book.pdf');
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);
    const invoke = vi.fn().mockImplementation((command: string) =>
      command === 'stat_desktop_pdf'
        ? Promise.resolve({
            path: '/tmp/book.pdf',
            name: 'book.pdf',
            fileSize: 5,
            modifiedAt: '2026-06-15T00:00:00Z',
          })
        : Promise.resolve(pdfBytes.buffer),
    );
    const bridge = createTauriBridge({ open, invoke });

    expect(bridge.canOpenNativePdf?.()).toBe(true);

    const file = await bridge.openNativePdf();

    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    // Contents are fetched as raw binary; only the small description is JSON.
    expect(invoke).toHaveBeenCalledWith('stat_desktop_pdf', { path: '/tmp/book.pdf' });
    expect(invoke).toHaveBeenCalledWith('read_desktop_pdf_bytes', { path: '/tmp/book.pdf' });
    expect(file).toMatchObject({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });
  });

  it.each([
    ['an ArrayBuffer', () => new Uint8Array([37, 80, 68, 70, 45]).buffer],
    ['a Uint8Array', () => new Uint8Array([37, 80, 68, 70, 45])],
    ['a plain number array', () => [37, 80, 68, 70, 45]],
  ])('decodes PDF contents delivered as %s', async (_label, makePayload) => {
    // The IPC transport is runtime-provided, so decoding stays tolerant rather
    // than leaving the reader unable to open any local file.
    const open = vi.fn().mockResolvedValue('/tmp/book.pdf');
    const invoke = vi.fn().mockImplementation((command: string) =>
      command === 'stat_desktop_pdf'
        ? Promise.resolve({
            path: '/tmp/book.pdf',
            name: 'book.pdf',
            fileSize: 5,
            modifiedAt: null,
          })
        : Promise.resolve(makePayload()),
    );

    const file = await createTauriBridge({ open, invoke }).openNativePdf();

    expect(file?.bytes).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
  });

  it('returns null when native dialog is cancelled', async () => {
    const bridge = createTauriBridge({
      open: vi.fn().mockResolvedValue(null),
      invoke: vi.fn(),
    });

    await expect(bridge.openNativePdf()).resolves.toBeNull();
  });

  it('selects multiple PDF paths without eagerly loading their contents', async () => {
    const open = vi.fn().mockResolvedValue(['/tmp/a.pdf', '/tmp/b.pdf']);
    const invoke = vi.fn();
    const bridge = createTauriBridge({ open, invoke });
    await expect(bridge.selectNativePdfPaths?.()).resolves.toEqual(['/tmp/a.pdf', '/tmp/b.pdf']);
    expect(open).toHaveBeenCalledWith({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('enumerates a selected folder and treats cancellation as an empty selection', async () => {
    const open = vi.fn().mockResolvedValueOnce('/tmp/papers').mockResolvedValueOnce(null);
    const invoke = vi.fn().mockResolvedValue(['/tmp/papers/nested/a.pdf']);
    const bridge = createTauriBridge({ open, invoke });
    await expect(bridge.selectNativePdfFolder?.()).resolves.toEqual(['/tmp/papers/nested/a.pdf']);
    expect(invoke).toHaveBeenCalledWith('list_desktop_pdfs', { directory: '/tmp/papers' });
    await expect(bridge.selectNativePdfFolder?.()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('resolves dropped paths without opening a selection dialog or eagerly loading PDF bytes', async () => {
    const open = vi.fn();
    const result = { pdfPaths: ['/tmp/papers/a.pdf', '/tmp/papers/nested/b.pdf'], hasDirectories: true };
    const invoke = vi.fn().mockResolvedValue(result);
    const bridge = createTauriBridge({ open, invoke });
    await expect(bridge.resolveDroppedPdfPaths?.(['/tmp/papers'])).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('resolve_dropped_pdf_paths', { paths: ['/tmp/papers'] });
    expect(open).not.toHaveBeenCalled();
  });

  it('reports native PDF opening as unavailable outside the Tauri runtime', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

    const bridge = createTauriBridge();

    expect(bridge.canOpenNativePdf?.()).toBe(false);
  });

  it('requires both injected native dependencies for test-time availability', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

    const bridge = createTauriBridge({
      open: vi.fn().mockResolvedValue(null),
    });

    expect(bridge.canOpenNativePdf?.()).toBe(false);
  });
});
