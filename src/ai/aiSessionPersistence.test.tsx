import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, type AiAssistantSession, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import type { LibraryStorage } from '../library/libraryStorage';
import { AiAssistant } from './AiAssistant';
import { AiService } from './aiService';
import type { requestCompletion, streamCompletion } from './openAiClient';

function memoryStorage() {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const storage: LibraryStorage = {
    load: vi.fn(async () => ({ revision, data: structuredClone(data) })),
    commit: vi.fn(async (expected, next, writes) => {
      if (expected !== revision) throw new Error('LIBRARY_CONFLICT');
      for (const write of writes) write.bytes ? files.set(write.id, write.bytes.slice()) : files.delete(write.id);
      data = structuredClone(next);
      return ++revision;
    }),
    readFile: async (id) => files.get(id)!.slice(),
  };
  return { storage, snapshot: () => structuredClone(data)! };
}

function services(storage: LibraryStorage) {
  const library = new LibraryService(storage, async () => ({
    metadata: emptyMetadata('恢复测试论文'), pages: [{ page: 1, text: 'Attention improves learning.' }], pageCount: 1,
  }));
  const completion = vi.fn<typeof requestCompletion>().mockResolvedValue('恢复后的回答。[S1]');
  const streaming = vi.fn<typeof streamCompletion>(async (provider, key, messages, options = {}) => {
    const text = await completion(provider, key, messages, { signal: options.signal });
    options.onReasoning?.('模型思考');
    options.onDelta?.(text);
    return text;
  });
  const ai = new AiService(library, completion, {}, streaming);
  return { library, ai, completion, streaming };
}

async function setup() {
  const backend = memoryStorage();
  const app = services(backend.storage);
  const provider = await app.ai.saveProvider({ name: '恢复测试厂商', baseUrl: 'https://example.test/v1', model: 'chat-model', models: ['fast-model'] }, 'fixture-device-key', undefined, true);
  const paper = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nrestart fixture'), 'paper.pdf');
  await app.ai.loadAssistantSession();
  return { ...app, ...backend, provider, paper };
}

function session(ai: AiService, draft = '追问草稿'): AiAssistantSession {
  return {
    epoch: ai.getView().answerEpoch,
    messages: [
      { id: 1, contextKey: 'direct', role: 'user', content: '原来的问题' },
      { id: 2, contextKey: 'direct', role: 'assistant', content: '原来的回答' },
    ],
    draft, scope: 'all', selectedPaperIds: [], fileQuery: '', mode: 'direct',
  };
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^(检索并提问|发送问题)$/ }));
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); });

