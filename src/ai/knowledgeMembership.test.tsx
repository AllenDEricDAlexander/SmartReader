import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import type { LibraryStorage } from '../library/libraryStorage';
import { AiAssistant } from './AiAssistant';
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

function ask(question: string) {
  fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^(检索并提问|发送问题)$/ }));
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); });

describe('AI knowledge membership', () => {
  it('removes a selected file without changing its library contents or widening the selected scope', async () => {
    const { library, ai, paper } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond knowledge paper'), 'second.pdf');
    await library.editMetadata(second.id, { title: '另一篇论文' });
    await library.updatePaper(paper.id, { favorite: true, readingSeconds: 120 });
    const before = structuredClone(library.getPaper(paper.id)!);
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '移除知识库文件 知识库论文' }));
    await screen.findByText('文件已从 AI 知识库移除，文献库中的文献和原始 PDF 均保留。');
    expect(library.getPaper(paper.id)).toEqual({ ...before, knowledgeExcluded: true, updatedAt: expect.any(String) });
    expect(Array.from(await library.readPdf(paper.id))).toEqual(Array.from(pdf));
    expect(library.search('Attention').map((hit) => hit.paperId)).toContain(paper.id);
    expect(screen.getByText('1 份可检索 · 已选范围 0 份')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 另一篇论文' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    ai.dispose();
  });

  it('persists removal across a new library instance and lets an empty knowledge base chat directly', async () => {
    const { library, ai, paper, storage } = await setup();
    const panel = render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '移除知识库文件 知识库论文' }));
    await screen.findByText(/文件已从 AI 知识库移除/);
    expect(screen.queryByRole('checkbox', { name: '选择知识库文件 知识库论文' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '直接与模型对话' })).toBeChecked();
    panel.unmount();
    ai.dispose();

    const reopened = new LibraryService(storage, extraction);
    await reopened.initialize();
    const completion = vi.fn().mockResolvedValue('普通对话回答');
    const restarted = new AiService(reopened, completion);
    expect((await restarted.ask('普通问题')).retrieval).toBe('none');
    render(<AiAssistant library={reopened} ai={restarted} onOpenPaper={vi.fn()} />);
    expect(screen.getByText('已移除文件（1）')).toBeInTheDocument();
    expect(reopened.getPaper(paper.id)?.knowledgeExcluded).toBe(true);
    expect(completion.mock.calls[0][2][1].content).toBe('普通问题');
    restarted.dispose();
  });

  it('rejoins removed files from the library without importing another PDF', async () => {
    const { library, ai, paper, files } = await setup();
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByText('已移除文件（1）'));
    fireEvent.click(screen.getByRole('button', { name: '重新加入知识库文件 知识库论文' }));
    await screen.findByText('文件已重新加入知识库。');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 知识库论文' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '检索本地文献并附来源' })).toBeChecked();
    expect(screen.queryByText('已移除文件（1）')).not.toBeInTheDocument();
    expect(library.getView().papers).toHaveLength(1);
    expect(files.size).toBe(1);
    ask('Attention');
    await screen.findByText('研究结论。[S1]');
    ai.dispose();
  });

  it('restores a removed PDF when the same contents are added again', async () => {
    const { library, ai, paper } = await setup();
    await library.batchUpdate([paper.id], { knowledgeExcluded: true });
    const onAddPdfs = vi.fn(async () => [(await library.importPdf(pdf, 'renamed.pdf')).id]);
    render(<AiAssistant library={library} ai={ai} onAddPdfs={onAddPdfs} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '添加本地 PDF' }));
    await screen.findByText(/已添加 1 份知识库文件/);
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 知识库论文' })).toBeChecked();
    expect(library.getPaper(paper.id)?.knowledgeExcluded).toBe(false);
    expect(library.getView().papers).toHaveLength(1);
    ai.dispose();
  });

  it('keeps a file included when saving the removal fails and allows retry', async () => {
    const { library, ai, paper, storage } = await setup();
    vi.spyOn(storage, 'commit').mockRejectedValueOnce(new Error('保存失败'));
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '移除知识库文件 知识库论文' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(library.getPaper(paper.id)?.knowledgeExcluded).not.toBe(true);
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 知识库论文' })).toBeChecked();
    expect(screen.queryByText('已移除文件（1）')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除知识库文件 知识库论文' }));
    await screen.findByText(/文件已从 AI 知识库移除/);
    ai.dispose();
  });

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

  it('keeps finished answers visible without sending removed-file history into the next question', async () => {
    const { library, ai, paper, completion, streaming } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nconversation scope'), 'second.pdf');
    await library.editMetadata(second.id, { title: '保留论文' });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask('移除前的问题');
    await screen.findByText('研究结论。[S1]');
    fireEvent.click(screen.getByRole('button', { name: '移除知识库文件 知识库论文' }));
    await screen.findByText(/文件已从 AI 知识库移除/);
    expect(screen.getByText('研究结论。[S1]')).toBeInTheDocument();
    completion.mockResolvedValue('新范围的回答。[S1]');
    ask('移除后的问题');
    await screen.findByText('新范围的回答。[S1]');
    const messages = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(messages)).not.toContain('移除前的问题');
    expect(JSON.parse(messages[1].content).sources.every((source: { paperId: string }) => source.paperId === second.id)).toBe(true);
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
