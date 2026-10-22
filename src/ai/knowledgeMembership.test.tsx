import { webcrypto } from 'node:crypto';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import type { LibraryStorage } from '../library/libraryStorage';
import { AiService } from './aiService';
import { KnowledgeService } from './knowledgeService';

const pdf = new TextEncoder().encode('%PDF-1.7\nknowledge membership');
const profile = { name: '研究服务', baseUrl: 'https://api.example.com/v1', model: 'research-model' };
const extraction = async () => ({
  metadata: emptyMetadata('知识库论文'),
  pages: [{ page: 1, text: 'Attention improves memory and learning.' }], pageCount: 1,
});

async function setup() {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const storage: LibraryStorage = {
    async load() { return { revision, data: structuredClone(data) }; },
    async commit(expected, next, writes) {
      if (expected !== revision) throw new Error('LIBRARY_CONFLICT');
      for (const write of writes) write.bytes ? files.set(write.id, write.bytes.slice()) : files.delete(write.id);
      data = structuredClone(next);
      return ++revision;
    },
    async readFile(id) { return files.get(id)!.slice(); },
  };
  const library = new LibraryService(storage, extraction);
  const completion = vi.fn().mockResolvedValue('研究结论。[S1]');
  const streaming = vi.fn(async (...args: Parameters<typeof completion>) => completion(...args) as Promise<string>);
  const ai = new AiService(library, completion, {}, streaming as never);
  await ai.saveProvider(profile, 'session-key', undefined, true);
  const paper = await library.importPdf(pdf, 'paper.pdf');
  return { library, ai, paper, completion, streaming, storage, files };
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); });

describe('AI knowledge membership', () => {
  it('excludes removed files from full-text answers even when a caller explicitly requests them', async () => {
    const { library, ai, paper } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nincluded paper'), 'included.pdf');
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    const answer = await ai.ask('Attention', { grounding: 'library' });
    expect(answer.retrieval).toBe('fulltext');
    expect(new Set(answer.sources.map((source) => source.paperId))).toEqual(new Set([second.id]));
    await expect(ai.ask('Attention', { paperIds: [paper.id] })).rejects.toThrow('请先导入或解锁');
    expect(library.search('Attention').map((hit) => hit.paperId)).toContain(paper.id);
    ai.dispose();
  });

  it.each(['local', 'milvus'] as const)('excludes removed files from %s indexing and semantic retrieval', async (backend) => {
    const { library, ai, paper, completion } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nvector paper'), 'vector.pdf');
    const forget = vi.spyOn(KnowledgeService.prototype, 'forget').mockResolvedValue();
    const index = vi.spyOn(KnowledgeService.prototype, 'index')
      .mockResolvedValue({ chunks: [], dimension: 2, entries: null, fingerprint: 'f'.repeat(64) });
    const retrieve = vi.spyOn(KnowledgeService.prototype, 'retrieve').mockResolvedValue([
      { id: `${second.id}:0`, paperId: second.id, page: 1, title: '知识库论文', text: 'Attention improves memory.' },
    ]);
    const providerId = library.getView().snapshot.ai.activeProviderId!;
    await ai.saveProvider({ ...profile, id: providerId, embeddingModel: 'embedding-test' });
    await ai.saveKnowledgeSettings(backend, backend === 'milvus' ? 'https://milvus.example.test' : '', backend === 'milvus' ? 'cloud-token' : undefined);
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    await ai.buildKnowledge();
    expect(index.mock.calls.map(([indexed]) => indexed.id)).toEqual([second.id]);
    await expect(ai.buildKnowledge([paper.id])).rejects.toThrow('请先添加或解锁');
    const answer = await ai.ask('Attention', { paperIds: [paper.id, second.id] });
    expect(retrieve.mock.calls[0][1].map((item) => item.id)).toEqual([second.id]);
    expect(JSON.parse(completion.mock.calls.at(-1)![2][1].content).sources.map((source: { paperId: string }) => source.paperId)).toEqual([second.id]);
    expect(answer.retrieval).toBe(backend === 'milvus' ? 'milvus-vector' : 'local-vector');
    expect(forget).toHaveBeenCalledWith([paper.id], expect.objectContaining({ backend }));
    ai.dispose();
  });

  it('does not automatically rebuild excluded knowledge when its library text index is refreshed', async () => {
    const { library, ai, paper } = await setup();
    const providerId = library.getView().snapshot.ai.activeProviderId!;
    await ai.saveProvider({ ...profile, id: providerId, embeddingModel: 'embedding-test' });
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    const build = vi.spyOn(ai, 'buildKnowledge');
    await library.retryIndex(paper.id);
    expect(build).not.toHaveBeenCalled();
    expect(library.getPaper(paper.id)?.knowledgeExcluded).toBe(true);
    expect(library.search('Attention').map((hit) => hit.paperId)).toContain(paper.id);
    ai.dispose();
  });

  it('reports cloud cleanup failure without undoing membership removal or deleting the library paper', async () => {
    const { library, ai, paper } = await setup();
    await ai.saveKnowledgeSettings('milvus', 'https://milvus.example.test', 'cloud-token');
    vi.spyOn(KnowledgeService.prototype, 'forget').mockRejectedValue(new Error('offline'));
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    await waitFor(() => expect(ai.getView().knowledgeCleanupError).toContain('云端向量清理未完成'));
    expect(library.getPaper(paper.id)?.knowledgeExcluded).toBe(true);
    expect(Array.from(await library.readPdf(paper.id))).toEqual(Array.from(pdf));
    ai.dispose();
  });

  it('cancels an in-flight vector build and ignores its late success after removal', async () => {
    const { library, ai, paper } = await setup();
    const providerId = library.getView().snapshot.ai.activeProviderId!;
    await ai.saveProvider({ ...profile, id: providerId, embeddingModel: 'embedding-test' });
    let finish!: () => void;
    const index = vi.spyOn(KnowledgeService.prototype, 'index').mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ chunks: [], dimension: 2, entries: null, fingerprint: 'f'.repeat(64) });
    }));
    const work = ai.buildKnowledge([paper.id]);
    const cancelled = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(index).toHaveBeenCalledOnce());
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    finish();
    await cancelled;
    expect(ai.getView().indexedPaperIds).not.toContain(paper.id);
    expect(ai.getView().knowledgeErrors).toEqual({});
    expect(library.getPaper(paper.id)).toBeDefined();
    ai.dispose();
  });

  it('discards an in-flight answer using a removed file even if the provider completes late', async () => {
    const { library, ai, paper, completion } = await setup();
    let finish!: (text: string) => void;
    completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const answer = ai.ask('Attention', { paperIds: [paper.id] });
    const cancelled = expect(answer).rejects.toThrow('回答已取消');
    await waitFor(() => expect(completion).toHaveBeenCalledOnce());
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    finish('迟到回答。[S1]');
    await cancelled;
    expect(library.getPaper(paper.id)).toBeDefined();
    ai.dispose();
  });

  it('keeps membership with an encrypted paper through lock and unlock', async () => {
    const { library, ai, paper } = await setup();
    const folder = await library.createFolder('私密文献');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'vault password');
    expect(library.getPaper(paper.id)?.knowledgeExcluded).toBe(true);
    expect(Array.from(await library.readPdf(paper.id))).toEqual(Array.from(pdf));
    await expect(ai.ask('Attention', { paperIds: [paper.id] })).rejects.toThrow('请先导入或解锁');
    ai.dispose();
  });
});
