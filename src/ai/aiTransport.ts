import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Invoke } from '../persistence/persistenceApi';

export type AiHttpRequest = {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  requestId: string;
};

export type AiHttpResponse = { status: number; body: string };

export type AiTransport = (
  request: AiHttpRequest,
  signal?: AbortSignal,
) => Promise<AiHttpResponse>;

export function createAiTransport(invoke: Invoke = tauriInvoke): AiTransport {
  return (request, signal) => new Promise<AiHttpResponse>((resolve, reject) => {
    if (signal?.aborted) {
      reject(normalizeAiTransportError('AI_HTTP_CANCELLED'));
      return;
    }
    const requestId = request.requestId;
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(normalizeAiTransportError('AI_HTTP_CANCELLED'));
      // UI cancellation cannot wait for IPC cleanup. The native request has its
      // own timeout, and late responses or cancellation failures stay detached.
      try {
        void invoke<void>('cancel_ai_request', { requestId }).catch(() => undefined);
      } catch {
        // A closed webview can reject IPC synchronously after cancellation.
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      void invoke<AiHttpResponse>('ai_http_request', { request }).then(
        (response) => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(response);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(normalizeAiTransportError(error));
          }
        },
      );
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(normalizeAiTransportError(error));
      }
    }
  });
}

/** Native and third-party errors may contain credentials; expose only known codes. */
export function normalizeAiTransportError(error: unknown): Error {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null;
  const raw = typeof error === 'string' ? error : typeof record?.message === 'string' ? record.message : '';
  const code = typeof record?.code === 'string' ? record.code : raw.match(/^AI_HTTP_[A-Z_]+\b/)?.[0];
  if (code === 'AI_HTTP_CANCELLED' || record?.name === 'AbortError') {
    return Object.assign(new Error('AI 请求已取消。'), { name: 'AbortError', code: 'AI_HTTP_CANCELLED' });
  }
  if (code === 'AI_HTTP_TIMEOUT' || record?.name === 'TimeoutError') {
    return Object.assign(new Error('AI 请求超时，请稍后重试或调整服务配置。'), { name: 'TimeoutError', code: 'AI_HTTP_TIMEOUT' });
  }
  if (code === 'AI_HTTP_INVALID_REQUEST') {
    return Object.assign(new Error('AI 请求配置无效，请检查服务地址、模型和请求大小。'), { code });
  }
  if (code === 'AI_HTTP_RESPONSE_TOO_LARGE') {
    return Object.assign(new Error('AI 服务返回的内容过大，请缩小请求范围。'), { code });
  }
  return Object.assign(new Error('AI 请求未完成，请检查网络连接和服务配置。'), { code: 'AI_HTTP_NETWORK' });
}
