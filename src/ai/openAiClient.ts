import type { AiProviderProfile } from '../library/libraryModels';
import {
  createAiStreamTransport,
  createAiTransport,
  normalizeAiTransportError,
  type AiHttpResponse,
  type AiStreamTransport,
  type AiTransport,
} from './aiTransport';

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiCompletionOptions = {
  signal?: AbortSignal;
  transport?: AiTransport;
  timeoutMs?: number;
};

export type AiStreamOptions = {
  signal?: AbortSignal;
  transport?: AiStreamTransport;
  timeoutMs?: number;
  /** Visible answer text, delivered as the provider produces it. */
  onDelta?(text: string): void;
  /** Chain-of-thought text from reasoning models, kept out of the answer. */
  onReasoning?(text: string): void;
};

/** Default chat budget. Reasoning models routinely need more than a minute. */
export const CHAT_TIMEOUT_MS = 120_000;

/** Validates a service address without deciding which endpoint it serves. */
export function parseServiceUrl(value: string): URL {
  const input = value.trim();
  const invalidUrl = () => new Error('AI 服务地址必须是有效的 HTTP 或 HTTPS 地址，且不能包含账号、查询参数或片段。');
  if (!/^https?:\/\//i.test(input) || /[\u0000-\u001f\u007f?#]/.test(input)) {
    throw invalidUrl();
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidUrl();
  }
  if (!url.hostname || url.username || url.password || /^https?:\/\/[^/]*@/i.test(input)) {
    throw invalidUrl();
  }
  return url;
}

/** A service path with trailing slashes removed; `/` counts as no path at all. */
export function servicePath(url: URL): string {
  return url.pathname.replace(/\/+$/, '');
}

export function normalizeBaseUrl(value: string): string {
  const url = parseServiceUrl(value);
  const path = servicePath(url);
  if (path.endsWith('/chat/completions')) {
    url.pathname = path;
    return url.toString();
  }
  // A bare host is the most common way an OpenAI-compatible address is pasted.
  // Those services expose the chat endpoint under a version prefix, so guessing
  // `/v1` turns a silent 404 into a working configuration.
  url.pathname = path ? `${path}/chat/completions` : '/v1/chat/completions';
  return url.toString();
}

export async function requestCompletion(
  provider: AiProviderProfile,
  key: string,
  messages: AiMessage[],
  options: AiCompletionOptions = {},
): Promise<string> {
  const { apiKey, url, body } = prepareCompletion(provider, key, messages, options.signal);
  // Alibaba's hybrid-thinking Qwen3.8-27B defaults to thinking mode, which its
  // synchronous endpoint rejects. Streaming calls may keep thinking enabled.
  const aliyunQwen = /(?:^|\.)(?:maas|dashscope)\.aliyuncs\.com$/i.test(new URL(url).hostname)
    && /^qwen3\.8-27b(?:-|$)/i.test(provider.model.trim());
  const parsed = await requestAiJson(url, apiKey, {
    ...body, stream: false, ...(aliyunQwen ? { enable_thinking: false } : {}),
  }, { ...options, timeoutMs: options.timeoutMs ?? CHAT_TIMEOUT_MS });
  const choices = isRecord(parsed) && Array.isArray(parsed.choices) ? parsed.choices : [];
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : null;
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content.trim()) {
    // A reasoning model that spent its whole budget thinking returns an empty
    // answer with a populated thinking field; that needs a different fix than a
    // provider which cannot serve Chat Completions at all.
    throw new Error(typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()
      ? 'AI 模型只返回了思考内容，没有正式回答。请换用非推理模型或提高模型的输出长度上限。'
      : 'AI 服务未返回可用文本，请确认模型支持 Chat Completions 文本输出。');
  }
  return redact(content, apiKey);
}

/**
 * Streams one chat completion, returning the full answer once the provider
 * finishes. Deltas reach `onDelta` in order; a cancelled signal stops delivery
 * before the next delta, so a discarded answer never reaches the transcript.
 */
