import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderProfile } from '../library/libraryModels';
import type { AiHttpRequest, AiHttpResponse } from './aiTransport';
import { normalizeBaseUrl, requestCompletion, type AiMessage } from './openAiClient';

afterEach(() => vi.useRealTimers());

const provider: AiProviderProfile = {
  id: 'custom-provider',
  name: 'Compatible provider',
  baseUrl: 'https://provider.example/custom/v1/',
  model: 'configured-model',
  savedKey: null,
};
const apiKey = 'test-secret-key';
const messages: AiMessage[] = [
  { role: 'system', content: 'Analyze supplied evidence.' },
  { role: 'user', content: 'Scientific document excerpt.' },
];

function response(content = 'A supported conclusion.'): AiHttpResponse {
  return { status: 200, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) };
}

describe('OpenAI-compatible client', () => {
  it.each([
    ['https://provider.example/v1', 'https://provider.example/v1/chat/completions'],
    ['https://provider.example/custom/prefix/', 'https://provider.example/custom/prefix/chat/completions'],
    ['https://provider.example/v1/chat/completions/', 'https://provider.example/v1/chat/completions'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1/chat/completions'],
    ['http://[::1]:8000/api/', 'http://[::1]:8000/api/chat/completions'],
    [' https://provider.example/ ', 'https://provider.example/chat/completions'],
  ])('normalizes %s and remains idempotent', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
    expect(normalizeBaseUrl(expected)).toBe(expected);
  });

  it.each([
    '', 'provider.example/v1', 'ftp://provider.example/v1', 'javascript:alert(1)',
    'https://username:test-secret-key@provider.example/v1',
    'https://provider.example/v1?key=test-secret-key', 'https://provider.example/v1#test-secret-key',
    'https://provider.example/v1?', 'https://provider.example/v1#',
    'https://provider.\nexample/v1',
  ])('rejects invalid or credential-bearing URL without echoing it: %s', (input) => {
    expect(() => normalizeBaseUrl(input)).toThrow();
    try {
      normalizeBaseUrl(input);
    } catch (error) {
      expect(String(error)).not.toContain(apiKey);
    }
  });

  it('sends only the widely supported model/messages/stream body and a unique request id', async () => {
    const transport = vi.fn().mockResolvedValue(response());
    await expect(requestCompletion(provider, ` ${apiKey} `, messages, { transport })).resolves.toBe('A supported conclusion.');
    const [request, signal] = transport.mock.calls[0] as [AiHttpRequest, AbortSignal];
    expect(request).toEqual({
      url: 'https://provider.example/custom/v1/chat/completions',
      apiKey,
      body: { model: provider.model, messages, stream: false },
      timeoutMs: 60_000,
      requestId: expect.any(String),
    });
    expect(request.requestId).toMatch(/^[a-z0-9_-]+$/i);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(request.body.messages).not.toBe(messages);
    await requestCompletion(provider, apiKey, messages, { transport });
    expect(transport.mock.calls[1][0].requestId).not.toBe(request.requestId);
  });

  it('rejects missing keys, models, messages and invalid timeouts before any dispatch', async () => {
    const transport = vi.fn();
    await expect(requestCompletion(provider, ' ', messages, { transport })).rejects.toThrow('API Key');
    await expect(requestCompletion(provider, 'injected\nheader', messages, { transport })).rejects.toThrow('API Key');
    await expect(requestCompletion({ ...provider, model: ' ' }, apiKey, messages, { transport })).rejects.toThrow('模型');
    await expect(requestCompletion(provider, apiKey, [], { transport })).rejects.toThrow('消息');
    for (const timeoutMs of [0, 999, 120_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(requestCompletion(provider, apiKey, messages, { transport, timeoutMs })).rejects.toThrow('超时');
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'API Key'], [403, '权限'], [429, '限额'], [500, '服务'], [503, '服务'], [404, '接口'], [400, '参数'],
  ])('explains HTTP %s without returning any server error body or retrying', async (status, message) => {
    const transport = vi.fn().mockResolvedValue({ status, body: JSON.stringify({ error: { message: `${apiKey} private-document-text` } }) });
    const error = await requestCompletion(provider, apiKey, messages, { transport }).catch((failure: unknown) => failure);
    expect(String(error)).toContain(message);
    expect(String(error)).not.toContain(apiKey);
    expect(String(error)).not.toContain('private-document-text');
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    'invalid JSON test-secret-key', 'null', '{}', '{"choices":[]}',
    '{"choices":[{"message":{"content":null}}]}',
    '{"choices":[{"message":{"content":[{"type":"text","text":"unsupported"}]}}]}',
    '{"choices":[{"message":{"content":"  "}}]}',
  ])('rejects malformed or missing text responses without echoing content', async (body) => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body });
    const error = await requestCompletion(provider, apiKey, messages, { transport }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(apiKey);
  });

  it('redacts an exact API key echoed inside an otherwise successful response', async () => {
    const transport = vi.fn().mockResolvedValue(response(`Before ${apiKey}, after ${apiKey}.`));
    const content = await requestCompletion(provider, apiKey, messages, { transport });
    expect(content).toContain('Before');
    expect(content).toContain('after');
    expect(content).not.toContain(apiKey);
  });

  it('sanitizes arbitrary transport exceptions rather than leaking messages or causes', async () => {
    const transport = vi.fn().mockRejectedValue(new Error(`Network failure: ${apiKey}`, { cause: `private text ${apiKey}` }));
    const error = await requestCompletion(provider, apiKey, messages, { transport }).catch((failure: unknown) => failure);
    expect(String(error)).not.toContain(apiKey);
    expect(error).not.toHaveProperty('cause');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('skips a pre-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn();
    await expect(requestCompletion(provider, apiKey, messages, { transport, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('cancels even when an injected transport ignores its signal and later completes', async () => {
    const controller = new AbortController();
    let complete: (value: AiHttpResponse) => void = () => undefined;
    const transport = vi.fn().mockImplementation(() => new Promise<AiHttpResponse>((resolve) => { complete = resolve; }));
    const result = requestCompletion(provider, apiKey, messages, { transport, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect((transport.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    complete(response('late result'));
    await Promise.resolve();
  });

  it('enforces timeout locally and aborts the native transport without retrying', async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockReturnValue(new Promise(() => undefined));
    const result = requestCompletion(provider, apiKey, messages, { transport, timeoutMs: 1000 });
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect((transport.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
