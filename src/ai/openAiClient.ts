import type { AiProviderProfile } from '../library/libraryModels';
import {
  createAiTransport,
  normalizeAiTransportError,
  type AiHttpResponse,
  type AiTransport,
} from './aiTransport';

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export function normalizeBaseUrl(value: string): string {
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
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}

export async function requestCompletion(
  provider: AiProviderProfile,
  key: string,
  messages: AiMessage[],
  options: { signal?: AbortSignal; transport?: AiTransport; timeoutMs?: number } = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw normalizeAiTransportError('AI_HTTP_CANCELLED');
  }
  const apiKey = key.trim();
  if (!apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new Error('请填写有效的 API Key。');
  }
  const model = provider.model.trim();
  if (!model) {
    throw new Error('请填写 AI 模型名称。');
  }
  const url = normalizeBaseUrl(provider.baseUrl);
  if (!messages.length || messages.some((message) =>
    !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
    throw new Error('AI 请求必须包含有效的文本消息。');
  }
  // Alibaba's hybrid-thinking Qwen3.8-27B defaults to thinking mode. This
  // synchronous reader requests its supported non-thinking text response.
  const aliyunQwen = /(?:^|\.)(?:maas|dashscope)\.aliyuncs\.com$/i.test(new URL(url).hostname)
    && /^qwen3\.8-27b(?:-|$)/i.test(model);
  const parsed = await requestAiJson(url, apiKey, { model, messages: messages.map(({ role, content }) => ({ role, content })), stream: false,
    ...(aliyunQwen ? { enable_thinking: false } : {}) }, options);
  const choices = isRecord(parsed) && Array.isArray(parsed.choices) ? parsed.choices : [];
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : null;
  if (typeof message?.content !== 'string' || !message.content.trim()) {
    throw new Error('AI 服务未返回可用文本，请确认模型支持 Chat Completions 文本输出。');
  }
  return message.content.split(apiKey).join('[已隐藏 API Key]');
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
    throw httpError(response.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error('AI 服务返回的内容不是有效的 JSON 响应。');
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpError(status: number): Error {
  const messages: Record<number, string> = {
    400: 'AI 服务拒绝了请求参数，请检查模型名称和服务配置。',
    401: 'API Key 无效或已过期，请检查凭据。',
    403: '当前 API Key 没有调用该模型的权限。',
    404: '未找到 AI 接口或模型，请检查服务地址和模型名称。',
    429: 'AI 服务请求过于频繁或已达到限额，请稍后重试并检查配额。',
  };
  return new Error(`${messages[status] ?? (status >= 500 ? 'AI 服务暂时不可用，请稍后重试。' : 'AI 请求失败，请检查服务配置。')}（HTTP ${status}）`);
}
