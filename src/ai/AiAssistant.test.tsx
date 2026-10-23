import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryService } from '../library/libraryService';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import { AiService, type AiAnswer } from './aiService';
import { AiAssistant } from './AiAssistant';

async function setup(configured = true) {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const library = new LibraryService({
    load: async () => ({ revision, data: structuredClone(data) }),
    commit: async (_expected, next, writes) => {
      for (const write of writes) write.bytes ? files.set(write.id, write.bytes.slice()) : files.delete(write.id);
      data = structuredClone(next);
      return ++revision;
    },
    readFile: async (id) => files.get(id)!.slice(),
  }, async () => ({
    metadata: emptyMetadata('认知神经论文'),
    pages: [{ page: 1, text: 'Attention improves memory and learning.' }], pageCount: 1,
  }));
  const completion = vi.fn().mockResolvedValue('注意力可以改善记忆。[S1]');
  // The panel always asks for deltas, so streaming is stubbed to the same answer
  // the synchronous mock returns unless a test drives it itself.
  const streaming = vi.fn(async (_provider: unknown, _key: unknown, messages: unknown, options: { onDelta?(text: string): void }) => {
    const text = await completion(_provider, _key, messages, options) as string;
    options.onDelta?.(text);
    return text;
  });
  const ai = new AiService(library, completion, {}, streaming as never);
  if (configured) await ai.saveProvider({ name: '研究服务', baseUrl: 'https://api.example.com/v1', model: 'selected-model' }, 'session-key');
  const paper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nassistant fixture'), 'paper.pdf');
  return { library, ai, paper, completion, streaming };
}

