import { describe, expect, it, vi } from 'vitest';
import { listenForOpenWith } from './openWithEvents';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_eventName: string, handler: (event: { payload: string[] }) => void) => {
    handler({ payload: ['SmartReader', '/tmp/a.pdf', '/tmp/b.txt'] });
    return vi.fn();
  }),
}));

describe('openWithEvents', () => {
  it('forwards PDF paths from desktop events', async () => {
    const listener = vi.fn();

    await listenForOpenWith(listener);

    expect(listener).toHaveBeenCalledWith(['/tmp/a.pdf']);
  });
});
