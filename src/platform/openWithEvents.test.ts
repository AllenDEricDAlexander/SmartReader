import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForOpenWith } from './openWithEvents';

const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

describe('openWithEvents', () => {
  beforeEach(() => {
    listenMock.mockReset();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('forwards PDF paths from desktop events', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        invoke: vi.fn(),
        transformCallback: vi.fn(),
      },
    });
    listenMock.mockImplementation(
      async (_eventName: string, handler: (event: { payload: string[] }) => void) => {
        handler({ payload: ['SmartReader', '/tmp/a.pdf', '/tmp/b.txt'] });
        return vi.fn();
      },
    );
    const listener = vi.fn();

    await listenForOpenWith(listener);

    expect(listener).toHaveBeenCalledWith(['/tmp/a.pdf']);
  });

  it('does not subscribe outside the Tauri runtime', async () => {
    const listener = vi.fn();

    const dispose = await listenForOpenWith(listener);

    expect(listenMock).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(dispose()).toBeUndefined();
  });
});
