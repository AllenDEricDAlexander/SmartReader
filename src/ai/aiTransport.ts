import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core';
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

/** Native streaming events. `status` always arrives before any `chunk`. */
export type AiStreamEvent =
  | { kind: 'status'; status: number }
  | { kind: 'chunk'; data: string }
  | { kind: 'end' };

export type AiStreamTransport = (
  request: AiHttpRequest,
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
) => Promise<void>;

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

/**
 * Streams a chat response through the native transport. Server-sent-event
 * framing is parsed by the caller, so this stays a byte forwarder for any
 * OpenAI-compatible provider. Events stop being delivered as soon as the signal
 * aborts, so a cancelled answer can never append to a later one.
 */
export function createAiStreamTransport(
  invoke: Invoke = tauriInvoke,
  createChannel: <T>(onmessage: (event: T) => void) => Channel<T> = (onmessage) => new Channel(onmessage),
): AiStreamTransport {
  return (request, onEvent, signal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(normalizeAiTransportError('AI_HTTP_CANCELLED'));
      return;
    }
    const requestId = request.requestId;
    let settled = false;
    let commandFinished = false;
    let streamEnded = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const cancel = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(normalizeAiTransportError(error));
      // UI cancellation cannot wait for IPC cleanup. The native request has its
      // own timeout, and late events or cancellation failures stay detached.
      try {
        void invoke<void>('cancel_ai_request', { requestId }).catch(() => undefined);
      } catch {
        // A closed webview can reject IPC synchronously after cancellation.
      }
    };
    const onAbort = () => cancel('AI_HTTP_CANCELLED');
    const timer = setTimeout(() => cancel('AI_HTTP_TIMEOUT'), request.timeoutMs);
    const finish = () => {
      if (settled || !commandFinished || !streamEnded) return;
      settled = true;
      cleanup();
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const channel = createChannel<AiStreamEvent>((event) => {
        if (settled) return;
        try {
          onEvent(event);
          if (event.kind === 'end') {
            streamEnded = true;
            finish();
          }
        } catch (error) {
          cancel(error);
        }
      });
      void invoke<void>('ai_http_stream', { request, onEvent: channel }).then(
        () => {
          // Large Tauri channel messages are fetched asynchronously. The
          // command can finish before its last chunk reaches the webview.
          commandFinished = true;
          finish();
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
  if (code === 'AI_HTTP_REQUEST_TOO_LARGE') {
    return Object.assign(new Error('AI 请求内容过大，请缩小文献范围或对话历史。'), { code });
  }
  if (code === 'AI_HTTP_INVALID_RESPONSE') {
    return Object.assign(new Error('AI 服务返回的内容不是有效的 UTF-8 文本。'), { code });
  }
  if (code === 'AI_HTTP_BUSY' || code === 'AI_HTTP_DUPLICATE_REQUEST') {
    return Object.assign(new Error('同时进行的 AI 请求过多，请稍后重试。'), { code });
  }
  return Object.assign(new Error('AI 请求未完成，请检查网络连接和服务配置。'), { code: 'AI_HTTP_NETWORK' });
}
