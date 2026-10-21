import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@tauri-apps/api/core';
import { createAiStreamTransport, createAiTransport, type AiHttpRequest, type AiHttpResponse } from './aiTransport';

const request: AiHttpRequest = {
  url: 'https://provider.example/v1/chat/completions',
  apiKey: 'test-provider-key',
  body: { model: 'configured-model', messages: [{ role: 'user', content: 'Hello' }], stream: false },
  timeoutMs: 60_000,
  requestId: 'test-request-1',
};

afterEach(() => { vi.useRealTimers(); });

describe('desktop AI transport', () => {
  it('sends the agreed native request envelope and returns the HTTP status and body', async () => {
    const response = { status: 200, body: '{"choices":[]}' };
    const invoke = vi.fn().mockResolvedValue(response);
    await expect(createAiTransport(invoke)(request)).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('ai_http_request', { request });
  });

  it('does not dispatch a request that was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn();
    await expect(createAiTransport(invoke)(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects cancellation immediately without waiting for native cancellation and ignores a late response', async () => {
    const controller = new AbortController();
    let complete: (response: AiHttpResponse) => void = () => undefined;
    const pending = new Promise<AiHttpResponse>((resolve) => { complete = resolve; });
    const invoke = vi.fn().mockImplementation((command: string) => command === 'ai_http_request' ? pending : new Promise(() => undefined));
    const onSuccess = vi.fn();
    const result = createAiTransport(invoke)(request, controller.signal);
    void result.then(onSuccess, () => undefined);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).toHaveBeenCalledWith('cancel_ai_request', { requestId: request.requestId });
    complete({ status: 200, body: 'late response' });
    await Promise.resolve();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('absorbs late native rejection and failed cancellation after reporting the original abort', async () => {
    const controller = new AbortController();
    let fail: (error: Error) => void = () => undefined;
    const pending = new Promise<AiHttpResponse>((_resolve, reject) => { fail = reject; });
    const invoke = vi.fn().mockImplementation((command: string) => command === 'ai_http_request' ? pending : Promise.reject(new Error('cancel failed with test-provider-key')));
    const result = createAiTransport(invoke)(request, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    fail(new Error('late rejection with test-provider-key'));
    await Promise.resolve();
  });

  it('removes the cancellation listener after a completed request', async () => {
    const controller = new AbortController();
    const invoke = vi.fn().mockResolvedValue({ status: 200, body: '{}' });
    await createAiTransport(invoke)(request, controller.signal);
    controller.abort();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['AI_HTTP_CANCELLED', 'AbortError', '取消'],
    ['AI_HTTP_TIMEOUT', 'TimeoutError', '超时'],
    ['AI_HTTP_INVALID_REQUEST', 'Error', '配置'],
    ['AI_HTTP_NETWORK', 'Error', '网络'],
    ['AI_HTTP_RESPONSE_TOO_LARGE', 'Error', '过大'],
    ['unexpected failure', 'Error', '网络'],
  ])('maps %s to a safe actionable error without raw native details', async (code, name, message) => {
    const invoke = vi.fn().mockRejectedValue(`${code}: test-provider-key https://private-provider.example`);
    const error = await createAiTransport(invoke)(request).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ name, message: expect.stringContaining(message) });
    expect(String(error)).not.toContain(request.apiKey);
    expect(String(error)).not.toContain('private-provider');
  });

  it('also sanitizes a synchronous IPC failure', async () => {
    const invoke = vi.fn().mockImplementation(() => { throw new Error(request.apiKey); });
    const error = await createAiTransport(invoke)(request).catch((failure: unknown) => failure);
    expect(String(error)).not.toContain(request.apiKey);
  });
});

describe('desktop AI streaming transport', () => {
  function channelFactory() {
    const handlers: Array<(event: unknown) => void> = [];
    const create = <T>(onmessage: (event: T) => void) => {
      handlers.push(onmessage as (event: unknown) => void);
      return { marker: handlers.length } as unknown as Channel<T>;
    };
    return { handlers, create };
  }

  it('passes a channel to the native streaming command and forwards its events', async () => {
    const { handlers, create } = channelFactory();
    const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      expect(command).toBe('ai_http_stream');
      handlers[0]({ kind: 'status', status: 200 });
      handlers[0]({ kind: 'chunk', data: 'data: {}\n\n' });
      handlers[0]({ kind: 'end' });
    });
    const events: unknown[] = [];
    await createAiStreamTransport(invoke as never, create)({ ...request, body: { ...request.body, stream: true } }, (event) => events.push(event));
    expect(events).toEqual([{ kind: 'status', status: 200 }, { kind: 'chunk', data: 'data: {}\n\n' }, { kind: 'end' }]);
    expect(invoke.mock.calls[0][1]).toMatchObject({ onEvent: { marker: 1 } });
  });

  it('waits for delayed channel chunks and end after the native command has finished', async () => {
    vi.useFakeTimers();
    const { handlers, create } = channelFactory();
    const invoke = vi.fn().mockResolvedValue(undefined);
    const events: unknown[] = [];
    const completed = vi.fn();
    const work = createAiStreamTransport(invoke, create)(request, (event) => events.push(event));
    void work.then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    handlers[0]({ kind: 'status', status: 200 });
    handlers[0]({ kind: 'chunk', data: 'delayed answer' });
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    handlers[0]({ kind: 'end' });
    await work;
    expect(events).toEqual([{ kind: 'status', status: 200 }, { kind: 'chunk', data: 'delayed answer' }, { kind: 'end' }]);
    expect(completed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a native failure that arrives after the end event', async () => {
    const { handlers, create } = channelFactory();
    let fail: (error: unknown) => void = () => undefined;
    const invoke = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const work = createAiStreamTransport(invoke, create)(request, () => undefined);
    const rejected = expect(work).rejects.toMatchObject({ code: 'AI_HTTP_NETWORK' });
    handlers[0]({ kind: 'end' });
    fail('AI_HTTP_NETWORK');
    await rejected;
  });

  it.each([false, true])('times out when channel completion is missing, native command finished: %s', async (finished) => {
    vi.useFakeTimers();
    const { handlers, create } = channelFactory();
    const invoke = vi.fn().mockImplementation((command: string) => command === 'ai_http_stream' && !finished
      ? new Promise(() => undefined) : Promise.resolve());
    const events: unknown[] = [];
    const work = createAiStreamTransport(invoke, create)({ ...request, timeoutMs: 1000 }, (event) => events.push(event));
    const rejected = expect(work).rejects.toMatchObject({ name: 'TimeoutError', code: 'AI_HTTP_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    handlers[0]({ kind: 'chunk', data: 'late answer' });
    handlers[0]({ kind: 'end' });
    expect(events).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('cancel_ai_request', { requestId: request.requestId });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can cancel while waiting for channel events after the command resolves', async () => {
    const controller = new AbortController();
    const { handlers, create } = channelFactory();
    const invoke = vi.fn().mockResolvedValue(undefined);
    const events: unknown[] = [];
    const work = createAiStreamTransport(invoke, create)(request, (event) => events.push(event), controller.signal);
    const rejected = expect(work).rejects.toMatchObject({ code: 'AI_HTTP_CANCELLED' });
    await Promise.resolve();
    controller.abort();
    await rejected;
    handlers[0]({ kind: 'chunk', data: 'late answer' });
    handlers[0]({ kind: 'end' });
    expect(events).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('cancel_ai_request', { requestId: request.requestId });
  });

  it('rejects and cleans up a failed stream consumer instead of silently dropping its event', async () => {
    vi.useFakeTimers();
    const { handlers, create } = channelFactory();
    const invoke = vi.fn().mockResolvedValue(undefined);
    const work = createAiStreamTransport(invoke, create)(request, () => { throw new Error(request.apiKey); });
    const rejected = expect(work).rejects.toMatchObject({ code: 'AI_HTTP_NETWORK' });
    handlers[0]({ kind: 'chunk', data: 'answer' });
    await rejected;
    expect(invoke).toHaveBeenCalledWith('cancel_ai_request', { requestId: request.requestId });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up a synchronous channel construction failure', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn();
    await expect(createAiStreamTransport(invoke, () => { throw new Error(request.apiKey); })(request, () => undefined))
      .rejects.toMatchObject({ code: 'AI_HTTP_NETWORK' });
    expect(invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops forwarding events and cancels the native request once aborted', async () => {
    const controller = new AbortController();
    const { handlers, create } = channelFactory();
    const invoke = vi.fn(async (command: string) => {
      if (command === 'ai_http_stream') return new Promise(() => undefined);
      return undefined;
    });
    const events: unknown[] = [];
    const work = createAiStreamTransport(invoke as never, create)(request, (event) => events.push(event), controller.signal);
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError', code: 'AI_HTTP_CANCELLED' });
    controller.abort();
    await rejected;
    handlers[0]({ kind: 'chunk', data: 'late text' });
    expect(events).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('cancel_ai_request', { requestId: request.requestId });
  });

  it('does not dispatch a stream that was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn();
    await expect(createAiStreamTransport(invoke)(request, () => undefined, controller.signal))
      .rejects.toMatchObject({ code: 'AI_HTTP_CANCELLED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('normalizes a native streaming failure to a safe code', async () => {
    const invoke = vi.fn().mockRejectedValue('AI_HTTP_TIMEOUT: request timed out');
    await expect(createAiStreamTransport(invoke, channelFactory().create)(request, () => undefined))
      .rejects.toMatchObject({ name: 'TimeoutError', code: 'AI_HTTP_TIMEOUT' });
  });
});