export async function streamCompletion(
  provider: AiProviderProfile,
  key: string,
  messages: AiMessage[],
  options: AiStreamOptions = {},
): Promise<string> {
  const { apiKey, url, body } = prepareCompletion(provider, key, messages, options.signal);
  const timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error('AI 请求超时必须在 1000 至 120000 毫秒之间。');
  }
  const transport = options.transport ?? createAiStreamTransport();
  let status = 0;
  let buffer = '';
  let failure: Error | null = null;
  let content = '';
  let reasoning = '';
  let errorBody = '';
  const consume = (text: string) => {
    if (status && (status < 200 || status >= 300)) {
      // Error bodies are not server-sent events; keep them for the message.
      errorBody = (errorBody + text).slice(0, 4000);
      return;
    }
    buffer += text;
    const { payloads, rest } = readSseEvents(buffer);
    buffer = rest;
    for (const payload of payloads) {
      if (payload === '[DONE]') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      if (parsed.error !== undefined && parsed.error !== null) {
        failure ??= withProviderDetail(new Error('AI 服务在流式响应中返回了错误。'), payload, apiKey);
        continue;
      }
      const choice = Array.isArray(parsed.choices) && isRecord(parsed.choices[0]) ? parsed.choices[0] : null;
      const delta = isRecord(choice?.delta) ? choice.delta : isRecord(choice?.message) ? choice.message : null;
      const chunk = typeof delta?.content === 'string' ? delta.content : '';
      const thought = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content
        : typeof delta?.reasoning === 'string' ? delta.reasoning : '';
      if (chunk) {
        content += chunk;
        options.onDelta?.(redact(chunk, apiKey));
      }
      if (thought) {
        reasoning += thought;
        options.onReasoning?.(redact(thought, apiKey));
      }
    }
  };
  try {
    await transport({ url, apiKey, body: { ...body, stream: true }, timeoutMs, requestId: crypto.randomUUID() },
      (event) => {
        if (event.kind === 'status') status = event.status;
        else if (event.kind === 'chunk') consume(event.data);
      }, options.signal);
  } catch (error) {
    throw normalizeAiTransportError(error);
  }
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('AI 服务返回了无效的响应。');
  if (status < 200 || status >= 300) throw httpError(status, errorBody, apiKey);
  if (failure) throw failure;
  if (!content.trim()) {
    if (reasoning.trim()) throw new Error('AI 模型只返回了思考内容，没有正式回答。请换用非推理模型或提高模型的输出长度上限。');
    // A service that answers a streaming request with a non-event body yields
    // nothing here. The tag lets the caller retry once without streaming
    // instead of reporting an empty answer.
    throw Object.assign(new Error('AI 服务没有返回任何回答内容，请确认模型支持流式 Chat Completions 输出。'), { code: 'AI_STREAM_EMPTY' });
  }
  return redact(content, apiKey);
}

/**
 * Splits complete server-sent events out of a streaming buffer and returns the
 * incomplete tail, so a frame split across native chunks is never dropped.
 */
export function readSseEvents(buffer: string): { payloads: string[]; rest: string } {
  const payloads: string[] = [];
  let rest = buffer;
  for (;;) {
    const boundary = /\r?\n\r?\n/.exec(rest);
    if (!boundary) break;
    const frame = rest.slice(0, boundary.index);
    rest = rest.slice(boundary.index + boundary[0].length);
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) payloads.push(data);
  }
  return { payloads, rest };
}

