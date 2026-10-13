import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService, parseMetadataResponse } from './aiService';
import { LibraryService } from '../library/libraryService';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import type { LibraryStorage } from '../library/libraryStorage';

function setup(pages = [{ page: 1, text: 'Attention improves learning through cognitive mechanisms.' }]) {
  let snapshot: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const storage: LibraryStorage = {
    async load() { return { revision, data: structuredClone(snapshot) }; },
    async commit(expected, data, blobs) {
      if (expected !== revision) throw new Error('conflict');
      for (const blob of blobs) {
        if (blob.bytes) files.set(blob.id, blob.bytes.slice());
        else files.delete(blob.id);
      }
      snapshot = structuredClone(data);
      return ++revision;
    },
    async readFile(id) { return files.get(id)!.slice(); },
  };
  const library = new LibraryService(storage, async () => ({
    metadata: { ...emptyMetadata('Attention study'), abstract: 'Attention improves learning.' },
    pages, pageCount: pages.length,
  }));
  const completion = vi.fn().mockResolvedValue('{"researchFields":["认知神经"],"disciplines":["神经科学"],"year":"2025","journalType":"期刊论文","researchTopics":["注意力"]}');
  const ai = new AiService(library, completion);
  return { library, ai, completion, persisted: () => JSON.stringify(snapshot) };
}