describe('local AI conversation persistence', () => {
  it('restores chat, citations, reasoning, drafts, file scope and the selected model in a fresh app and continues the conversation', async () => {
    const app = await setup();
    const first = render(<AiAssistant library={app.library} ai={app.ai} initialPaperId={app.paper.id} onOpenPaper={vi.fn()} />);
    app.completion.mockResolvedValueOnce('首次保存的回答。[S1]');
    ask('首次保存的问题');
    await screen.findByText('首次保存的回答。[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '重启后继续解释' } });
    fireEvent.change(screen.getByLabelText('搜索知识库文件'), { target: { value: '恢复' } });
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    await act(async () => { await app.ai.flushAssistantSession(); });
    first.unmount();
    app.ai.dispose();

    const restarted = services(app.storage);
    const open = vi.fn();
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={open} />);
    await screen.findByText('首次保存的问题');
    expect(screen.getByText('首次保存的回答。[S1]')).toBeInTheDocument();
    expect(screen.getByText('模型思考')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('重启后继续解释');
    expect(screen.getByLabelText('搜索知识库文件')).toHaveValue('恢复');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 恢复测试论文' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /S1.*恢复测试论文.*第 1 页/ }));
    expect(open).toHaveBeenCalledWith(app.paper.id, 1);
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('恢复后的回答。[S1]');
    const request = restarted.completion.mock.calls[0];
    expect(request.slice(0, 2)).toEqual([expect.objectContaining({ id: app.provider.id, model: 'fast-model' }), 'fixture-device-key']);
    expect(request[2].map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(request[2][1].content).toBe('首次保存的问题');
    expect(request[2][2].content).toBe('首次保存的回答。[S1]');
    expect(JSON.parse(request[2][3].content)).toMatchObject({ question: '重启后继续解释', sources: [expect.objectContaining({ paperId: app.paper.id })] });
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('does not overwrite a saved conversation with empty state while local storage is still loading', async () => {
    const app = await setup();
    app.ai.saveAssistantSession(session(app.ai));
    await app.ai.flushAssistantSession();
    app.ai.dispose();
    const saved = app.snapshot().aiSession;
    const load = app.storage.load.bind(app.storage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(app.storage, 'load').mockImplementationOnce(async () => { await gate; return load(); });
    const commit = vi.spyOn(app.storage, 'commit');
    commit.mockClear();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在恢复本地聊天记录');
    expect(commit).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await screen.findByText('原来的问题');
    expect(screen.getByLabelText('科研问题')).toHaveValue('追问草稿');
    expect(app.snapshot().aiSession).toEqual(saved);
    expect(commit).not.toHaveBeenCalled();
    restarted.ai.dispose();
  });

  it('keeps the last persisted chat on a failed save and retries the latest draft', async () => {
    const app = await setup();
    app.ai.saveAssistantSession(session(app.ai, '旧草稿'));
    await app.ai.flushAssistantSession();
    const saved = app.snapshot().aiSession;
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    const failure = vi.spyOn(app.storage, 'commit').mockRejectedValue(new Error('disk full'));
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '最新草稿' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('聊天记录未能保存到本地');
    expect(app.snapshot().aiSession).toEqual(saved);
    failure.mockImplementation(commit);
    fireEvent.click(screen.getByRole('button', { name: '重试保存对话' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await act(async () => { await app.ai.flushAssistantSession(); });
    expect(await app.library.loadAiAssistantSession()).toMatchObject({ draft: '最新草稿' });
    app.ai.dispose();
  });

  it('reports a restore failure and leaves the saved data intact until a retry succeeds', async () => {
    const app = await setup();
    app.ai.saveAssistantSession(session(app.ai));
    await app.ai.flushAssistantSession();
    app.ai.dispose();
    vi.spyOn(app.storage, 'load').mockRejectedValueOnce(new Error('storage unavailable'));
    const commit = vi.spyOn(app.storage, 'commit');
    commit.mockClear();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法恢复本地聊天记录');
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试恢复对话' }));
    await screen.findByText('原来的问题');
    expect(screen.getByLabelText('科研问题')).toHaveValue('追问草稿');
    restarted.ai.dispose();
  });

  it('finishes queued draft writes in order and saves the newest version before shutdown', async () => {
    const app = await setup();
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writes = vi.spyOn(app.storage, 'commit').mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    writes.mockClear();
    app.ai.saveAssistantSession(session(app.ai, '第一版'));
    await waitFor(() => expect(writes).toHaveBeenCalledOnce());
    app.ai.saveAssistantSession(session(app.ai, '第二版'));
    app.ai.saveAssistantSession(session(app.ai, '最终版'));
    release();
    await app.ai.flushAssistantSession();
    expect(await app.library.loadAiAssistantSession()).toMatchObject({ draft: '最终版' });
    app.ai.dispose();
  });

  it('waits for an in-progress model selection before shutdown without changing the stored chat', async () => {
    const app = await setup();
    app.ai.saveAssistantSession(session(app.ai));
    await app.ai.flushAssistantSession();
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writes = vi.spyOn(app.storage, 'commit').mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    writes.mockClear();
    const selecting = app.ai.selectProvider(app.provider.id, 'fast-model');
    let closed = false;
    const closing = app.ai.flushAssistantSession().then(() => { closed = true; });
    await waitFor(() => expect(writes).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    release();
    await Promise.all([selecting, closing]);
    expect(app.snapshot().ai.providers[0].model).toBe('fast-model');
    expect(await app.library.loadAiAssistantSession()).toMatchObject({ draft: '追问草稿' });
    app.ai.dispose();
  });

  it('does not overwrite a malformed stored conversation or prevent unrelated library updates', async () => {
    const app = await setup();
    app.ai.saveAssistantSession(session(app.ai));
    await app.ai.flushAssistantSession();
    app.ai.dispose();
    const stored = await app.storage.load();
    const damaged = { kind: 'plain', paperIds: 'invalid', session: { messages: 'invalid' } } as unknown as LibrarySnapshot['aiSession'];
    stored.data!.aiSession = damaged;
    await app.storage.commit(stored.revision, stored.data!, []);
    const writes = vi.spyOn(app.storage, 'commit');
    writes.mockClear();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('本地聊天记录格式无效');
    expect(writes).not.toHaveBeenCalled();
    await act(async () => { await restarted.library.savePreferences({ previewMode: 'off' }); });
    expect(app.snapshot().aiSession).toEqual(damaged);
    await expect(restarted.ai.flushAssistantSession()).rejects.toThrow('本地聊天记录格式无效');
    restarted.ai.dispose();
  });

  it('keeps the full transcript across restart while bounding the history sent on the next request', async () => {
    const app = await setup();
    const saved = session(app.ai, '继续最后一个话题');
    saved.messages = Array.from({ length: 30 }, (_, index) => [
      { id: index * 2 + 1, contextKey: 'direct', role: 'user' as const, content: `历史问题${index}` },
      { id: index * 2 + 2, contextKey: 'direct', role: 'assistant' as const, content: `历史回答${index}` },
    ]).flat();
    app.ai.saveAssistantSession(saved);
    await app.ai.flushAssistantSession();
    app.ai.dispose();
    const restarted = services(app.storage);
    restarted.completion.mockResolvedValue('继续回答');
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('历史问题0');
    expect(screen.getByText('历史回答29')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await screen.findByText('继续回答');
    const request = restarted.completion.mock.calls[0][2];
    expect(request).toHaveLength(22);
    expect(JSON.stringify(request)).not.toContain('历史问题0');
    expect(JSON.stringify(request)).toContain('历史回答29');
    expect(screen.getByText('历史问题0')).toBeInTheDocument();
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('restores only completed turns after closing during a streaming response', async () => {
    const app = await setup();
    const first = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('已经完成的问题');
    await screen.findByText('恢复后的回答。[S1]');
    let finish!: () => void;
    app.streaming.mockImplementationOnce(async (_provider, _key, _messages, options = {}) => {
      options.onDelta?.('未完成的部分回答');
      return new Promise<string>((resolve) => { finish = () => { options.onDelta?.('迟到的内容'); resolve('迟到的完整回答'); }; });
    });
    ask('未完成的问题');
    await screen.findByText('未完成的部分回答');
    await act(async () => { await app.ai.flushAssistantSession(); });
    first.unmount();
    app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('已经完成的问题');
    expect(screen.queryByText('未完成的问题')).not.toBeInTheDocument();
    expect(screen.queryByText('未完成的部分回答')).not.toBeInTheDocument();
    await act(async () => { finish(); });
    expect(screen.queryByText('迟到的完整回答')).not.toBeInTheDocument();
    restarted.ai.dispose();
  });

  it('encrypts a conversation spanning multiple private folders and restores it only after all are unlocked', async () => {
    const app = await setup();
    const second = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nsecond private paper'), 'second.pdf');
    const vaults: string[] = [];
    for (const [index, paper] of [app.paper, second].entries()) {
      const folder = await app.library.createFolder(`加密文件夹${index}`);
      await app.library.categorize([paper.id], [folder.id], 'move');
      vaults.push((await app.library.encryptFolder(folder.id, 'private password')).id);
    }
    await app.ai.flushAssistantSession();
    const saved = session(app.ai, 'PRIVATE-DRAFT');
    saved.scope = 'selected';
    saved.selectedPaperIds = [app.paper.id, second.id];
    saved.mode = 'library';
    saved.messages = saved.messages.map((message) => ({ ...message, content: `PRIVATE-${message.role}`, contextKey: JSON.stringify([...saved.selectedPaperIds].sort()) }));
    app.ai.saveAssistantSession(saved);
    await app.ai.flushAssistantSession();
    expect(app.snapshot().aiSession).toMatchObject({ kind: 'encrypted', vaultIds: vaults });
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE-');
    const stored = app.snapshot().aiSession;
    app.ai.dispose();

    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText(/已保存的对话涉及加密文献/);
    expect(screen.queryByText('PRIVATE-user')).not.toBeInTheDocument();
    expect(app.snapshot().aiSession).toEqual(stored);
    await act(async () => { await restarted.library.unlockVault(vaults[0], 'private password'); });
    expect(screen.getByText(/已保存的对话涉及加密文献/)).toBeInTheDocument();
    await act(async () => { await restarted.library.unlockVault(vaults[1], 'private password'); });
    await screen.findByText('PRIVATE-user');
    expect(screen.getByLabelText('科研问题')).toHaveValue('PRIVATE-DRAFT');
    expect(restarted.ai.getAssistantSession()?.messages).toEqual(saved.messages);
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('恢复后的回答。[S1]');
    expect(restarted.completion.mock.calls[0][2].slice(1, 3)).toEqual([
      { role: 'user', content: 'PRIVATE-user' }, { role: 'assistant', content: 'PRIVATE-assistant' },
    ]);
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE-');
    restarted.ai.dispose();
  });

  it('clears stored context on a new conversation and does not resurrect the previous chat after restart', async () => {
    const app = await setup();
    app.ai.saveAssistantSession(session(app.ai));
    await app.ai.flushAssistantSession();
    const panel = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount();
    app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByLabelText('科研问题');
    expect(screen.queryByText('原来的问题')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    restarted.ai.dispose();
  });

  it.each(['encrypt', 'delete', 'lock'] as const)('removes persisted sensitive context atomically or on flush when papers %s', async (operation) => {
    const app = await setup();
    const folder = await app.library.createFolder('受保护的论文');
    await app.library.categorize([app.paper.id], [folder.id], 'move');
    const vault = operation === 'lock' ? await app.library.encryptFolder(folder.id, 'private password') : null;
    await app.ai.flushAssistantSession();
    const saved = session(app.ai, 'PRIVATE-HISTORY-DRAFT');
    saved.mode = 'library';
    saved.selectedPaperIds = [app.paper.id];
    saved.messages = saved.messages.map((message) => ({ ...message, contextKey: JSON.stringify([app.paper.id]) }));
    app.ai.saveAssistantSession(saved);
    await app.ai.flushAssistantSession();
    if (operation === 'encrypt') await app.library.encryptFolder(folder.id, 'private password');
    else if (operation === 'delete') await app.library.deletePapers([app.paper.id]);
    else await app.library.lockVault(vault!.id);
    if (operation !== 'lock') expect(app.snapshot().aiSession).toBeNull();
    app.ai.saveAssistantSession(saved);
    await app.ai.flushAssistantSession();
    expect(app.snapshot().aiSession).toBeNull();
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE-HISTORY-DRAFT');
    app.ai.dispose();
  });
});
