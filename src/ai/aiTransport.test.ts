import { describe, expect, it, vi } from 'vitest';
import { createAiTransport, type AiHttpRequest, type AiHttpResponse } from './aiTransport';

const request: AiHttpRequest = {
  url: 'https://provider.example/v1/chat/completions',
  apiKey: 'test-provider-key',
  body: { model: 'configured-model', messages: [{ role: 'user', content: 'Hello' }], stream: false },
  timeoutMs: 60_000,
  requestId: 'test-request-1',
};

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
