import { describe, expect, it, vi } from 'vitest';
import { installAiShutdownHandler } from './aiShutdown';

function setup() {
  let request!: (kind: 'close' | 'exit') => Promise<void>;
  const stop = vi.fn();
  const dependencies = {
    listen: vi.fn(async (handler: typeof request) => { request = handler; return stop; }),
    enable: vi.fn(async () => undefined),
    complete: vi.fn(async (_kind: 'close' | 'exit') => undefined),
  };
  const ai = { flushAssistantSession: vi.fn(async (): Promise<void> => undefined), reportShutdownFailure: vi.fn() };
  return { ai, dependencies, stop, request: (kind: 'close' | 'exit') => request(kind) };
}

describe('AI shutdown persistence', () => {
  it.each(['close', 'exit'] as const)('waits for chat storage before completing %s and coalesces repeated requests', async (kind) => {
    const app = setup();
    let release!: () => void;
    app.ai.flushAssistantSession.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    await installAiShutdownHandler(app.ai, app.dependencies);
    expect(app.dependencies.listen.mock.invocationCallOrder[0]).toBeLessThan(app.dependencies.enable.mock.invocationCallOrder[0]);
    const closing = app.request(kind);
    await app.request(kind);
    expect(app.dependencies.complete).not.toHaveBeenCalled();
    expect(app.ai.flushAssistantSession).toHaveBeenCalledOnce();
    release();
    await closing;
    expect(app.dependencies.complete).toHaveBeenCalledExactlyOnceWith(kind);
  });

  it('leaves the app open on a failed save and permits retry', async () => {
    const app = setup();
    const error = new Error('disk full');
    app.ai.flushAssistantSession.mockRejectedValueOnce(error);
    await installAiShutdownHandler(app.ai, app.dependencies);
    await app.request('exit');
    expect(app.dependencies.complete).not.toHaveBeenCalled();
    expect(app.ai.reportShutdownFailure).toHaveBeenCalledWith(error);
    await app.request('exit');
    expect(app.dependencies.complete).toHaveBeenCalledExactlyOnceWith('exit');
  });

  it('removes the listener if enabling the native handler fails', async () => {
    const app = setup();
    app.dependencies.enable.mockRejectedValueOnce(new Error('native unavailable'));
    await expect(installAiShutdownHandler(app.ai, app.dependencies)).rejects.toThrow('native unavailable');
    expect(app.stop).toHaveBeenCalledOnce();
  });
});