function ask(question = '注意力的结论是什么？') {
  fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^(检索并提问|发送问题)$/ }));
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('AI research assistant', () => {
  it.each(['library', 'direct'] as const)('keeps chat, drafts and follow-up context across provider and model switches in %s mode', async (mode) => {
    const { library, ai, paper, completion } = await setup();
    const first = library.getView().snapshot.ai.providers[0];
    await ai.saveProvider({ ...first, models: ['selected-model', 'fast-model'] });
    const second = await ai.saveProvider({ name: '第二厂商', baseUrl: 'https://second.example/v1', model: 'second-model', models: ['second-fast'] }, 'second-key');
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    if (mode === 'direct') fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    expect(screen.getByLabelText('AI 厂商')).toHaveValue(first.id);
    expect(screen.getByLabelText('聊天模型')).toHaveValue('selected-model');
    completion.mockResolvedValueOnce('切换前的回答。');
    ask('切换前的问题');
    await screen.findByText('切换前的回答。');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '使用快模型追问' } });
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByText('切换前的问题')).toBeInTheDocument();
    expect(screen.getByText('切换前的回答。')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('使用快模型追问');
    completion.mockResolvedValueOnce('快模型的回答。');
    fireEvent.click(screen.getByRole('button', { name: mode === 'direct' ? '发送问题' : '检索并提问' }));
    await screen.findByText('快模型的回答。');
    expect(completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: first.id, model: 'fast-model' }), 'session-key']);
    const modelFollowup = completion.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(modelFollowup.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(modelFollowup.slice(1, 3)).toEqual([{ role: 'user', content: '切换前的问题' }, { role: 'assistant', content: '切换前的回答。' }]);
    expect(screen.getByText(`研究服务 · fast-model · ${mode === 'direct' ? '未检索文献' : '本地全文检索'}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '使用第二家继续追问' } });
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: second.id } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('second-model'));
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'second-fast' } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('second-fast'));
    expect(screen.getByLabelText('科研问题')).toHaveValue('使用第二家继续追问');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    completion.mockResolvedValueOnce('第二厂商的回答。');
    fireEvent.click(screen.getByRole('button', { name: mode === 'direct' ? '发送问题' : '检索并提问' }));
    await screen.findByText('第二厂商的回答。');
    expect(completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: second.id, baseUrl: second.baseUrl, model: 'second-fast' }), 'second-key']);
    const providerFollowup = completion.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(providerFollowup.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(providerFollowup.slice(1, 5)).toEqual([
      { role: 'user', content: '切换前的问题' }, { role: 'assistant', content: '切换前的回答。' },
      { role: 'user', content: '使用快模型追问' }, { role: 'assistant', content: '快模型的回答。' },
    ]);
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: first.id } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model'));
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: second.id } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('second-fast'));
    expect(screen.getByText('切换前的问题')).toBeInTheDocument();
    expect(screen.getByText('快模型的回答。')).toBeInTheDocument();
    expect(screen.getByText('第二厂商的回答。')).toBeInTheDocument();
    ai.dispose();
  });

  it('keeps the previous selection, completed answers and draft if a switch cannot be saved', async () => {
    const { library, ai } = await setup();
    const provider = library.getView().snapshot.ai.providers[0];
    await ai.saveProvider({ ...provider, models: ['fast-model'] });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '尚未发送的草稿' } });
    vi.spyOn(library, 'saveAiSettings').mockRejectedValueOnce(new Error('磁盘写入失败'));
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘写入失败');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('selected-model');
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('尚未发送的草稿');
    ai.dispose();
  });

  it('disables concurrent UI actions while a model switch is being persisted', async () => {
    const { library, ai } = await setup();
    const provider = library.getView().snapshot.ai.providers[0];
    await ai.saveProvider({ ...provider, models: ['fast-model'] });
    const save = library.saveAiSettings.bind(library);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(library, 'saveAiSettings').mockImplementationOnce(async (settings) => { await gate; await save(settings); });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    expect(await screen.findByText('正在切换 AI 配置…')).toBeInTheDocument();
    expect(screen.getByLabelText('AI 厂商')).toBeDisabled();
    expect(screen.getByLabelText('聊天模型')).toBeDisabled();
    expect(screen.getByLabelText('科研问题')).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toBeEnabled());
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    ai.dispose();
  });

  it('lets users return to a ready provider after choosing a preset without an unlocked key', async () => {
    const { library, ai } = await setup();
    const first = library.getView().snapshot.ai.providers[0];
    const second = await ai.saveProvider({ name: '稍后配置密钥', baseUrl: 'https://later.example/v1', model: 'later-model' });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: second.id } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('later-model'));
    expect(screen.getByText(/先配置 AI 厂商/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    expect(screen.getByLabelText('AI 厂商')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: first.id } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('selected-model'));
    expect(screen.queryByText(/先配置 AI 厂商/)).not.toBeInTheDocument();
    ai.dispose();
  });

  it('shows the original model when opening a legacy provider without model presets', async () => {
    const { library, ai } = await setup();
    const { models: _models, ...legacy } = library.getView().snapshot.ai.providers[0];
    await library.saveAiSettings({ ...library.getView().snapshot.ai, providers: [legacy] });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    const selector = screen.getByLabelText('聊天模型');
    expect(selector).toHaveValue('selected-model');
    expect(selector.querySelectorAll('option')).toHaveLength(1);
    ask();
    await screen.findByText('注意力可以改善记忆。[S1]');
    ai.dispose();
  });

  it('answers from the selected paper and opens a verified citation at its page', async () => {
    const { library, ai, paper } = await setup();
    const onOpenPaper = vi.fn();
    const askSpy = vi.spyOn(ai, 'ask');
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={onOpenPaper} />);
    expect(screen.getByRole('radio', { name: '指定文件（可多选）' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    ask();
    await screen.findByText('注意力可以改善记忆。[S1]');
    expect(askSpy).toHaveBeenCalledWith('注意力的结论是什么？', expect.objectContaining({ paperIds: [paper.id], grounding: 'library' }));
    fireEvent.click(screen.getByRole('button', { name: /S1.*认知神经论文.*第 1 页/ }));
    expect(onOpenPaper).toHaveBeenCalledWith(paper.id, 1);
    ai.dispose();
  });

  it('guides users to settings before a provider and key are configured', async () => {
    const { library, ai } = await setup(false);
    const onOpenSettings = vi.fn();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(/先配置 AI 厂商/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '打开 AI 设置' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    ai.dispose();
  });

  it('explains missing cloud embeddings and keeps direct-chat actions accurate and usable', async () => {
    const { library, ai } = await setup();
    await ai.saveKnowledgeSettings('milvus', 'https://milvus.example.test', 'vector-token');
    expect(ai.getView().milvusReady).toBe(true);
    let finish!: (answer: AiAnswer) => void;
    const askSpy = vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('配置 Embedding 模型');
    expect(screen.getByText('云端 Milvus · 尚未配置 Embedding 模型，暂不可检索。')).toBeInTheDocument();
    expect(screen.queryByText(/当前使用本地全文检索/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '一般科研问题' } });
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送问题' })).toBeEnabled();
    expect(screen.getByText(/当前模式不检索文献或附带来源/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    expect(screen.getByText('正在生成回答…')).toBeInTheDocument();
    expect(screen.queryByText('正在检索文献并生成回答…')).not.toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith('一般科研问题', expect.objectContaining({ grounding: 'direct' }));
    await act(async () => { finish({ text: '普通对话回答', sources: [], providerName: '研究服务' }); });
    ai.dispose();
  });

  it('renders model output as plain text and displays request errors', async () => {
    const { library, ai, completion } = await setup();
    completion.mockResolvedValueOnce('<img src=x onerror=alert(1)> [S1]');
    const { container } = render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    await screen.findByText('<img src=x onerror=alert(1)> [S1]');
    expect(container.querySelector('img')).toBeNull();
    completion.mockRejectedValueOnce(new Error('请求被限流，请稍后重试。'));
    ask('第二个问题');
    expect(await screen.findByRole('alert')).toHaveTextContent('限流');
    ai.dispose();
  });

  it('shows cloud cleanup failures without blocking local questions', async () => {
    const { library, ai, completion } = await setup();
    const warning = '当前没有 Milvus 访问令牌，未能清理此前上传的云端向量，请在 Milvus 中确认并删除。';
    vi.spyOn(ai, 'getView').mockReturnValue({ ...ai.getView(), knowledgeCleanupError: warning });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(warning);
    ask();
    await screen.findByText('注意力可以改善记忆。[S1]');
    expect(completion).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(warning);
    ai.dispose();
  });

  it('immediately clears the answer, question and locked selection when a folder locks', async () => {
    const { library, ai, paper } = await setup();
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('私密论文问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    await act(async () => { await library.lockVault(vault.id); });
    expect(screen.queryByText('注意力可以改善记忆。[S1]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    expect(screen.queryByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /S1/ })).not.toBeInTheDocument();
    ai.dispose();
  });

  it('ignores late results after cancellation even if the request ignores abort', async () => {
    const { library, ai, paper } = await setup();
    let finish: (answer: AiAnswer) => void = () => undefined;
    vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const cancel = vi.spyOn(ai, 'cancelAnswer');
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    expect(screen.getByRole('button', { name: '取消回答' })).toBeInTheDocument();
    expect(screen.getByLabelText('AI 厂商')).toBeDisabled();
    expect(screen.getByLabelText('聊天模型')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消回答' }));
    expect(cancel).toHaveBeenCalled();
    await act(async () => { finish({ text: '迟到的私密回答', sources: [{ label: 'S1', paperId: paper.id, page: 1, title: '论文', excerpt: '私密摘录' }], providerName: '研究服务' }); });
    expect(screen.queryByText('迟到的私密回答')).not.toBeInTheDocument();
    expect(screen.queryByText('私密摘录')).not.toBeInTheDocument();
    ai.dispose();
  });

  it('uses the answer epoch to discard a response after lock and unlock', async () => {
    const { library, ai, paper } = await setup();
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    let finish: (answer: AiAnswer) => void = () => undefined;
    vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('保密问题');
    await act(async () => { await library.lockVault(vault.id); await library.unlockVault(vault.id, 'vault password'); });
    await act(async () => { finish({ text: '过期回答', sources: [], providerName: '研究服务' }); });
    expect(screen.queryByText('过期回答')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    ai.dispose();
  });

  it('cancels its outstanding request when unmounted', async () => {
    const { library, ai } = await setup();
    vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise(() => undefined));
    const cancel = vi.spyOn(ai, 'cancelAnswer');
    const rendered = render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    await waitFor(() => expect(ai.ask).toHaveBeenCalled());
    rendered.unmount();
    expect(cancel).toHaveBeenCalledOnce();
    ai.dispose();
  });

  it('adds local PDFs directly to knowledge and keeps the imported selection after library changes', async () => {
    const { library, ai, paper } = await setup();
    const onAddPdfs = vi.fn(async () => [paper.id, paper.id]);
    const askSpy = vi.spyOn(ai, 'ask');
    render(<AiAssistant library={library} ai={ai} onAddPdfs={onAddPdfs} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '添加本地 PDF' }));
    await screen.findByText(/已添加 1 份知识库文件/);
    await act(async () => { await library.updatePaper(paper.id, { favorite: true }); });
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    ask();
    await screen.findByText('注意力可以改善记忆。[S1]');
    expect(askSpy).toHaveBeenCalledWith('注意力的结论是什么？', expect.objectContaining({ paperIds: [paper.id] }));
    ai.dispose();
  });

  it('allows the first PDF to be added while an empty library defaults to direct chat', async () => {
    const { library, ai, paper } = await setup();
    await library.deletePapers([paper.id]);
    const onAddPdfs = vi.fn(async () => {
      const imported = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nfirst knowledge file'), 'first.pdf');
      return [imported.id];
    });
    render(<AiAssistant library={library} ai={ai} onAddPdfs={onAddPdfs} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '直接与模型对话' })).toBeChecked();
    const add = screen.getByRole('button', { name: '添加本地 PDF' });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await screen.findByText(/已添加 1 份知识库文件/);
    expect(onAddPdfs).toHaveBeenCalledOnce();
    expect(screen.getByRole('radio', { name: '检索本地文献并附来源' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    ai.dispose();
  });

  it('allows adding PDFs in direct chat while keeping retrieval controls disabled', async () => {
    const { library, ai, paper } = await setup();
    const onAddPdfs = vi.fn(async () => [paper.id]);
    render(<AiAssistant library={library} ai={ai} onAddPdfs={onAddPdfs} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    expect(screen.getByRole('button', { name: '添加本地 PDF' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重建向量索引' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '全部可检索文献' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '指定文件（可多选）' })).toBeDisabled();
    expect(screen.getByLabelText('搜索知识库文件')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '添加本地 PDF' }));
    await screen.findByText(/已添加 1 份知识库文件/);
    expect(screen.getByRole('radio', { name: '指定文件（可多选）' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    ai.dispose();
  });

  it('restricts answers to multiple selected files and never expands an empty selection to the whole library', async () => {
    const { library, ai, paper, completion } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond'), 'second.pdf');
    await library.editMetadata(second.id, { title: '教育论文' });
    const third = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nthird'), 'third.pdf');
    await library.editMetadata(third.id, { title: '未选择的论文' });
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 教育论文' }));
    ask('Summarize the findings');
    await screen.findByText('注意力可以改善记忆。[S1]');
    const payload = JSON.parse(completion.mock.calls.at(-1)![2][1].content);
    expect(new Set(payload.sources.map((source: { paperId: string }) => source.paperId))).toEqual(new Set([paper.id, second.id]));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 教育论文' }));
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    // The transcript is the conversation, so narrowing the scope to nothing
    // blocks the next question without erasing the answers already given.
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    ai.dispose();
  });

  it('marks PDFs without text as unavailable knowledge and says the answer is not grounded', async () => {
    const { library, ai, paper, completion } = await setup();
    completion.mockResolvedValue('没有文献依据的概述。');
    await library.editMetadata(paper.id, { abstract: '' });
    vi.spyOn(library, 'getView').mockReturnValue({ ...library.getView(), papers: [{ ...paper, pages: [], indexStatus: 'empty' }] });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '检索本地文献并附来源' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '直接与模型对话' })).toBeChecked();
    expect(screen.getByText(/知识库还没有可检索的文件/)).toBeInTheDocument();
    ask();
    await screen.findByText('没有文献依据的概述。');
    expect(screen.getByText(/未检索文献/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^S1/ })).not.toBeInTheDocument();
    ai.dispose();
  });

  it('keeps earlier turns and sends them as history on a follow-up', async () => {
    const { library, ai, paper, completion, streaming } = await setup();
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('第一个问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    completion.mockResolvedValue('追问的回答。[S1]');
    ask('那第二点呢？');
    await screen.findByText('追问的回答。[S1]');
    expect(screen.getByText('第一个问题')).toBeInTheDocument();
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    const messages = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1].content).toBe('第一个问题');
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    await waitFor(() => expect(screen.getByLabelText('科研问题')).toHaveValue(''));
    expect(screen.queryByText('第一个问题')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 第一个问题' })).toBeInTheDocument();
    ai.dispose();
  });

  it('restores completed turns, draft and multi-file scope after navigation without mixing direct-chat history', async () => {
    const { library, ai, paper, completion, streaming } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nnavigation second'), 'second.pdf');
    await library.editMetadata(second.id, { title: '另一份论文' });
    const first = render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 另一份论文' }));
    ask('保存的文献问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '未发送的追问' } });
    fireEvent.change(screen.getByLabelText('搜索知识库文件'), { target: { value: '论文' } });
    first.unmount();
    const restored = render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    expect(screen.getByText('保存的文献问题')).toBeInTheDocument();
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('未发送的追问');
    expect(screen.getByLabelText('搜索知识库文件')).toHaveValue('论文');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 另一份论文' })).toBeChecked();
    completion.mockResolvedValueOnce('导航后的追问回答。[S1]');
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('导航后的追问回答。[S1]');
    const followup = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(followup.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(followup[1].content).toBe('保存的文献问题');
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '普通对话草稿' } });
    restored.unmount();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '直接与模型对话' })).toBeChecked();
    expect(screen.getByLabelText('科研问题')).toHaveValue('普通对话草稿');
    completion.mockResolvedValueOnce('普通对话回答');
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText('普通对话回答');
    const direct = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(direct.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(direct)).not.toContain('保存的文献问题');
    ai.dispose();
  });

  it('respects a different incoming paper scope and keeps a new conversation empty after navigation', async () => {
    const { library, ai, paper, completion, streaming } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nnew scope'), 'second.pdf');
    await library.editMetadata(second.id, { title: '新范围论文' });
    const first = render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('旧论文问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    first.unmount();
    const next = render(<AiAssistant library={library} ai={ai} initialPaperId={second.id} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '检索本地文献并附来源' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 新范围论文' })).toBeChecked();
    completion.mockResolvedValueOnce('新论文回答。[S1]');
    ask('新论文问题');
    await screen.findByText('新论文回答。[S1]');
    const request = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(request.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.parse(request[1].content).sources.every((source: { paperId: string }) => source.paperId === second.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    await act(async () => { await ai.flushAssistantSession(); });
    next.unmount();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.queryByText('旧论文问题')).not.toBeInTheDocument();
    expect(screen.queryByText('新论文回答。[S1]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    ai.dispose();
  });

  it.each(['provider', 'model', 'edit model', 'configure key'] as const)('restores the saved conversation and can follow up after switching %s while unmounted', async (operation) => {
    const { library, ai, paper, completion } = await setup();
    const provider = library.getView().snapshot.ai.providers[0];
    await ai.saveProvider({ ...provider, models: ['fast-model'] });
    const other = await ai.saveProvider({ name: '另一厂商', baseUrl: 'https://other.example.com/v1', model: 'other-model' }, operation === 'configure key' ? undefined : 'other-key');
    const first = render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('保存的问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保存的追问草稿' } });
    fireEvent.change(screen.getByLabelText('搜索知识库文件'), { target: { value: '认知神经' } });
    first.unmount();
    const previous = ai.getAssistantSession()!;
    if (operation === 'provider') await ai.selectProvider(other.id);
    else if (operation === 'model') await ai.selectProvider(provider.id, 'fast-model');
    else if (operation === 'configure key') {
      await ai.selectProvider(other.id);
      await ai.saveProvider(other, 'other-key');
    } else await ai.saveProvider({ ...provider, model: 'fast-model' });
    expect(ai.getAssistantSession()).toEqual(previous);
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    expect(screen.getByText('保存的问题')).toBeInTheDocument();
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保存的追问草稿');
    expect(screen.getByLabelText('搜索知识库文件')).toHaveValue('认知神经');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' })).toBeChecked();
    completion.mockResolvedValueOnce('继续后的回答。[S1]');
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('继续后的回答。[S1]');
    expect(completion.mock.calls.at(-1)![0]).toMatchObject(operation === 'provider' || operation === 'configure key'
      ? { id: other.id, model: 'other-model' } : { id: provider.id, model: 'fast-model' });
    const request = completion.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(request.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(request[1].content).toBe('保存的问题');
    expect(request[2].content).toBe('注意力可以改善记忆。[S1]');
    expect(JSON.parse(request[3].content).question).toBe('保存的追问草稿');
    ai.dispose();
  });

  it.each(['lock', 'delete', 'forget key'] as const)('discards saved sensitive conversation while unmounted on %s', async (operation) => {
    const { library, ai, paper } = await setup();
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    const first = render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('保存的私密问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保存的私密草稿' } });
    first.unmount();
    const previous = ai.getAssistantSession()!;
    expect(previous.messages).toHaveLength(2);
    const provider = library.getView().snapshot.ai.activeProviderId!;
    if (operation === 'lock') await library.lockVault(vault.id);
    else if (operation === 'delete') await library.deletePapers([paper.id]);
    else await ai.forgetKey(provider);
    expect(ai.getAssistantSession()).toBeNull();
    ai.saveAssistantSession(previous);
    expect(ai.getAssistantSession()).toBeNull();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.queryByText('保存的私密问题')).not.toBeInTheDocument();
    expect(screen.queryByText('注意力可以改善记忆。[S1]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    ai.dispose();
  });

  it('restores only finished turns after navigation cancels a streaming answer and ignores its late result', async () => {
    const { library, ai, completion } = await setup();
    const first = render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask('完成的问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    let finish!: (answer: AiAnswer) => void;
    vi.spyOn(ai, 'ask').mockImplementationOnce((_question, options) => {
      options?.onDelta?.('离开前的部分回答');
      return new Promise((resolve) => { finish = resolve; });
    });
    ask('未完成的问题');
    await screen.findByText('离开前的部分回答');
    first.unmount();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    await act(async () => { finish({ text: '离开后的迟到回答', sources: [], providerName: '研究服务' }); });
    expect(screen.getByText('完成的问题')).toBeInTheDocument();
    expect(screen.queryByText('未完成的问题')).not.toBeInTheDocument();
    expect(screen.queryByText('离开前的部分回答')).not.toBeInTheDocument();
    expect(screen.queryByText('离开后的迟到回答')).not.toBeInTheDocument();
    completion.mockResolvedValueOnce('返回后可以继续提问。[S1]');
    ask('返回后的问题');
    await screen.findByText('返回后可以继续提问。[S1]');
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    ai.dispose();
  });

  it('keeps earlier answers visible without sending excluded-file history into a new scope', async () => {
    const { library, ai, paper, completion, streaming } = await setup();
    const second = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nother knowledge'), 'other.pdf');
    await library.editMetadata(second.id, { title: '另一份论文' });
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('第一份论文的问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 认知神经论文' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 另一份论文' }));
    completion.mockResolvedValue('另一份论文的结论。[S1]');
    ask('现在的论文呢？');
    await screen.findByText('另一份论文的结论。[S1]');
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    const messages = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(messages)).not.toContain('第一份论文的问题');
    expect(JSON.parse(messages[1].content).sources.every((source: { paperId: string }) => source.paperId === second.id)).toBe(true);
    ai.dispose();
  });

  it('does not send document conversation history when switching to direct chat', async () => {
    const { library, ai, paper, completion, streaming } = await setup();
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('文献中的私有问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    completion.mockResolvedValue('纯模型回答。');
    ask('一般科研问题');
    await screen.findByText('纯模型回答。');
    const messages = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(messages[1].content).toBe('一般科研问题');
    expect(JSON.stringify(messages)).not.toContain('文献中的私有问题');
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    ai.dispose();
  });

  it('omits an unsuccessful question and its partial answer from follow-up history', async () => {
    const { library, ai, completion, streaming } = await setup();
    streaming.mockImplementationOnce(async (_provider, _key, _messages, options: { onDelta?(text: string): void }) => {
      options.onDelta?.('未完成的回答');
      throw new Error('连接中断');
    });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask('未成功的问题');
    await screen.findByRole('alert');
    completion.mockResolvedValue('重试完成。[S1]');
    ask('重新提问');
    await screen.findByText('重试完成。[S1]');
    const messages = streaming.mock.calls.at(-1)![2] as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(messages)).not.toContain('未成功的问题');
    expect(JSON.stringify(messages)).not.toContain('未完成的回答');
    ai.dispose();
  });

  it('renders streamed text before the request finishes', async () => {
    const { library, ai, paper, streaming } = await setup();
    let release: () => void = () => undefined;
    streaming.mockImplementationOnce(async (_provider, _key, _messages, options: { onDelta?(text: string): void }) => {
      options.onDelta?.('部分回答…');
      await new Promise<void>((resolve) => { release = resolve; });
      return '部分回答…已完成。';
    });
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('流式问题');
    await screen.findByText('部分回答…');
    expect(screen.getByRole('button', { name: '取消回答' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续提问' })).not.toBeInTheDocument();
    await act(async () => { release(); });
    await screen.findByText('部分回答…已完成。');
    ai.dispose();
  });

  it('returns to the existing question input below the sticky header without losing the draft', async () => {
    const { library, ai } = await setup();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '继续提问' })).not.toBeInTheDocument();
    ask('第一个问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    const input = screen.getByLabelText('科研问题');
    fireEvent.change(input, { target: { value: '保留的追问草稿' } });
    const button = screen.getByRole('button', { name: '继续提问' });
    const header = button.closest('header')!;
    const viewport = screen.getByRole('region', { name: '让答案回到文献' });
    viewport.scrollTop = 1400;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 60 } as DOMRect);
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: -740 } as DOMRect);
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: 180 });
    let frame!: FrameRequestCallback;
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementationOnce((callback) => { frame = callback; return 1; });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '回到最新回答' })).toBeInTheDocument();
    act(() => { frame(0); });
    expect(viewport.scrollTop).toBe(388);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('保留的追问草稿');
    expect(screen.getByText('注意力可以改善记忆。[S1]')).toBeInTheDocument();
    animationFrame.mockRestore();
    ai.dispose();
  });

  it('pauses stream following while reading earlier text and resumes at the latest answer', async () => {
    const { library, ai } = await setup();
    let sendDelta: (text: string) => void = () => undefined;
    let finish!: (answer: AiAnswer) => void;
    vi.spyOn(ai, 'ask').mockImplementationOnce((_question, options) => {
      sendDelta = (text) => options?.onDelta?.(text);
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    const viewport = screen.getByRole('region', { name: '让答案回到文献' });
    let scrollHeight = 1600;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = Math.max(0, Math.min(value, scrollHeight - 600)); } },
    });
    ask('长回答');
    expect(scrollTop).toBe(1000);
    expect(screen.getByRole('button', { name: '取消回答' }).closest('header')).not.toBeNull();
    fireEvent.scroll(viewport, { target: { scrollTop: 300 } });
    expect(screen.getByRole('button', { name: '回到最新回答' })).toBeInTheDocument();
    scrollHeight = 1800;
    await act(async () => { sendDelta('继续生成的文本'); });
    expect(scrollTop).toBe(300);
    fireEvent.click(screen.getByRole('button', { name: '回到最新回答' }));
    expect(scrollTop).toBe(1200);
    expect(screen.queryByRole('button', { name: '回到最新回答' })).not.toBeInTheDocument();
    scrollHeight = 2000;
    await act(async () => { sendDelta('，更多文本'); });
    expect(scrollTop).toBe(1400);
    fireEvent.scroll(viewport, { target: { scrollTop: 300 } });
    fireEvent.scroll(viewport, { target: { scrollTop: 1390 } });
    expect(screen.queryByRole('button', { name: '回到最新回答' })).not.toBeInTheDocument();
    scrollHeight = 2200;
    await act(async () => { finish({ text: '完整回答', sources: [], providerName: '研究服务' }); });
    expect(scrollTop).toBe(1600);
    ai.dispose();
  });
});
