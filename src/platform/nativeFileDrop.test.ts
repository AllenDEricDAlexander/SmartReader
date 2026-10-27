import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { listenForNativeFileDrop } from './nativeFileDrop';

const subscribe = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: subscribe }) }));

beforeEach(() => {
  subscribe.mockReset();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});
afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('nativeFileDrop', () => {
  it('does not register desktop events in a browser', async () => {
    await expect(listenForNativeFileDrop(document.createElement('div'), vi.fn(), vi.fn())).resolves.toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('uses physical pixels to hit-test the current import box and ignores drops elsewhere', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true, value: { invoke: vi.fn(), transformCallback: vi.fn() },
    });
    vi.stubGlobal('devicePixelRatio', 2);
    const element = document.createElement('div');
    const rect = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 240, 180));
    let emit!: (event: { payload: DragDropEvent }) => void;
    const dispose = vi.fn();
    subscribe.mockImplementation(async (handler) => { emit = handler; return dispose; });
    const onDrop = vi.fn();
    const onHover = vi.fn();
    const stop = await listenForNativeFileDrop(element, onDrop, onHover);
    const position = (x: number, y: number) => new PhysicalPosition(x, y);

    emit({ payload: { type: 'enter', paths: ['/tmp/papers'], position: position(300, 200) } });
    expect(onHover).toHaveBeenLastCalledWith(true);
    emit({ payload: { type: 'drop', paths: ['/tmp/papers'], position: position(300, 200) } });
    expect(onDrop).toHaveBeenCalledExactlyOnceWith(['/tmp/papers']);
    expect(onHover).toHaveBeenLastCalledWith(false);
    rect.mockReturnValue(new DOMRect(100, 300, 240, 180));
    emit({ payload: { type: 'drop', paths: ['/tmp/outside.pdf'], position: position(300, 200) } });
    expect(onDrop).toHaveBeenCalledOnce();
    emit({ payload: { type: 'leave' } });
    expect(onHover).toHaveBeenLastCalledWith(false);
    stop?.();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
