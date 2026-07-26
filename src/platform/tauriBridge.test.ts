import { describe, expect, it, vi } from 'vitest';
import { createTauriBridge } from './tauriBridge';

describe('tauriBridge', () => {
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