const pdf = new TextEncoder().encode('%PDF-1.7\nAI fixture');
const profile = { name: '兼容厂商', baseUrl: 'https://example.org/v1', model: 'research-model' };

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('research AI service', () => {
  it('clears the shared credential when the optional embedding endpoint changes', async () => {
    const { ai } = setup();
    const provider = await ai.saveProvider({ name: '阿里云', baseUrl: 'https://chat.example.test/v1', model: 'qwen-chat', embeddingModel: 'text-embedding-v4' }, 'test-secret');
    expect(ai.hasApiKey(provider.id)).toBe(true);
    await ai.saveProvider({ ...provider, embeddingBaseUrl: 'https://vectors.example.test/v1' });
    expect(ai.hasApiKey(provider.id)).toBe(false);
    await expect(ai.testEmbeddingConnection()).rejects.toThrow('API Key');
    ai.dispose();
  });
  it('stores only encrypted keys, supports session-only keys and requires unlock after restart', async () => {
    const { ai, library, completion, persisted } = setup();
    const provider = await ai.saveProvider(profile, 'private-key-value', 'my password');
    expect(persisted()).not.toContain('private-key-value');
    expect(library.getView().snapshot.ai.providers[0].savedKey).not.toBeNull();
    const restarted = new AiService(library, completion);
    expect(restarted.hasApiKey(provider.id)).toBe(false);
    await expect(restarted.unlockSavedKey(provider.id, 'incorrect')).rejects.toThrow();
    await restarted.unlockSavedKey(provider.id, 'my password');
    expect(restarted.hasApiKey(provider.id)).toBe(true);
    await restarted.forgetKey(provider.id);
    expect(library.getView().snapshot.ai.providers[0].savedKey).toBeNull();
    expect(restarted.hasApiKey(provider.id)).toBe(false);
    ai.dispose();
    restarted.dispose();
  });

  it('enriches and classifies imported papers only when automatic processing is enabled', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    expect(completion).not.toHaveBeenCalled();
    await library.editMetadata(paper.id, { year: '2020' });
    await ai.enrich(paper.id);
    expect(library.getPaper(paper.id)?.metadata.year).toBe('2020');
    expect(library.getView().snapshot.memberships[paper.id]).toHaveLength(5);
    expect(library.getPaper(paper.id)?.aiStatus).toBe('ready');
    await ai.setAutoEnrich(true);
    await library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond'), 'second.pdf');
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(2));
    ai.dispose();
  });

  it('keeps local indexes when AI fails and records a retryable failure', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    completion.mockRejectedValueOnce(new Error('请求被限流，请稍后重试。'));
    await expect(ai.enrich(paper.id)).rejects.toThrow('限流');
    expect(library.getPaper(paper.id)).toMatchObject({ indexStatus: 'ready', aiStatus: 'error' });
    expect(library.search('attention')).toHaveLength(1);
    await ai.enrich(paper.id);
    expect(library.getPaper(paper.id)?.aiStatus).toBe('ready');
    ai.dispose();
  });

  it('grounds answers in accessible paper pages and rejects invented source identifiers', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    completion.mockResolvedValueOnce('注意力有助于学习。[S1]');
    const answer = await ai.ask('学习结论是什么？', [paper.id]);
    expect(answer.sources).toEqual([expect.objectContaining({ paperId: paper.id, page: 1, label: 'S1' })]);
    expect(completion.mock.calls.at(-1)?.[2][0].content).toContain('不可信');
    completion.mockResolvedValueOnce('这是虚构引用 [S99]');
    await expect(ai.ask('结论', [paper.id])).rejects.toThrow('引用');
    ai.dispose();
  });

  it('cancels a delayed enrichment when its vault locks and never publishes a late result', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    let finish: (value: string) => void = () => undefined;
    completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const job = ai.enrich(paper.id);
    const rejected = expect(job).rejects.toThrow();
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(1));
    await library.lockVault(vault.id);
    await library.unlockVault(vault.id, 'vault password');
    finish('{"title":"Late AI output"}');
    await rejected;
    expect(library.getPaper(paper.id)?.metadata.title).toBe('Attention study');
    ai.dispose();
  });

  it('checks metadata response shape and never trusts indexing-status assertions', () => {
    expect(parseMetadataResponse('```json\n{"title":"论文","year":2025,"indexingStatus":"SCIE"}\n```'))
      .toEqual({ title: '论文', year: '2025' });
    expect(() => parseMetadataResponse('{"authors":"invented shape"}')).toThrow();
    expect(() => parseMetadataResponse('[]')).toThrow();
    expect(() => parseMetadataResponse('{}')).toThrow();
  });

  it('finishes public-paper enrichment when an unrelated private folder locks', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const privatePaper = await library.importPdf(pdf, 'private.pdf');
    const publicPaper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\npublic'), 'public.pdf');
    const folder = await library.createFolder('私密');
    await library.categorize([privatePaper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    let finish!: (value: string) => void;
    completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const job = ai.enrich(publicPaper.id);
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(1));
    await library.lockVault(vault.id);
    finish('{"researchTopics":["公开主题"]}');
    await job;
    expect(library.getPaper(publicPaper.id)?.aiStatus).toBe('ready');
    expect(library.getPaper(publicPaper.id)?.metadata.researchTopics).toEqual(['公开主题']);
    ai.dispose();
  });

  it('serializes provider changes without losing concurrent additions or their session keys', async () => {
    const { ai, library } = setup();
    const providers = await Promise.all([
      ai.saveProvider(profile, 'provider-one-key', 'saved password'),
      ai.saveProvider({ ...profile, name: '第二家' }, 'provider-two-key'),
    ]);
    expect(library.getView().snapshot.ai.providers).toHaveLength(2);
    expect(providers.every((provider) => ai.hasApiKey(provider.id))).toBe(true);
    ai.dispose();
  });

  it('requires fresh credentials when changing a provider endpoint', async () => {
    const { ai, library, completion } = setup();
    const saved = await ai.saveProvider(profile, 'original-host-key', 'saved password');
    await ai.saveProvider({ ...profile, id: saved.id, baseUrl: 'https://another.example/v1' });
    expect(ai.hasApiKey(saved.id)).toBe(false);
    expect(library.getView().snapshot.ai.providers[0].savedKey).toBeNull();
    await expect(ai.testConnection()).rejects.toThrow('API Key');
    expect(completion).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('cannot restore a secret from a pending unlock after it is forgotten', async () => {
    const { ai } = setup();
    const saved = await ai.saveProvider(profile, 'private-key', 'saved password');
    const unlocking = ai.unlockSavedKey(saved.id, 'saved password');
    const cancelled = expect(unlocking).rejects.toThrow('配置已变化');
    await ai.forgetKey(saved.id);
    await cancelled;
    expect(ai.hasApiKey(saved.id)).toBe(false);
    ai.dispose();
  });

  it('allows only one concurrent answer and cancels its request', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    let finish: (value: string) => void = () => undefined;
    completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = ai.ask('结论', [paper.id]);
    const cancelled = expect(first).rejects.toThrow('取消');
    await expect(ai.ask('另一个问题', [paper.id])).rejects.toThrow('等待');
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(1));
    ai.cancelAnswer();
    expect(completion.mock.calls[0][3].signal.aborted).toBe(true);
    finish('答案 [S1]');
    await cancelled;
    ai.dispose();
  });

  it('retrieves natural-language question evidence late in a page despite line breaks', async () => {
    const { ai, library, completion } = setup([
      { page: 1, text: 'Introduction to research methods.' },
      { page: 2, text: 'Experimental setup and participants.' },
      { page: 3, text: `${'Unrelated filler line.\n'.repeat(400)}Memory\nconsolidation improves after sleep.` },
    ]);
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    completion.mockResolvedValueOnce('Memory consolidation improves after sleep. [S1]');
    const answer = await ai.ask('What does the study report about memory consolidation?', [paper.id]);
    expect(answer.sources[0]).toMatchObject({ page: 3 });
    expect(answer.sources[0].excerpt).toContain('Memory consolidation improves after sleep.');
    ai.dispose();
  });
});
