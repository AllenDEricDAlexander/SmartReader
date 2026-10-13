import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, type AiProviderProfile, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import { AiService } from './aiService';
import { KnowledgeService, chunkPaper } from './knowledgeService';
import type { KnowledgeCache, KnowledgeStorage } from './knowledgeStorage';

const provider: AiProviderProfile = { id: 'ali', name: '阿里云', baseUrl: 'https://example.test/v1/chat/completions', model: 'qwen-chat', embeddingModel: 'text-embedding-v4', savedKey: null };

async function setup() {
  let snapshot: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const library = new LibraryService({
    load: async () => ({ revision, data: structuredClone(snapshot) }),
    commit: async (_version, next, blobs) => { snapshot = structuredClone(next); for (const blob of blobs) blob.bytes ? files.set(blob.id, blob.bytes.slice()) : files.delete(blob.id); return ++revision; },
    readFile: async (id) => files.get(id)!.slice(),
  }, async () => ({ metadata: emptyMetadata('Memory study'), pages: [
    { page: 1, text: 'Background on experimental design.' }, { page: 10, text: 'Hippocampal consolidation strengthens delayed recall during sleep.' },
  ], pageCount: 10 }));
  const paper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nknowledge'), 'knowledge.pdf');
  const persisted = new Map<string, KnowledgeCache>();
  const identity = (key: KnowledgeCache['key']) => [key.paperId, key.modelKey, key.contentKey].join(':');
  const storage: KnowledgeStorage = {
    read: vi.fn(async (key) => structuredClone(persisted.get(identity(key)) ?? null)),
    save: vi.fn(async (cache) => { persisted.set(identity(cache.key), structuredClone(cache)); }),
  };
  const embeddings = vi.fn(async (_provider: AiProviderProfile, _key: string, texts: string[]) => texts.map((text) => /Hippocampal|retain|overnight/.test(text) ? [1, 0] : [0, 1]));
  const vectors = vi.fn(async () => [{ id: `${paper.id}:1`, score: 0.99 }]);
  const controller = new AbortController();
  const access = library.captureAccess();
  const assertAccess = () => { if (!library.canAccess(paper.id, access)) throw new Error('locked'); };
  return { library, paper, persisted, storage, embeddings, vectors, controller, assertAccess };
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('SQLite-backed semantic knowledge', () => {
  it('retrieves a late page by vectors for a question without matching keywords and feeds that source into chat', async () => {
    const app = await setup();
    const completion = vi.fn().mockResolvedValue('Sleep supports retention [S1]');
    const ai = new AiService(app.library, completion, { storage: app.storage, embeddings: app.embeddings, vectors: app.vectors });
    await ai.saveProvider(provider, 'test-key');
    expect(app.library.search('What helps us retain learned material overnight?')).toEqual([]);
    const result = await ai.ask('What helps us retain learned material overnight?', [app.paper.id]);
    expect(result.retrieval).toBe('local-vector');
    expect(result.sources[0]).toMatchObject({ paperId: app.paper.id, page: 10, excerpt: expect.stringContaining('Hippocampal') });
    expect(JSON.parse(completion.mock.calls[0][2][1].content).sources).toEqual(result.sources);
    expect(app.vectors).toHaveBeenCalledWith(expect.arrayContaining([{ id: `${app.paper.id}:1`, vector: [1, 0] }]), expect.any(Array), expect.objectContaining({ backend: 'local' }));
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
    await app.library.editMetadata(app.paper.id, { title: 'Updated interpretation' });
    await knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings).toHaveBeenCalledTimes(2);
    await knowledge.index(app.library.getPaper(app.paper.id)!, { ...provider, embeddingModel: 'new-embedding' }, 'test-key', app.controller.signal, app.assertAccess);
    expect(app.embeddings).toHaveBeenCalledTimes(3);
    knowledge.dispose();
  });

  it('keeps private vectors in unlock-session memory and prohibits cloud retrieval before any upload', async () => {
    const app = await setup();
    const folder = await app.library.createFolder('Private');
    await app.library.categorize([app.paper.id], [folder.id], 'add');
    await app.library.encryptFolder(folder.id, 'test password');
    const knowledge = new KnowledgeService(app.library, app);
    await knowledge.index(app.library.getPaper(app.paper.id)!, provider, 'test-key', app.controller.signal, () => undefined);
    expect(app.storage.save).not.toHaveBeenCalled();
    expect(app.storage.read).not.toHaveBeenCalled();
    await app.library.saveAiSettings({ providers: [provider], activeProviderId: provider.id, autoEnrich: false, knowledge: { backend: 'milvus', milvusUrl: 'https://milvus.test' } });
    app.embeddings.mockClear();
    await expect(knowledge.retrieve('question', [app.library.getPaper(app.paper.id)!], provider, 'test-key', app.controller.signal, () => undefined, 'cloud-token')).rejects.toThrow('加密文献');
    expect(app.embeddings).not.toHaveBeenCalled();
    expect(app.vectors).not.toHaveBeenCalled();
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

  it('chunks Unicode safely with overlap and preserves each source page', async () => {
    const app = await setup();
    const chunks = chunkPaper({ ...app.paper, pages: [{ page: 8, text: '𠮷'.repeat(1300) }] });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.page)).toEqual([8, 8]);
    expect(Array.from(chunks[0].text)).toHaveLength(1200);
    expect(Array.from(chunks[0].text).slice(-160)).toEqual(Array.from(chunks[1].text).slice(0, 160));
  });
});
