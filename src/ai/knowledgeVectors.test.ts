import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeVectorStore, normalizeMilvusUrl } from './knowledgeVectors';
import type { AiHttpRequest } from './aiTransport';

const paperA = 'a'.repeat(64);
const paperB = 'b'.repeat(64);
const entries = [{ id: `${paperA}:0`, vector: [1, 0] }, { id: `${paperA}:1`, vector: [0, 1] }];
const fingerprint = 'f'.repeat(64);
const options = { backend: 'milvus' as const, milvusUrl: 'https://milvus.test/', milvusKey: 'test-milvus-token', assertAccess: vi.fn() };
const scope = (overrides: Partial<Parameters<ReturnType<typeof createKnowledgeVectorStore>['search']>[0]> = {}) => ({
  query: [1, 0], limit: 20, modelKey: 'c'.repeat(64), paperIds: [paperA, paperB],
  fingerprints: { [paperA]: fingerprint, [paperB]: 'e'.repeat(64) }, entries: [], ...overrides,
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('local and cloud vector adapters', () => {
  it('ranks a local scope inside SQLite, sending only the query vector', async () => {
    const invoke = vi.fn().mockResolvedValue([{ id: `${paperA}:1`, score: 1 }]);
    const store = createKnowledgeVectorStore(invoke);
    const request = scope({ paperIds: [paperA] });
    expect(await store.search(request, { ...options, backend: 'local' })).toEqual([{ id: `${paperA}:1`, score: 1 }]);
    expect(invoke).toHaveBeenCalledWith('search_knowledge_scope', { scope: request });
    expect(JSON.stringify(invoke.mock.calls[0][1])).not.toContain('"vector"');
  });

  it('passes session-only vectors alongside a durable scope', async () => {
    const invoke = vi.fn().mockResolvedValue([{ id: 'session:3', score: 0.8 }]);
    const store = createKnowledgeVectorStore(invoke);
    const request = scope({ paperIds: [], entries: [{ id: 'session:3', vector: [0, 1] }] });
    expect(await store.search(request, { ...options, backend: 'local' })).toEqual([{ id: 'session:3', score: 0.8 }]);
  });

  it('rejects another document returned by the vector server instead of expanding the scope', async () => {
    const store = createKnowledgeVectorStore(vi.fn().mockResolvedValue([{ id: `${'9'.repeat(64)}:0`, score: 0.99 }]));
    await expect(store.search(scope({ paperIds: [paperA] }), { ...options, backend: 'local' })).rejects.toThrow('范围以外');
  });

  it('creates the persistent cloud collection once and replaces only that paper rows', async () => {
    const created: string[] = [];
    const transport = vi.fn(async (request: AiHttpRequest) => {
      const path = new URL(request.url).pathname;
      created.push(path);
      // An absent collection answers describe with a non-zero code.
      const describeMissing = path.endsWith('/collections/describe') && !created.includes('/v2/vectordb/collections/create');
      return { status: 200, body: JSON.stringify(describeMissing ? { code: 100, message: 'collection not found' } : { code: 0, data: {} }) };
    });
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    await store.publish(paperA, fingerprint, entries, options);
    expect(created).toEqual([
      '/v2/vectordb/collections/describe', '/v2/vectordb/collections/create', '/v2/vectordb/collections/load',
      '/v2/vectordb/entities/delete', '/v2/vectordb/entities/insert',
    ]);
    const requests = transport.mock.calls.map(([request]) => request);
    expect(requests.every((request) => request.body.collectionName === 'smartreader_knowledge_2' && request.apiKey === 'test-milvus-token')).toBe(true);
    expect(requests[3].body.filter).toBe(`paper_id == "${paperA}"`);
    expect(requests[4].body.data).toEqual(entries.map((entry) => ({ ...entry, paper_id: paperA, paper_fp: fingerprint })));
    expect(JSON.stringify(requests[4].body)).not.toContain('text');
  });

  it('reuses an existing cloud collection instead of recreating or dropping it', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0, data: {} }) }));
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    await store.publish(paperA, fingerprint, entries, options);
    const paths = transport.mock.calls.map(([request]) => new URL(request.url).pathname);
    expect(paths).toEqual([
      '/v2/vectordb/collections/describe', '/v2/vectordb/collections/load',
      '/v2/vectordb/entities/delete', '/v2/vectordb/entities/insert',
    ]);
    expect(paths).not.toContain('/v2/vectordb/collections/drop');
  });

  it('recovers when another publisher creates the collection after the initial describe', async () => {
    let describes = 0;
    const transport = vi.fn(async (request: AiHttpRequest) => {
      const path = new URL(request.url).pathname;
      const code = path.endsWith('/collections/describe') ? (++describes === 1 ? 100 : 0)
        : path.endsWith('/collections/create') ? 1100 : 0;
      return { status: 200, body: JSON.stringify({ code, data: {} }) };
    });
    await createKnowledgeVectorStore(vi.fn(), transport).publish(paperA, fingerprint, entries, options);
    expect(transport.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      '/v2/vectordb/collections/describe', '/v2/vectordb/collections/create', '/v2/vectordb/collections/describe',
      '/v2/vectordb/collections/load', '/v2/vectordb/entities/delete', '/v2/vectordb/entities/insert',
    ]);
  });

  it('preserves a failed create when the collection still does not exist', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200,
      body: JSON.stringify({ code: 1100, message: 'not permitted' }) }));
    await expect(createKnowledgeVectorStore(vi.fn(), transport).publish(paperA, fingerprint, entries, options)).rejects.toThrow('Milvus 操作未完成');
    expect(transport.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      '/v2/vectordb/collections/describe', '/v2/vectordb/collections/create', '/v2/vectordb/collections/describe',
    ]);
  });

  it('reads back the published fingerprint so a restart does not re-upload', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0, data: [{ 'count(*)': '2' }] }) }));
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    expect(await store.fingerprint(paperA, 2, fingerprint, 2, options)).toBe(fingerprint);
    const [request] = transport.mock.calls[0];
    expect(new URL(request.url).pathname).toBe('/v2/vectordb/entities/query');
    expect(request.body).toMatchObject({ collectionName: 'smartreader_knowledge_2',
      filter: `paper_id == "${paperA}" and paper_fp == "${fingerprint}"`,
      outputFields: ['count(*)'], consistencyLevel: 'Strong', limit: 0 });
  });

  it('replaces an interrupted multi-batch upload before accepting its fingerprint', async () => {
    let rows: Array<{ id: string; paper_fp: string }> = [];
    let inserts = 0;
    const transport = vi.fn(async (request: AiHttpRequest) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/entities/delete')) rows = [];
      if (path.endsWith('/entities/insert')) {
        if (++inserts === 2) return { status: 503, body: '{}' };
        rows.push(...request.body.data as typeof rows);
      }
      const data = path.endsWith('/entities/query')
        ? [{ 'count(*)': rows.filter((row) => request.body.filter === `paper_id == "${paperA}" and paper_fp == "${row.paper_fp}"`).length }]
        : {};
      return { status: 200, body: JSON.stringify({ code: 0, data }) };
    });
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    const chunks = Array.from({ length: 501 }, (_, index) => ({ id: `${paperA}:${index}`, vector: [1, 0] }));
    await expect(store.publish(paperA, fingerprint, chunks, options)).rejects.toThrow();
    expect(rows).toHaveLength(500);
    expect(await store.fingerprint(paperA, 2, fingerprint, 501, options)).toBeNull();
    await store.publish(paperA, fingerprint, chunks, options);
    expect(rows).toHaveLength(501);
    expect(await store.fingerprint(paperA, 2, fingerprint, 501, options)).toBe(fingerprint);
    expect(await store.fingerprint(paperA, 2, 'd'.repeat(64), 501, options)).toBeNull();
  });

  it('searches the cloud collection scoped to the selected papers only', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0, data: [{ id: `${paperA}:1`, paper_fp: fingerprint, distance: 0.98 }] }) }));
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    expect(await store.search(scope(), options)).toEqual([{ id: `${paperA}:1`, score: 0.98 }]);
    const [request] = transport.mock.calls[0];
    expect(new URL(request.url).pathname).toBe('/v2/vectordb/entities/search');
    expect(request.body.filter).toBe(`(paper_id == "${paperA}" and paper_fp == "${fingerprint}") or (paper_id == "${paperB}" and paper_fp == "${'e'.repeat(64)}")`);
    expect(request.body.consistencyLevel).toBe('Strong');
    expect(request.body.outputFields).toEqual(['id', 'paper_fp']);
  });

  it('rejects a hit from another content or embedding fingerprint even with the same paper and dimension', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0,
      data: [{ id: `${paperA}:1`, paper_fp: 'd'.repeat(64), distance: 0.98 }] }) }));
    await expect(createKnowledgeVectorStore(vi.fn(), transport).search(scope(), options)).rejects.toThrow('索引已变化');
  });

  it('removes a paper from all managed dimensions after a restart without touching other collections', async () => {
    const transport = vi.fn(async (request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0,
      data: request.url.endsWith('/collections/list') ? ['smartreader_knowledge_2', 'smartreader_knowledge_1024',
        'other_project', 'smartreader_knowledge_0', 'smartreader_knowledge_5000', 'smartreader_knowledge_2_backup'] : {} }) }));
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    await store.forget([paperA], options);
    expect(new URL(transport.mock.calls[0][0].url).pathname).toBe('/v2/vectordb/collections/list');
    const removals = transport.mock.calls.slice(1).map(([request]) => request);
    expect(removals.map((request) => request.body.collectionName)).toEqual(['smartreader_knowledge_2', 'smartreader_knowledge_1024']);
    expect(removals.every((request) => new URL(request.url).pathname === '/v2/vectordb/entities/delete'
      && request.body.filter === `paper_id in ["${paperA}"]`)).toBe(true);
  });

  it('reports cloud cleanup failure instead of treating a denied deletion as success', async () => {
    const transport = vi.fn(async (request: AiHttpRequest) => ({ status: 200, body: JSON.stringify(
      request.url.endsWith('/collections/list') ? { code: 0, data: ['smartreader_knowledge_2'] }
        : { code: 1100, message: 'not permitted' }) }));
    await expect(createKnowledgeVectorStore(vi.fn(), transport).forget([paperA], options)).rejects.toThrow('Milvus 操作未完成');
  });

  it('does not expose raw server messages or tokens from a failed cloud query', async () => {
    const transport = vi.fn(async (request: AiHttpRequest) => ({ status: 200, body: JSON.stringify(
      request.url.endsWith('/entities/search') ? { code: 1100, message: 'SECRET-MILVUS-TOKEN' } : { code: 0, data: {} }) }));
    await expect(createKnowledgeVectorStore(vi.fn(), transport).search(scope(), options)).rejects.toThrow('Milvus 操作未完成');
  });

  it('propagates cancellation of cloud work without touching another collection', async () => {
    const controller = new AbortController();
    const transport = vi.fn((_request: AiHttpRequest) => new Promise<{ status: number; body: string }>(() => undefined));
    const work = createKnowledgeVectorStore(vi.fn(), transport).search(scope(), { ...options, signal: controller.signal });
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(transport.mock.calls.every(([request]) => !request.url.endsWith('/collections/drop'))).toBe(true);
  });

  it('refuses identifiers that could change a cloud filter expression', async () => {
    const transport = vi.fn(async (_request: AiHttpRequest) => ({ status: 200, body: JSON.stringify({ code: 0, data: [] }) }));
    const store = createKnowledgeVectorStore(vi.fn(), transport);
    await expect(store.search(scope({ paperIds: ['" or paper_id != "'] }), options)).rejects.toThrow('文献标识无效');
    await expect(store.publish('../etc', fingerprint, entries, options)).rejects.toThrow('文献标识无效');
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps a Milvus address usable without guessing a chat version prefix', () => {
    expect(normalizeMilvusUrl('https://in03-x.serverless.gcp.cloud.zilliz.com')).toBe('https://in03-x.serverless.gcp.cloud.zilliz.com');
    expect(normalizeMilvusUrl('https://milvus.test/v2/vectordb/')).toBe('https://milvus.test');
    expect(normalizeMilvusUrl('https://milvus.test:19530/')).toBe('https://milvus.test:19530');
  });
});
