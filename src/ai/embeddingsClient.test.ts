import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestEmbeddings } from './embeddingsClient';
import type { AiProviderProfile } from '../library/libraryModels';
import type { AiHttpRequest } from './aiTransport';

const provider: AiProviderProfile = { id: 'ali', name: '阿里云', baseUrl: 'https://example.test/compatible-mode/v1/chat/completions', model: 'qwen-chat', embeddingModel: 'text-embedding-v4', savedKey: null };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('OpenAI-compatible embedding contract', () => {
  it('supports a separately configured full embeddings URL without appending another embeddings segment', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200, body: '{"data":[{"index":0,"embedding":[1,0]}]}' }));
    await requestEmbeddings({ ...provider, embeddingBaseUrl: 'https://vectors.example.test/v1/embeddings' }, 'test-key', ['A'], { transport });
    expect(transport.mock.calls[0][0].url).toBe('https://vectors.example.test/v1/embeddings');
  });
  it('uses the separate model and embeddings endpoint with the same provider key and restores response order', async () => {
    const transport = vi.fn(async () => ({ status: 200, body: JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }) }));
    const vectors = await requestEmbeddings(provider, 'test-key', ['A', 'B'], { transport });
    expect(vectors).toEqual([[1, 0], [0, 1]]);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/compatible-mode/v1/embeddings', apiKey: 'test-key', body: { model: 'text-embedding-v4', input: ['A', 'B'], encoding_format: 'float' } }), expect.any(AbortSignal));
  });

  it.each([
    { data: [{ index: 0, embedding: [1, 0] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1, 0, 1] }] },
    { data: [{ index: 0, embedding: [0, 0] }, { index: 1, embedding: [0, 1] }] },
  ])('rejects missing, duplicated, mismatched or zero vectors', async ({ data }) => {
    await expect(requestEmbeddings(provider, 'test-key', ['A', 'B'], { transport: async () => ({ status: 200, body: JSON.stringify({ data }) }) })).rejects.toThrow(/向量|索引/);
  });

  it('does not use the chat model when no embedding model has been configured', async () => {
    const transport = vi.fn();
    await expect(requestEmbeddings({ ...provider, embeddingModel: '' }, 'test-key', ['A'], { transport })).rejects.toThrow('embedding');
    expect(transport).not.toHaveBeenCalled();
  });

  it('cancels a delayed embedding even when transport ignores the signal', async () => {
    const controller = new AbortController();
    const work = requestEmbeddings(provider, 'test-key', ['A'], { signal: controller.signal, transport: () => new Promise(() => undefined) });
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
  });
});
