import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, type AiProviderProfile, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import { AiService } from './aiService';
import { KnowledgeService, chunkPaper } from './knowledgeService';
import type { KnowledgeCache, KnowledgeCacheStatus, KnowledgeStorage } from './knowledgeStorage';
import type { KnowledgeVectorStore } from './knowledgeVectors';

const provider: AiProviderProfile = { id: 'ali', name: '阿里云', baseUrl: 'https://example.test/v1/chat/completions', model: 'qwen-chat', embeddingModel: 'text-embedding-v4', savedKey: null };

const defaultPages = [
  { page: 1, text: 'Background on experimental design.' },
  { page: 10, text: 'Hippocampal consolidation strengthens delayed recall during sleep.' },
];

async function setup(pages = defaultPages) {
  let snapshot: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const library = new LibraryService({
    load: async () => ({ revision, data: structuredClone(snapshot) }),
    commit: async (_version, next, blobs) => { snapshot = structuredClone(next); for (const blob of blobs) blob.bytes ? files.set(blob.id, blob.bytes.slice()) : files.delete(blob.id); return ++revision; },
    readFile: async (id) => files.get(id)!.slice(),
  }, async () => ({ metadata: emptyMetadata('Memory study'), pages, pageCount: Math.max(10, pages.length) }));
  const paper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nknowledge'), 'knowledge.pdf');
  const persisted = new Map<string, KnowledgeCache>();
  const identity = (key: KnowledgeCache['key']) => [key.paperId, key.modelKey, key.contentKey].join(':');
  const storage: KnowledgeStorage = {
    // The durable cache answers with fingerprints, never with vectors, which is
    // what keeps a question from serializing the whole knowledge base.
    status: vi.fn(async (paperIds: string[]) => [...persisted.values()]
      .filter((cache) => paperIds.includes(cache.key.paperId))
      .map((cache): KnowledgeCacheStatus => ({ ...cache.key, dimension: cache.vectors[0].length, chunkCount: cache.vectors.length }))),
    read: vi.fn(async (key) => structuredClone(persisted.get(identity(key)) ?? null)),
    save: vi.fn(async (cache) => { persisted.set(identity(cache.key), structuredClone(cache)); }),
  };
  const embeddings = vi.fn(async (_provider: AiProviderProfile, _key: string, texts: string[]) => texts.map((text) => /Hippocampal|retain|overnight/.test(text) ? [1, 0] : [0, 1]));
  const published = new Map<string, string>();
  const store: KnowledgeVectorStore = {
    fingerprint: vi.fn(async (paperId: string, _dimension: number, expected: string) => published.get(paperId) === expected ? expected : null),
    publish: vi.fn(async (paperId: string, fingerprint: string) => { published.set(paperId, fingerprint); }),
    forget: vi.fn(async (paperIds: string[]) => { for (const id of paperIds) published.delete(id); }),
    search: vi.fn(async () => [{ id: `${paper.id}:1`, score: 0.99 }]),
  };
  const controller = new AbortController();
  const access = library.captureAccess();
  const assertAccess = () => { if (!library.canAccess(paper.id, access)) throw new Error('locked'); };
  return { library, paper, persisted, published, storage, embeddings, store, controller, assertAccess };
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('SQLite-backed semantic knowledge', () => {
  it('retrieves a late page by vectors for a question without matching keywords and feeds that source into chat', async () => {
    const app = await setup();
    const completion = vi.fn().mockResolvedValue('Sleep supports retention [S1]');
    const ai = new AiService(app.library, completion, { storage: app.storage, embeddings: app.embeddings, store: app.store });
    await ai.saveProvider(provider, 'test-key');
    expect(app.library.search('What helps us retain learned material overnight?')).toEqual([]);
    const result = await ai.ask('What helps us retain learned material overnight?', { paperIds: [app.paper.id] });
    expect(result.retrieval).toBe('local-vector');
    expect(result.sources[0]).toMatchObject({ paperId: app.paper.id, page: 10, excerpt: expect.stringContaining('Hippocampal') });
    expect(JSON.parse(completion.mock.calls[0][2][1].content).sources).toEqual(result.sources);
    // Only the query vector and the paper scope reach the search; the indexed
    // vectors of a public paper stay inside the durable store.
    expect(app.store.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: [1, 0], paperIds: [app.paper.id], entries: [] }),
      expect.objectContaining({ backend: 'local' }),
    );
    ai.dispose();
  });

  it('answers without any knowledge base instead of refusing a configured provider', async () => {
    const app = await setup();
    await app.library.deletePapers([app.paper.id]);
    const completion = vi.fn().mockResolvedValue('大语言模型可以直接回答常识问题。');
    const ai = new AiService(app.library, completion, { storage: app.storage, embeddings: app.embeddings, store: app.store });
    await ai.saveProvider(provider, 'test-key');
    const result = await ai.ask('先聊点别的，什么是工作记忆？');
    expect(result.retrieval).toBe('none');
    expect(result.sources).toEqual([]);
    expect(completion.mock.calls[0][2][0].content).toContain('没有检索到本地文献');
    expect(app.embeddings).not.toHaveBeenCalled();
    await expect(ai.ask('必须有文献', { grounding: 'library' })).rejects.toThrow('请先导入或解锁可用文献');
    ai.dispose();
  });

  it('carries earlier turns into a follow-up and streams the answer as it arrives', async () => {
    const app = await setup();
    const completion = vi.fn().mockResolvedValue('unused');
    const streaming = vi.fn(async (_provider, _key, _messages, options: { onDelta?(text: string): void }) => {
      options.onDelta?.('睡眠');
      options.onDelta?.('有助于巩固。[S1]');
      return '睡眠有助于巩固。[S1]';
    });
    const ai = new AiService(app.library, completion, { storage: app.storage, embeddings: app.embeddings, store: app.store }, streaming as never);
    await ai.saveProvider(provider, 'test-key');
    const deltas: string[] = [];
    const result = await ai.ask('那第二点呢？', {
      paperIds: [app.paper.id],
      history: [{ role: 'user', content: '第一点是什么？' }, { role: 'assistant', content: '第一点是巩固。' }],
      onDelta: (text) => deltas.push(text),
    });
    expect(deltas).toEqual(['睡眠', '有助于巩固。[S1]']);
    expect(result.text).toBe('睡眠有助于巩固。[S1]');
    expect(completion).not.toHaveBeenCalled();
    const messages = streaming.mock.calls[0][2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1].content).toBe('第一点是什么？');
    ai.dispose();
  });

  it('restores public vectors from persistent storage without re-embedding, but invalidates changed content and model', async () => {
    const app = await setup();
    let knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings).toHaveBeenCalledOnce();
    knowledge.dispose();
    knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings).toHaveBeenCalledOnce();
    // A cached paper costs one fingerprint read and never reads the vectors.
    expect(app.storage.read).not.toHaveBeenCalled();
    await app.library.editMetadata(app.paper.id, { title: 'Updated interpretation' });
    await knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings).toHaveBeenCalledTimes(2);
    await knowledge.index(app.library.getPaper(app.paper.id)!, { ...provider, embeddingModel: 'new-embedding' }, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings).toHaveBeenCalledTimes(3);
    knowledge.dispose();
  });

  it('publishes each paper to the cloud collection once and keeps it across sessions', async () => {
    const app = await setup();
    await app.library.saveAiSettings({ providers: [provider], activeProviderId: provider.id, autoEnrich: false, knowledge: { backend: 'milvus', milvusUrl: 'https://milvus.test' } });
    const search = { backend: 'milvus' as const, milvusUrl: 'https://milvus.test', milvusKey: 'cloud-token', assertAccess: app.assertAccess };
    let knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess, {}, search);
    expect(app.store.publish).toHaveBeenCalledOnce();
    knowledge.dispose();
    // A later session finds the fingerprint already in the collection, so the
    // first question after a restart costs one search instead of a re-upload.
    knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess, {}, search);
    expect(app.store.publish).toHaveBeenCalledOnce();
    expect(app.embeddings).toHaveBeenCalledOnce();
    knowledge.dispose();
  });

  it('re-publishes a paper to the cloud after its content changes', async () => {
    const app = await setup();
    await app.library.saveAiSettings({ providers: [provider], activeProviderId: provider.id, autoEnrich: false, knowledge: { backend: 'milvus', milvusUrl: 'https://milvus.test' } });
    const search = { backend: 'milvus' as const, milvusUrl: 'https://milvus.test', milvusKey: 'cloud-token', assertAccess: app.assertAccess };
    const knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess, {}, search);
    await app.library.editMetadata(app.paper.id, { title: 'Revised title' });
    await knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal, app.assertAccess, {}, search);
    expect(app.store.publish).toHaveBeenCalledTimes(2);
    const [first, second] = (app.store.publish as ReturnType<typeof vi.fn>).mock.calls;
    expect(first[1]).not.toBe(second[1]);
    knowledge.dispose();
  });

  it('passes full chunk counts and the current model fingerprint into cloud retrieval', async () => {
    const app = await setup();
    await app.library.saveAiSettings({ providers: [provider], activeProviderId: provider.id, autoEnrich: false,
      knowledge: { backend: 'milvus', milvusUrl: 'https://milvus.test' } });
    const knowledge = new KnowledgeService(app.library, app);
    await knowledge.retrieve('overnight', [app.paper], provider, 'test-key', app.controller.signal, app.assertAccess, 'cloud-token');
    await knowledge.retrieve('overnight', [app.paper], { ...provider, embeddingModel: 'other-two-dimensional-model' },
      'test-key', app.controller.signal, app.assertAccess, 'cloud-token');
    const fingerprintCalls = vi.mocked(app.store.fingerprint).mock.calls;
    const searches = vi.mocked(app.store.search).mock.calls;
    expect(fingerprintCalls.map((call) => call.slice(0, 2))).toEqual([[app.paper.id, 2], [app.paper.id, 2]]);
    expect(fingerprintCalls.map((call) => call[3])).toEqual([2, 2]);
    expect(fingerprintCalls[0][2]).not.toBe(fingerprintCalls[1][2]);
    expect(searches.map(([scope]) => scope.fingerprints?.[app.paper.id])).toEqual(fingerprintCalls.map((call) => call[2]));
    knowledge.dispose();
  });

  it('cleans cloud vectors after a restart or settings reset without an in-memory dimension', async () => {
    const app = await setup();
    app.published.set(app.paper.id, 'f'.repeat(64));
    const search = { backend: 'milvus' as const, milvusUrl: 'https://milvus.test', milvusKey: 'cloud-token', assertAccess: app.assertAccess };
    const knowledge = new KnowledgeService(app.library, app);
    knowledge.clear();
    await knowledge.forget([app.paper.id], search);
    expect(app.store.forget).toHaveBeenCalledWith([app.paper.id], search);
    expect(app.published.has(app.paper.id)).toBe(false);
    knowledge.dispose();
  });

  it('retries when content changes while reading an otherwise matching durable cache', async () => {
    const app = await setup();
    const knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess);
    const statuses = await app.storage.status([app.paper.id]);
    vi.mocked(app.storage.status).mockImplementationOnce(async () => {
      await app.library.editMetadata(app.paper.id, { title: 'Changed during cache lookup' });
      return statuses;
    });
    const sources = await knowledge.retrieve('overnight', [app.paper], provider, 'test-key', app.controller.signal, app.assertAccess);
    expect(sources[0].title).toBe('Changed during cache lookup');
    expect(app.embeddings).toHaveBeenCalledTimes(3);
    knowledge.dispose();
  });

  it('lets a cloud publication finish before encryption can commit and clear its vectors', async () => {
    const app = await setup();
    const folder = await app.library.createFolder('Private');
    await app.library.categorize([app.paper.id], [folder.id], 'add');
    let finishPublish: () => void = () => undefined;
    vi.mocked(app.store.publish).mockImplementationOnce(() => new Promise<void>((resolve) => { finishPublish = resolve; }));
    const search = { backend: 'milvus' as const, milvusUrl: 'https://milvus.test', milvusKey: 'cloud-token', assertAccess: app.assertAccess };
    const knowledge = new KnowledgeService(app.library, app);
    const publication = knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess, {}, search);
    await vi.waitFor(() => expect(app.store.publish).toHaveBeenCalledOnce());
    let encrypted = false;
    const encryption = app.library.encryptFolder(folder.id, 'test password').then(() => { encrypted = true; });
    await Promise.resolve();
    expect(encrypted).toBe(false);
    expect(app.library.getView().snapshot.papers[0].kind).toBe('plain');
    finishPublish();
    await publication;
    await encryption;
    expect(app.library.getView().snapshot.papers[0].kind).toBe('encrypted');
    knowledge.dispose();
  });

  it('rejects stale sources before search when an earlier paper changes while indexing another paper', async () => {
    const app = await setup();
    const other = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nanother-paper'), 'other.pdf');
    const originalStatus = vi.mocked(app.storage.status).getMockImplementation()!;
    vi.mocked(app.storage.status).mockImplementation(async (ids) => {
      if (ids.includes(other.id)) await app.library.editMetadata(app.paper.id, { title: 'Changed before search' });
      return originalStatus(ids);
    });
    const knowledge = new KnowledgeService(app.library, app);
    await expect(knowledge.retrieve('overnight', [app.paper, other], provider, 'test-key', app.controller.signal,
      app.assertAccess)).rejects.toThrow('文献内容已变化，请重新提问');
    expect(app.store.search).not.toHaveBeenCalled();
    knowledge.dispose();
  });

  it('rejects stale sources after search when content changes while the native query is pending', async () => {
    const app = await setup();
    let finishSearch: () => void = () => undefined;
    vi.mocked(app.store.search).mockImplementationOnce(() => new Promise((resolve) => {
      finishSearch = () => resolve([{ id: `${app.paper.id}:1`, score: 0.99 }]);
    }));
    const knowledge = new KnowledgeService(app.library, app);
    const retrieval = knowledge.retrieve('overnight', [app.paper], provider, 'test-key', app.controller.signal, app.assertAccess);
    const rejected = expect(retrieval).rejects.toThrow('文献内容已变化，请重新提问');
    await vi.waitFor(() => expect(app.store.search).toHaveBeenCalledOnce());
    await app.library.editMetadata(app.paper.id, { title: 'Changed during search' });
    finishSearch();
    await rejected;
    knowledge.dispose();
  });

  it('keeps private vectors in unlock-session memory and prohibits cloud retrieval before any upload', async () => {
    const app = await setup();
    const folder = await app.library.createFolder('Private');
    await app.library.categorize([app.paper.id], [folder.id], 'add');
    await app.library.encryptFolder(folder.id, 'test password');
    const knowledge = new KnowledgeService(app.library, app);
    const indexed = await knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal, () => undefined);
    expect(app.storage.save).not.toHaveBeenCalled();
    expect(app.storage.read).not.toHaveBeenCalled();
    // Session-only vectors travel with the query instead of being persisted.
    expect(indexed.entries).toHaveLength(indexed.chunks.length);
    await app.library.saveAiSettings({ providers: [provider], activeProviderId: provider.id, autoEnrich: false, knowledge: { backend: 'milvus', milvusUrl: 'https://milvus.test' } });
    app.embeddings.mockClear();
    await expect(knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal,
      () => undefined, {}, { backend: 'milvus', milvusUrl: 'https://milvus.test', milvusKey: 'cloud-token', assertAccess: () => undefined })).rejects.toThrow('加密文献');
    await expect(knowledge.retrieve('question', [app.library.getPaper(app.paper.id)!], provider, 'test-key', app.controller.signal, () => undefined, 'cloud-token')).rejects.toThrow('加密文献');
    expect(app.embeddings).not.toHaveBeenCalled();
    expect(app.store.search).not.toHaveBeenCalled();
    knowledge.dispose();
  });

  it('discards an embedding result after access changes and never caches it', async () => {
    const app = await setup();
    let finish: (vectors: number[][]) => void = () => undefined;
    app.embeddings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const knowledge = new KnowledgeService(app.library, app);
    const work = knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess);
    const rejected = expect(work).rejects.toThrow('locked');
    await vi.waitFor(() => expect(app.embeddings).toHaveBeenCalledOnce());
    await app.library.deletePapers([app.paper.id]);
    finish([[1, 0], [0, 1]]);
    await rejected;
    expect(app.storage.save).not.toHaveBeenCalled();
    knowledge.dispose();
  });

  it('shrinks the embedding batch instead of failing an index the provider rejects', async () => {
    const app = await setup(Array.from({ length: 20 }, (_page, index) => ({ page: index + 1, text: `Section ${index} about delayed recall.` })));
    const knowledge = new KnowledgeService(app.library, app);
    app.embeddings.mockImplementation(async (_provider, _key, texts: string[]) => {
      if (texts.length > 8) throw new Error('batch size 16 is not supported');
      return texts.map(() => [0, 1]);
    });
    const indexed = await knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal, () => undefined);
    expect(indexed.chunks).toHaveLength(20);
    expect(app.embeddings.mock.calls[0][2]).toHaveLength(16);
    expect(app.embeddings.mock.calls.slice(1).every(([, , texts]) => (texts as string[]).length <= 8)).toBe(true);
    knowledge.dispose();
  });

  it.each([401, 403, 404, 429, 503])('does not retry embedding HTTP %s failures', async (status) => {
    const app = await setup();
    const knowledge = new KnowledgeService(app.library, app);
    const failure = Object.assign(new Error('Synthetic HTTP failure'), { status, providerMessage: 'batch request failed' });
    app.embeddings.mockRejectedValue(failure);
    await expect(knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess)).rejects.toBe(failure);
    expect(app.embeddings).toHaveBeenCalledOnce();
    expect(app.storage.save).not.toHaveBeenCalled();
    knowledge.dispose();
  });

  it.each(['AI_HTTP_NETWORK', 'AI_HTTP_TIMEOUT', 'model not found', 'AbortError'])(
    'does not retry embedding %s failures', async (message) => {
      const app = await setup();
      const knowledge = new KnowledgeService(app.library, app);
      const failure = Object.assign(new Error(message), { name: message === 'AbortError' ? 'AbortError' : 'Error' });
      app.embeddings.mockRejectedValue(failure);
      await expect(knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess)).rejects.toBe(failure);
      expect(app.embeddings).toHaveBeenCalledOnce();
      expect(app.storage.save).not.toHaveBeenCalled();
      knowledge.dispose();
    },
  );

  it.each([400, 422])('does not treat unrelated HTTP %s parameter failures as a batch limit', async (status) => {
    const app = await setup();
    const knowledge = new KnowledgeService(app.library, app);
    const failure = Object.assign(new Error('Synthetic parameter failure'), { status, providerMessage: 'The configured model does not exist.' });
    app.embeddings.mockRejectedValue(failure);
    await expect(knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess)).rejects.toBe(failure);
    expect(app.embeddings).toHaveBeenCalledOnce();
    knowledge.dispose();
  });

  it.each([400, 413, 422])('shrinks actual input counts for an embedding HTTP %s size rejection', async (status) => {
    const app = await setup(Array.from({ length: 3 }, (_, index) => ({ page: index + 1, text: `Section ${index}.` })));
    const knowledge = new KnowledgeService(app.library, app);
    app.embeddings.mockImplementation(async (_provider, _key, texts: string[]) => {
      if (texts.length > 1) throw Object.assign(new Error('Synthetic size failure'), {
        status, providerMessage: status === 413 ? '' : 'The input array length exceeds the supported limit.',
      });
      return texts.map(() => [0, 1]);
    });
    await knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings.mock.calls.map(([, , texts]) => texts.length)).toEqual([3, 1, 1, 1]);
    expect(app.storage.save).toHaveBeenCalledOnce();
    knowledge.dispose();
  });

  it('stops shrinking when one input fails', async () => {
    const app = await setup([{ page: 1, text: 'Single input.' }]);
    const knowledge = new KnowledgeService(app.library, app);
    const failure = Object.assign(new Error('batch size rejected'), { status: 400 });
    app.embeddings.mockRejectedValue(failure);
    await expect(knowledge.index(app.paper, provider, 'test-key', app.controller.signal, app.assertAccess)).rejects.toBe(failure);
    expect(app.embeddings).toHaveBeenCalledOnce();
    knowledge.dispose();
  });

  it('preserves cancellation during a size rejection', async () => {
    const cancelled = await setup();
    const cancelledKnowledge = new KnowledgeService(cancelled.library, cancelled);
    const failure = Object.assign(new Error('batch size rejected'), { status: 400 });
    cancelled.embeddings.mockImplementation(async () => { cancelled.controller.abort(); throw failure; });
    await expect(cancelledKnowledge.index(cancelled.paper, provider, 'test-key', cancelled.controller.signal, cancelled.assertAccess)).rejects.toBe(failure);
    expect(cancelled.embeddings).toHaveBeenCalledOnce();
    expect(cancelled.storage.save).not.toHaveBeenCalled();
    cancelledKnowledge.dispose();
  });

  it('chunks Unicode safely with overlap and preserves each source page', async () => {
    const app = await setup();
    const chunks = chunkPaper({ ...app.paper, pages: [{ page: 8, text: '𠮷'.repeat(1300) }] });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.page)).toEqual([8, 8]);
    expect(Array.from(chunks[0].text)).toHaveLength(1200);
    expect(Array.from(chunks[0].text).slice(-160)).toEqual(Array.from(chunks[1].text).slice(0, 160));
  });
});
