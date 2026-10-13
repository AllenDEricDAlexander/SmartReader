import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeVectorSearch } from './knowledgeVectors';
import type { AiHttpRequest } from './aiTransport';

const entries = [{ id: 'paper_a:1', vector: [1, 0] }, { id: 'paper_b:1', vector: [0, 1] }];
const options = { backend: 'milvus' as const, milvusUrl: 'https://milvus.test/', milvusKey: 'test-milvus-token', assertAccess: vi.fn() };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('local and cloud vector adapters', () => {
  it('uses the native in-memory vector command with only the caller-selected entries', async () => {
    const invoke = vi.fn().mockResolvedValue([{ id: entries[0].id, score: 1 }]);
    const search = createKnowledgeVectorSearch(invoke);
    expect(await search([entries[0]], [1, 0], { ...options, backend: 'local' })).toEqual([{ id: entries[0].id, score: 1 }]);
    expect(invoke).toHaveBeenCalledWith('search_knowledge_vectors', { entries: [entries[0]], query: [1, 0], limit: 20 });
  });

  it('creates an isolated Milvus collection, uploads vectors without source text, searches, then cleans up', async () => {
    const transport = vi.fn(async (request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0,
      data: request.url.endsWith('/entities/search') ? [{ id: entries[0].id, distance: 0.98 }] : {} }) }));
    const search = createKnowledgeVectorSearch(vi.fn(), transport);
    expect(await search(entries, [1, 0], options)).toEqual([{ id: entries[0].id, score: 0.98 }]);
    expect(transport.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      '/v2/vectordb/collections/create', '/v2/vectordb/entities/insert', '/v2/vectordb/entities/search', '/v2/vectordb/collections/drop',
    ]);
    const requests = transport.mock.calls.map(([request]) => request);
    const collection = requests[0].body.collectionName;
    expect(collection).toMatch(/^smartreader_[a-f0-9]{32}$/);
    expect(requests.every((request) => request.body.collectionName === collection && request.apiKey === 'test-milvus-token')).toBe(true);
    expect(requests[1].body.data).toEqual(entries);
    expect(JSON.stringify(requests[1].body)).not.toContain('text');
    expect(requests[2].body.consistencyLevel).toBe('Strong');
  });

  it('rejects another document returned by the vector server instead of expanding the scope', async () => {
    const search = createKnowledgeVectorSearch(vi.fn().mockResolvedValue([{ id: 'unselected:0', score: 0.99 }]));
    await expect(search(entries, [1, 0], { ...options, backend: 'local' })).rejects.toThrow('范围以外');
  });

  it('cleans up a failed cloud query and does not expose raw server messages or tokens', async () => {
    const transport = vi.fn(async (request: AiHttpRequest) => ({ status: 200, body: JSON.stringify(
      request.url.endsWith('/entities/search') ? { code: 1100, message: 'SECRET-MILVUS-TOKEN' } : { code: 0, data: {} }) }));
    await expect(createKnowledgeVectorSearch(vi.fn(), transport)(entries, [1, 0], options)).rejects.toThrow('Milvus 操作未完成');
    expect(transport.mock.calls.at(-1)![0].url).toMatch(/collections\/drop$/);
  });

  it('cancels cloud work but sends cleanup with a fresh, non-aborted signal', async () => {
    const controller = new AbortController();
    const transport = vi.fn((request: AiHttpRequest) => request.url.endsWith('/collections/drop')
      ? Promise.resolve({ status: 200, body: '{"code":0,"data":{}}' }) : new Promise<{ status: number; body: string }>(() => undefined));
    const work = createKnowledgeVectorSearch(vi.fn(), transport)(entries, [1, 0], { ...options, signal: controller.signal });
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(transport.mock.calls.at(-1)![0].url).toMatch(/collections\/drop$/);
  });
});
