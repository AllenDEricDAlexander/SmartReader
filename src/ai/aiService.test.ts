import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService, boundedHistory, parseMetadataResponse, verifyCitations } from './aiService';
import { KnowledgeService } from './knowledgeService';
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
  return { library, ai, completion, storage, snapshot: () => structuredClone(snapshot), persisted: () => JSON.stringify(snapshot) };
}

const pdf = new TextEncoder().encode('%PDF-1.7\nAI fixture');
const profile = { name: '兼容厂商', baseUrl: 'https://example.org/v1', model: 'research-model' };

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('research AI service', () => {
  it('normalizes model presets and preserves them when an existing caller saves without a model list', async () => {
    const { ai, library } = setup();
    const provider = await ai.saveProvider({ ...profile, models: [' research-model ', 'fast-model', '', 'fast-model', ' deep-model '] });
    expect(provider.models).toEqual(['research-model', 'fast-model', 'deep-model']);
    await ai.saveProvider({ ...profile, id: provider.id, name: '修改后的厂商' });
    expect(library.getView().snapshot.ai.providers[0].models).toEqual(provider.models);
    await expect(ai.saveProvider({ ...profile, id: provider.id, models: ['x'.repeat(201)] })).rejects.toThrow('200');
    expect(library.getView().snapshot.ai.providers[0].models).toEqual(provider.models);
    ai.dispose();
  });

  it('routes chat and enrichment to the selected model and restores each provider selection after restart', async () => {
    const { ai, library, completion, storage } = setup();
    const first = await ai.saveProvider({ ...profile, models: ['research-model', 'fast-model'] }, 'first-device-key', undefined, true);
    const second = await ai.saveProvider({ name: '第二家', baseUrl: 'https://second.example/v1', model: 'second-model', models: ['second-model', 'second-fast'] }, 'second-device-key', undefined, true);
    await ai.selectProvider(first.id, 'fast-model');
    const answer = await ai.ask('Hello', { grounding: 'direct' });
    expect(answer).toMatchObject({ providerName: first.name, model: 'fast-model' });
    expect(completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: first.id, model: 'fast-model', baseUrl: first.baseUrl }), 'first-device-key']);
    await ai.selectProvider(second.id, 'second-fast');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    await ai.enrich(paper.id);
    expect(completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: second.id, model: 'second-fast', baseUrl: second.baseUrl }), 'second-device-key']);
    await ai.selectProvider(first.id);
    expect(library.getView().snapshot.ai.providers.find((item) => item.id === first.id)?.model).toBe('fast-model');
    ai.dispose();
    const restoredLibrary = new LibraryService(storage);
    const restored = new AiService(restoredLibrary, completion);
    await restoredLibrary.initialize();
    expect(restoredLibrary.getView().snapshot.ai.activeProviderId).toBe(first.id);
    expect(restoredLibrary.getView().snapshot.ai.providers.map((item) => item.model)).toEqual(['fast-model', 'second-fast']);
    await restored.testConnection();
    expect(completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: first.id, model: 'fast-model' }), 'first-device-key']);
    restored.dispose();
  });

  it('accepts legacy single-model providers and rejects unconfigured selections without changing state', async () => {
    const { ai, library, storage } = setup();
    const provider = await ai.saveProvider(profile, 'session-key');
    const { models: _models, ...legacy } = provider;
    await library.saveAiSettings({ ...library.getView().snapshot.ai, providers: [legacy] });
    const epoch = ai.getView().answerEpoch;
    const commit = vi.spyOn(storage, 'commit');
    await ai.selectProvider(provider.id, provider.model);
    await expect(ai.selectProvider(provider.id, 'unknown-model')).rejects.toThrow('不在厂商配置中');
    await expect(ai.selectProvider(provider.id, '')).rejects.toThrow('不在厂商配置中');
    await expect(ai.selectProvider('missing')).rejects.toThrow('不存在');
    expect(commit).not.toHaveBeenCalled();
    expect(ai.getView().answerEpoch).toBe(epoch);
    expect(library.getView().snapshot.ai.providers).toEqual([legacy]);
    ai.dispose();
  });

  it('keeps the current selection, key and conversation epoch when persisting a switch fails', async () => {
    const { ai, library, storage } = setup();
    const first = await ai.saveProvider(profile, 'first-key');
    const second = await ai.saveProvider({ ...profile, name: '第二家', models: ['research-model', 'fast-model'] }, 'second-key');
    const before = structuredClone(library.getView().snapshot.ai);
    const epoch = ai.getView().answerEpoch;
    vi.spyOn(storage, 'commit').mockRejectedValueOnce(new Error('磁盘写入失败'));
    await expect(ai.selectProvider(second.id, 'fast-model')).rejects.toThrow('磁盘写入失败');
    expect(library.getView().snapshot.ai).toEqual(before);
    expect(ai.getView().answerEpoch).toBe(epoch);
    expect(ai.hasApiKey(first.id) && ai.hasApiKey(second.id)).toBe(true);
    await ai.selectProvider(second.id, 'fast-model');
    expect(library.getView().snapshot.ai.activeProviderId).toBe(second.id);
    expect(library.getView().snapshot.ai.providers.find((item) => item.id === second.id)?.model).toBe('fast-model');
    expect(ai.getView().answerEpoch).toBe(epoch);
    ai.dispose();
  });

  it('serializes model switches with other provider changes without losing either selection', async () => {
    const { ai, library } = setup();
    const first = await ai.saveProvider({ ...profile, models: ['fast-model'] }, 'first-key');
    const second = await ai.saveProvider({ ...profile, name: '第二家', models: ['second-model'] }, 'second-key');
    await Promise.all([
      ai.selectProvider(first.id, 'fast-model'),
      ai.saveProvider({ ...profile, name: '第三家' }, 'third-key'),
      ai.selectProvider(second.id, 'second-model'),
    ]);
    const settings = library.getView().snapshot.ai;
    expect(settings.providers).toHaveLength(3);
    expect(settings.activeProviderId).toBe(second.id);
    expect(settings.providers.find((item) => item.id === first.id)?.model).toBe('fast-model');
    expect(settings.providers.find((item) => item.id === second.id)?.model).toBe('second-model');
    ai.dispose();
  });

  it('cancels and discards an old in-flight answer when its model changes', async () => {
    const { ai, completion } = setup();
    const provider = await ai.saveProvider({ ...profile, models: ['fast-model'] }, 'session-key');
    let finish!: (text: string) => void;
    completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const answering = ai.ask('Hello', { grounding: 'direct' });
    const cancelled = expect(answering).rejects.toThrow('回答已取消');
    await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce());
    const signal = completion.mock.calls[0][3].signal as AbortSignal;
    await ai.selectProvider(provider.id, 'fast-model');
    expect(signal.aborted).toBe(true);
    finish('The old model answer');
    await cancelled;
    ai.dispose();
  });

  it('refreshes retrieval state without clearing the shared conversation when switching providers and models', async () => {
    const { ai, library } = setup();
    const first = await ai.saveProvider({ ...profile, models: ['fast-model'] }, 'first-key');
    const second = await ai.saveProvider({ ...profile, name: '第二家', embeddingModel: 'other-embedding' }, 'second-key');
    const session = {
      epoch: ai.getView().answerEpoch,
      messages: [
        { id: 1, contextKey: 'direct', role: 'user' as const, content: 'Previous question' },
        { id: 2, contextKey: 'direct', role: 'assistant' as const, content: 'Previous answer' },
      ],
      draft: 'Follow-up draft', scope: 'all' as const, selectedPaperIds: [], fileQuery: '', mode: 'direct' as const,
    };
    ai.saveAssistantSession(session);
    const clear = vi.spyOn(KnowledgeService.prototype, 'clear');
    try {
      await ai.selectProvider(first.id, 'fast-model');
      expect(ai.getAssistantSession()).toEqual(session);
      await ai.selectProvider(second.id);
      expect(ai.getAssistantSession()).toEqual(session);
      expect(ai.getView().answerEpoch).toBe(session.epoch);
      expect(clear).toHaveBeenCalledTimes(2);
      expect(library.getView().snapshot.ai.activeProviderId).toBe(second.id);
    } finally { clear.mockRestore(); ai.dispose(); }
  });

  it('ignores late streaming output after a model switch while retaining the existing conversation epoch', async () => {
    const { library, ai: previous, completion } = setup();
    const provider = await previous.saveProvider({ ...profile, models: ['fast-model'] }, 'device-key', undefined, true);
    previous.dispose();
    let finish!: () => void;
    const streaming = vi.fn((_provider: unknown, _key: unknown, _messages: unknown, options: { onDelta?(text: string): void; onReasoning?(text: string): void } = {}) =>
      new Promise<string>((resolve) => {
        finish = () => {
          options.onDelta?.('Late answer');
          options.onReasoning?.('Late reasoning');
          resolve('Late answer');
        };
      }));
    const ai = new AiService(library, completion, {}, streaming);
    const epoch = ai.getView().answerEpoch;
    const onDelta = vi.fn();
    const onReasoning = vi.fn();
    const answering = ai.ask('Hello', { grounding: 'direct', onDelta, onReasoning });
    const cancelled = expect(answering).rejects.toThrow('回答已取消');
    await vi.waitFor(() => expect(streaming).toHaveBeenCalledOnce());
    await ai.selectProvider(provider.id, 'fast-model');
    finish();
    await cancelled;
    expect(ai.getView().answerEpoch).toBe(epoch);
    expect(onDelta).not.toHaveBeenCalled();
    expect(onReasoning).not.toHaveBeenCalled();
    ai.dispose();
  });

  it('persists the current conversation and draft and restores them in a fresh service', async () => {
    const { library, ai, storage, completion, persisted } = setup();
    await ai.saveProvider(profile, 'session-key');
    const session = {
      epoch: ai.getView().answerEpoch,
      messages: [{ id: 1, contextKey: 'direct', role: 'user' as const, content: 'Private session question' }],
      draft: 'Private session draft', scope: 'all' as const, selectedPaperIds: [], fileQuery: '', mode: 'direct' as const,
    };
    ai.saveAssistantSession(session);
    expect(ai.getAssistantSession()).toEqual(session);
    await ai.flushAssistantSession();
    expect(persisted()).toContain('Private session draft');
    ai.dispose();
    expect(ai.getAssistantSession()).toBeNull();
    ai.saveAssistantSession(session);
    expect(ai.getAssistantSession()).toBeNull();
    const restoredLibrary = new LibraryService(storage);
    const restarted = new AiService(restoredLibrary, completion);
    await restarted.loadAssistantSession();
    expect(restarted.getAssistantSession()).toEqual(session);
    restarted.dispose();
  });

  it('excludes scanned PDFs with no text from an otherwise usable semantic scope', async () => {
    const { library, ai, completion } = setup([]);
    await ai.saveProvider({ ...profile, embeddingModel: 'embedding-test' }, 'session-key');
    const readable = await library.importPdf(pdf, 'with-abstract.pdf');
    const scan = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nscan'), 'scan.pdf');
    await library.editMetadata(scan.id, { abstract: '' });
    const retrieve = vi.spyOn(KnowledgeService.prototype, 'retrieve').mockResolvedValue([
      { id: `${readable.id}:0`, paperId: readable.id, page: 1, title: readable.metadata.title, text: readable.metadata.abstract },
    ]);
    completion.mockResolvedValue('Attention improves learning. [S1]');
    try {
      const answer = await ai.ask('What improves learning?', { grounding: 'library' });
      expect(retrieve.mock.calls[0][1].map((paper) => paper.id)).toEqual([readable.id]);
      expect(answer.retrieval).toBe('local-vector');
      await expect(ai.ask('Only this scan', { paperIds: [scan.id] })).rejects.toThrow('导入或解锁');
      expect(retrieve).toHaveBeenCalledOnce();
    } finally { retrieve.mockRestore(); ai.dispose(); }
  });

  it('cleans previously public cloud vectors on encryption even after switching to local mode', async () => {
    const { library, ai } = setup();
    await ai.saveKnowledgeSettings('milvus', 'https://milvus.example.test', 'cloud-token');
    await ai.saveKnowledgeSettings('local', '');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    const folder = await library.createFolder('Private');
    await library.categorize([paper.id], [folder.id], 'move');
    const forget = vi.spyOn(KnowledgeService.prototype, 'forget').mockResolvedValue();
    try {
      await library.encryptFolder(folder.id, 'vault password');
      expect(forget).toHaveBeenCalledWith([paper.id], expect.objectContaining({
        backend: 'milvus', milvusUrl: 'https://milvus.example.test', milvusKey: 'cloud-token',
      }));
      expect(library.getPaper(paper.id)).toBeDefined();
    } finally { forget.mockRestore(); ai.dispose(); }
  });

  it('reports failed cloud cleanup without preventing document-free chat', async () => {
    const { library, ai, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    await ai.saveKnowledgeSettings('milvus', 'https://milvus.example.test', 'cloud-token');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    const forget = vi.spyOn(KnowledgeService.prototype, 'forget').mockRejectedValue(new Error('offline'));
    completion.mockResolvedValue('Hello');
    try {
      await library.deletePapers([paper.id]);
      await vi.waitFor(() => expect(ai.getView().knowledgeCleanupError).toContain('清理未完成'));
      expect((await ai.ask('Hello', { grounding: 'direct' })).text).toBe('Hello');
    } finally { forget.mockRestore(); ai.dispose(); }
  });

  it('starts a requested rebuild after the previous indexing attempt fails', async () => {
    const { library, ai } = setup();
    const paper = await library.importPdf(pdf, 'paper.pdf');
    await ai.saveProvider({ ...profile, embeddingModel: 'embedding-test' }, 'session-key');
    let fail!: (error: Error) => void;
    const index = vi.spyOn(KnowledgeService.prototype, 'index')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValue({ chunks: [], dimension: 2, entries: null, fingerprint: 'f'.repeat(64) });
    try {
      const previous = ai.buildKnowledge([paper.id], false);
      const rejected = expect(previous).rejects.toThrow('temporary failure');
      await vi.waitFor(() => expect(index).toHaveBeenCalledOnce());
      const retry = ai.buildKnowledge([paper.id], true);
      fail(new Error('temporary failure'));
      await rejected;
      await retry;
      expect(index).toHaveBeenCalledTimes(2);
      expect(ai.getView().indexedPaperIds).toContain(paper.id);
      expect(ai.getView().knowledgeErrors).toEqual({});
    } finally { index.mockRestore(); ai.dispose(); }
  });

  it('does not restart a waiting rebuild after the user cancels indexing', async () => {
    const { library, ai } = setup();
    const paper = await library.importPdf(pdf, 'paper.pdf');
    await ai.saveProvider({ ...profile, embeddingModel: 'embedding-test' }, 'session-key');
    const index = vi.spyOn(KnowledgeService.prototype, 'index')
      .mockImplementationOnce((_paper, _provider, _key, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }))
      .mockResolvedValue({ chunks: [], dimension: 2, entries: null, fingerprint: 'f'.repeat(64) });
    try {
      const previous = ai.buildKnowledge([paper.id], false);
      const previousCancelled = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(index).toHaveBeenCalledOnce());
      const rebuild = ai.buildKnowledge([paper.id], true);
      const rebuildCancelled = expect(rebuild).rejects.toMatchObject({ name: 'AbortError' });
      await Promise.resolve();
      ai.cancelKnowledge([paper.id]);
      await previousCancelled;
      await rebuildCancelled;
      expect(index).toHaveBeenCalledOnce();
      expect(ai.getView().indexedPaperIds).not.toContain(paper.id);
      expect(ai.getView().indexingPaperIds).toEqual([]);
    } finally { index.mockRestore(); ai.dispose(); }
  });

  it('keeps a key the user asked this device to remember and reloads it next session', async () => {
    const first = setup();
    const saved = await first.ai.saveProvider(profile, 'device-key', undefined, true);
    expect(first.ai.hasApiKey(saved.id)).toBe(true);
    expect(first.persisted()).toContain('device-key');
    first.ai.dispose();
    // A later session must find the credential already usable; otherwise a
    // configured provider looks ready while every request fails.
    const next = new AiService(first.library, first.completion);
    await next.selectProvider(saved.id);
    expect(next.hasApiKey(saved.id)).toBe(true);
    expect(next.getView().keyProviderIds).toEqual([saved.id]);
    await next.forgetKey(saved.id);
    expect(next.hasApiKey(saved.id)).toBe(false);
    expect(first.persisted()).not.toContain('device-key');
    expect(first.library.getView().snapshot.ai.providers[0].storedKey).toBeNull();
    next.dispose();
  });

  it('keeps a session-only key out of storage and refuses to remember without a key', async () => {
    const { ai, persisted } = setup();
    const saved = await ai.saveProvider(profile, 'session-only-key');
    expect(persisted()).not.toContain('session-only-key');
    expect(ai.hasApiKey(saved.id)).toBe(true);
    await expect(ai.saveProvider({ ...profile, id: saved.id }, undefined, undefined, true)).rejects.toThrow('请先输入 API Key');
    ai.dispose();
  });

  it('drops a device key when the service endpoint changes', async () => {
    const { ai, library, persisted } = setup();
    const saved = await ai.saveProvider(profile, 'device-key', undefined, true);
    await ai.saveProvider({ ...profile, id: saved.id, baseUrl: 'https://moved.example/v1' });
    expect(ai.hasApiKey(saved.id)).toBe(false);
    expect(library.getView().snapshot.ai.providers[0].storedKey).toBeNull();
    expect(persisted()).not.toContain('device-key');
    ai.dispose();
  });

  it('bounds conversation history and keeps only verifiable citations', () => {
    const history = Array.from({ length: 30 }, (_turn, index) => ({
      role: (index % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `turn ${index}`,
    }));
    const bounded = boundedHistory([...history, { role: 'user', content: '   ' }]);
    expect(bounded).toHaveLength(20);
    expect(bounded[0].content).toBe('turn 10');
    expect(boundedHistory(history, 4, 14)).toEqual([{ role: 'user', content: 'turn 28' }, { role: 'assistant', content: 'turn 29' }]);
    const sources = [{ label: 'S1', paperId: 'p', title: 't', page: 1, excerpt: 'e' }];
    expect(verifyCitations('依据充分 [S1]。', sources)).toBe('依据充分 [S1]。');
    const sanitized = verifyCitations('真实 [S1] 与虚构 [S4] 的结论。', sources);
    expect(sanitized).toContain('[S1]');
    expect(sanitized).not.toContain('[S4]');
    expect(sanitized).toContain('无法核对的引用标签');
  });

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

  it('grounds answers in accessible paper pages and drops invented source identifiers', async () => {
    const { ai, library, completion } = setup();
    await ai.saveProvider(profile, 'session-key');
    const paper = await library.importPdf(pdf, 'paper.pdf');
    completion.mockResolvedValueOnce('注意力有助于学习。[S1]');
    const answer = await ai.ask('学习结论是什么？', { paperIds: [paper.id] });
    expect(answer.sources).toEqual([expect.objectContaining({ paperId: paper.id, page: 1, label: 'S1' })]);
    expect(completion.mock.calls.at(-1)?.[2][0].content).toContain('不可信');
    completion.mockResolvedValueOnce('这是虚构引用 [S99]，其余结论仍然成立。');
    const sanitized = await ai.ask('结论', { paperIds: [paper.id] });
    expect(sanitized.text).toContain('这是虚构引用');
    expect(sanitized.text).not.toContain('[S99]');
    expect(sanitized.text).toContain('无法核对的引用标签');
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
    const first = ai.ask('结论', { paperIds: [paper.id] });
    const cancelled = expect(first).rejects.toThrow('取消');
    await expect(ai.ask('另一个问题', { paperIds: [paper.id] })).rejects.toThrow('等待');
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
    const answer = await ai.ask('What does the study report about memory consolidation?', { paperIds: [paper.id] });
    expect(answer.sources[0]).toMatchObject({ page: 3 });
    expect(answer.sources[0].excerpt).toContain('Memory consolidation improves after sleep.');
    ai.dispose();
  });
});