/** Shared bounded native HTTP path for chat, embeddings and Milvus REST requests. */
export async function requestAiJson(
  url: string, key: string, body: Record<string, unknown>,
  options: { signal?: AbortSignal; transport?: AiTransport; timeoutMs?: number } = {},
): Promise<unknown> {
  const apiKey = key.trim();
  if (!apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new Error('请填写有效的 API Key 或服务令牌。');
  if (options.signal?.aborted) throw normalizeAiTransportError('AI_HTTP_CANCELLED');
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error('AI 请求超时必须在 1000 至 120000 毫秒之间。');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let rejectCancelled: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = () => reject(normalizeAiTransportError(timedOut ? 'AI_HTTP_TIMEOUT' : 'AI_HTTP_CANCELLED'));
  });
  controller.signal.addEventListener('abort', rejectCancelled, { once: true });
  let response: AiHttpResponse;
  try {
    response = await Promise.race([
      (options.transport ?? createAiTransport())({
        url,
        apiKey,
        body,
        timeoutMs,
        requestId: crypto.randomUUID(),
      }, controller.signal),
      cancelled,
    ]);
    if (controller.signal.aborted) {
      throw normalizeAiTransportError(timedOut ? 'AI_HTTP_TIMEOUT' : 'AI_HTTP_CANCELLED');
    }
  } catch (error) {
    throw normalizeAiTransportError(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectCancelled);
  }
  if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || typeof response.body !== 'string') {
    throw new Error('AI 服务返回了无效的响应。');
  }
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, response.body, apiKey);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error('AI 服务返回的内容不是有效的 JSON 响应。');
  }
  return parsed;
}

function prepareCompletion(provider: AiProviderProfile, key: string, messages: AiMessage[], signal?: AbortSignal) {
  if (signal?.aborted) throw normalizeAiTransportError('AI_HTTP_CANCELLED');
  const apiKey = key.trim();
  if (!apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new Error('请填写有效的 API Key。');
  const model = provider.model.trim();
  if (!model) throw new Error('请填写 AI 模型名称。');
  const url = normalizeBaseUrl(provider.baseUrl);
  if (!messages.length || messages.some((message) =>
    !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
    throw new Error('AI 请求必须包含有效的文本消息。');
  }
  return { apiKey, url, body: { model, messages: messages.map(({ role, content }) => ({ role, content })) } };
}

function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[已隐藏 API Key]') : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the provider's own explanation off a failure. It is attached to the
 * error rather than written into its message, because a provider may echo the
 * request — which carries document excerpts — back in an error body. Only the
 * connection tests, whose requests contain no document text, show it.
 */
export function providerDetail(error: unknown): string {
  const detail = typeof error === 'object' && error !== null ? (error as { providerMessage?: unknown }).providerMessage : null;
  return typeof detail === 'string' ? detail : '';
}

function withProviderDetail(error: Error, body: string | undefined, apiKey: string): Error {
  const message = extractDetail(body, apiKey);
  return message ? Object.assign(error, { providerMessage: message }) : error;
}

/** HTTP status of a failed AI request, or 0 when it never reached a response. */
export function failureStatus(error: unknown): number {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null;
  return typeof status === 'number' ? status : 0;
}

/** Model-not-found and quota failures are only actionable with this text, so it
 * is kept, bounded, stripped of control characters and scrubbed of the key. */
function extractDetail(body: string | undefined, apiKey: string): string {
  if (!body?.trim()) return '';
  let message = '';
  try {
    const parsed: unknown = JSON.parse(body);
    const record = isRecord(parsed) ? parsed : null;
    const error = isRecord(record?.error) ? record.error : null;
    for (const candidate of [error?.message, record?.message, record?.msg, record?.detail, record?.error]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        message = candidate;
        break;
      }
    }
  } catch {
    message = body;
  }
  message = redact(message || body, apiKey).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function httpError(status: number, body?: string, apiKey = ''): Error {
  const messages: Record<number, string> = {
    400: 'AI 服务拒绝了请求参数，请检查模型名称和服务配置。',
    401: 'API Key 无效或已过期，请检查凭据。',
    403: '当前 API Key 没有调用该模型的权限。',
    404: '未找到 AI 接口或模型，请检查服务地址和模型名称。Base URL 通常需要包含版本前缀，例如 https://api.example.com/v1。',
    429: 'AI 服务请求过于频繁或已达到限额，请稍后重试并检查配额。',
  };
  const hint = messages[status] ?? (status >= 300 && status < 400
    ? 'AI 服务要求重定向，请直接填写最终的服务地址。'
    : status >= 500 ? 'AI 服务暂时不可用，请稍后重试。' : 'AI 请求失败，请检查服务配置。');
  return withProviderDetail(Object.assign(new Error(`${hint}（HTTP ${status}）`), { status }), body, apiKey);
}
