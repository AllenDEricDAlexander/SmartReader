import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import type { LibraryStorage } from '../library/libraryStorage';
import { AiAssistant } from './AiAssistant';
import { AiService } from './aiService';
import type { requestCompletion, streamCompletion } from './openAiClient';

function services(storage: LibraryStorage) {
  const library = new LibraryService(storage, async (bytes) => ({
    metadata: emptyMetadata(new TextDecoder().decode(bytes).includes('paper-A') ? '论文甲' : '论文乙'),
    pages: [{ page: 1, text: 'Research evidence for the question.' }], pageCount: 1,
  }));
  const completion = vi.fn<typeof requestCompletion>(async (_provider, _key, messages) => {
    const text = messages.at(-1)!.content;
    return text.startsWith('{') ? `${JSON.parse(text).question}回答[S1]` : `${text}回答`;
  });
  const streaming = vi.fn<typeof streamCompletion>(async (provider, key, messages, options = {}) => {
    const answer = await completion(provider, key, messages, { signal: options.signal });
    options.onDelta?.(answer);
    return answer;
  });
  const ai = new AiService(library, completion, {}, streaming);
  return { library, ai, completion };
}

async function setup() {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const storage: LibraryStorage = {
    load: async () => ({ revision, data: structuredClone(data) }),
    commit: vi.fn(async (expected, next, writes) => {
      if (expected !== revision) throw new Error('LIBRARY_CONFLICT');
      for (const write of writes) write.bytes ? files.set(write.id, write.bytes.slice()) : files.delete(write.id);
      data = structuredClone(next);
      return ++revision;
    }),
    readFile: async (id) => files.get(id)!.slice(),
  };
  const app = services(storage);
  await app.ai.saveProvider({ name: '研究厂商', baseUrl: 'https://example.test/v1', model: 'chat-model' }, 'fixture-key', undefined, true);
  const first = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\npaper-A'), 'a.pdf');
  const second = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\npaper-B'), 'b.pdf');
  await app.ai.loadAssistantSession();
  return { ...app, first, second, storage, snapshot: () => structuredClone(data)! };
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /^(检索并提问|发送问题)$/ }));
}

async function createConversation() {
  fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
  await waitFor(() => expect(screen.getByLabelText('科研问题')).toHaveValue(''));
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('AI conversation history UI', () => {
  it('pins an older history above recent chats and search results, then restores it after restarting', async () => {
    const app = await setup();
    const panel = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('常用课题');
    await screen.findByText('常用课题回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '常用课题追问' } });
    await createConversation();
    ask('当前课题');
    await screen.findByText('当前课题回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '当前草稿' } });
    const recentOrder = screen.getAllByRole('button', { name: /^打开会话 / }).map((button) => button.getAttribute('aria-label'));
    expect(recentOrder).toEqual(['打开会话 当前课题', '打开会话 常用课题']);
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 常用课题', pressed: false }));
    await screen.findByRole('button', { name: '取消置顶会话 常用课题', pressed: true });
    expect(screen.getByText('已置顶 1/10')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用课题');
    expect(screen.getByText('当前课题回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('当前草稿');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '课题' } });
    await screen.findByText('找到 2 个会话');
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用课题');
    fireEvent.click(screen.getByRole('button', { name: '取消置顶会话 常用课题' }));
    await screen.findByText('已置顶 0/10');
    await screen.findByText('找到 2 个会话');
    expect(screen.getAllByRole('button', { name: /^打开会话 / }).map((button) => button.getAttribute('aria-label'))).toEqual(recentOrder);
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 常用课题' }));
    await screen.findByText('已置顶 1/10');
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount();
    app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('当前课题回答[S1]');
    expect(screen.getByRole('button', { name: '取消置顶会话 常用课题', pressed: true })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用课题');
    expect(screen.getByLabelText('科研问题')).toHaveValue('当前草稿');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 常用课题' }));
    await screen.findByText('常用课题回答[S1]');
    expect(screen.getByLabelText('科研问题')).toHaveValue('常用课题追问');
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('常用课题追问回答[S1]');
    const sent = restarted.completion.mock.calls[0][2];
    expect(sent.map((message) => message.content)).toContain('常用课题');
    expect(JSON.stringify(sent)).not.toContain('当前课题');
    await createConversation();
    expect(screen.getByRole('button', { name: '置顶会话 新对话', pressed: false })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用课题');
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('counts all ten pins while searching and frees a slot when unpinning or deleting a pinned chat', async () => {
    const app = await setup();
    const ids = [];
    for (let index = 1; index <= 12; index += 1) {
      if (index > 1) await app.ai.createConversation();
      const id = app.ai.getView().activeConversationId!;
      ids.push(id);
      await app.ai.renameConversation(id, `课题${index}`);
      if (index <= 10) await app.ai.setConversationPinned(id, true);
    }
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByText('已置顶 10/10')).toBeInTheDocument();
    expect(screen.getByText('置顶已达上限，请先取消其他会话的置顶。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '置顶会话 课题11' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消置顶会话 课题1' })).toBeEnabled();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '课题11' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '置顶会话 课题11' })).toBeDisabled();
    expect(screen.getByText('已置顶 10/10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消置顶会话 课题1' }));
    await screen.findByText('已置顶 9/10');
    expect(screen.getByRole('button', { name: '置顶会话 课题11' })).toBeEnabled();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '课题11' } });
    await screen.findByText('找到 1 个会话');
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 课题11' }));
    await screen.findByText('已置顶 10/10');
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '取消置顶会话 课题11' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '删除会话 课题11' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await screen.findByText('已置顶 9/10');
    await screen.findByText('没有匹配的会话。');
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    expect(await screen.findByRole('button', { name: '置顶会话 课题12' })).toBeEnabled();
    expect(app.ai.getView().activeConversationId).toBe(ids[11]);
    expect(app.ai.getView().conversations?.filter((entry) => entry.pinned)).toHaveLength(9);
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it.each([true, false])('keeps the original pin and chat on a failed pinned=%s update and supports retrying', async (pinned) => {
    const app = await setup();
    const id = app.ai.getView().activeConversationId!;
    await app.ai.setConversationPinned(id, !pinned);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('保留的聊天');
    await screen.findByText('保留的聊天回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留的草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    const action = `${pinned ? '置顶' : '取消置顶'}会话 保留的聊天`;
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('置顶状态保存失败'));
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(await screen.findByRole('alert')).toHaveTextContent('置顶状态保存失败');
    expect(screen.getByRole('button', { name: action, pressed: !pinned })).toBeEnabled();
    expect(screen.getByText('保留的聊天回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留的草稿');
    expect(app.snapshot().aiConversations).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByRole('button', { name: `${pinned ? '取消置顶' : '置顶'}会话 保留的聊天`, pressed: pinned });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留的草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('renames the current history and restores its name, model, draft and context after restarting', async () => {
    const app = await setup();
    const provider = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...provider, models: ['chat-model', 'fast-model'] });
    const panel = render(<AiAssistant library={app.library} ai={app.ai} initialPaperId={app.first.id} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    ask('命名前的问题');
    await screen.findByText('命名前的问题回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留的追问草稿' } });
    fireEvent.change(screen.getByLabelText('搜索知识库文件'), { target: { value: '甲' } });
    fireEvent.click(screen.getByRole('button', { name: '重命名会话 命名前的问题' }));
    expect(screen.getByLabelText('会话名称')).toHaveValue('命名前的问题');
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '研究课题 第一阶段' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: '重命名历史会话' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '打开会话 研究课题 第一阶段' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('命名前的问题回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留的追问草稿');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount();
    app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('命名前的问题回答[S1]');
    expect(screen.getByRole('button', { name: '打开会话 研究课题 第一阶段' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留的追问草稿');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByLabelText('搜索知识库文件')).toHaveValue('甲');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文甲' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('保留的追问草稿回答[S1]');
    expect(restarted.completion.mock.calls[0][0].model).toBe('fast-model');
    expect(restarted.completion.mock.calls[0][2].map((message) => message.content)).toContain('命名前的问题');
    expect(screen.getByRole('button', { name: '打开会话 研究课题 第一阶段' })).toBeInTheDocument();
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('cancels a rename and prevents submitting an empty name without touching the history', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    fireEvent.click(screen.getByRole('button', { name: '重命名会话 新对话' }));
    expect(screen.getByLabelText('会话名称')).toHaveFocus();
    expect(screen.getByLabelText('会话名称')).toHaveAttribute('maxlength', '100');
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '保存名称' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('会话名称'), { key: 'Escape' });
    expect(screen.queryByLabelText('会话名称')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重命名会话 新对话' }));
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '尚未保存的名称' } });
    fireEvent.click(within(screen.getByRole('form', { name: '重命名历史会话' })).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '打开会话 新对话' })).toBeInTheDocument();
    expect(app.snapshot().aiConversations).toEqual(before);
    app.ai.dispose();
  });

  it('renames and deletes a filtered inactive history while retaining the active conversation', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('历史目标');
    await screen.findByText('历史目标回答[S1]');
    await createConversation();
    ask('正在使用');
    await screen.findByText('正在使用回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '当前草稿' } });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '历史目标' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.queryByRole('button', { name: '打开会话 正在使用' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重命名会话 历史目标' }));
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '项目 Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await screen.findByRole('button', { name: '打开会话 项目 Alpha' });
    expect(screen.getByText('正在使用回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('当前草稿');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '  aLPHa  ' } });
    await screen.findByText('找到 1 个会话');
    fireEvent.click(screen.getByRole('button', { name: '删除会话 项目 Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await screen.findByText('没有匹配的会话。');
    expect(screen.getByText('正在使用回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('当前草稿');
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    expect(await screen.findByRole('button', { name: '打开会话 正在使用' })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: '打开会话 项目 Alpha' })).not.toBeInTheDocument();
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('finds older answer text and later questions, then continues with only that conversation context', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    app.completion.mockResolvedValueOnce('Neural NETWORKS 独有证据[S1]');
    ask('最早的问题');
    await screen.findByText('Neural NETWORKS 独有证据[S1]');
    ask('后来追问的关键词');
    await screen.findByText('后来追问的关键词回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '原会话草稿' } });
    await createConversation();
    ask('另一个会话的问题');
    await screen.findByText('另一个会话的问题回答[S1]');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: ' neural networks ' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.queryByRole('button', { name: '打开会话 另一个会话的问题' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '后来追问的关键词' } });
    await screen.findByText('找到 1 个会话');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 最早的问题' }));
    await screen.findByText('Neural NETWORKS 独有证据[S1]');
    expect(screen.getByLabelText('科研问题')).toHaveValue('原会话草稿');
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('原会话草稿回答[S1]');
    const sent = app.completion.mock.calls.at(-1)![2];
    expect(sent).toHaveLength(6);
    expect(JSON.stringify(sent)).toContain('后来追问的关键词');
    expect(JSON.stringify(sent)).not.toContain('另一个会话的问题');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '完全不存在的内容' } });
    await screen.findByText('没有匹配的会话。');
    expect(screen.getByText('原会话草稿回答[S1]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    expect(await screen.findByRole('button', { name: '打开会话 另一个会话的问题' })).toBeInTheDocument();
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('keeps the original name and draft when saving a new name fails and supports retrying', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('原来的标题');
    await screen.findByText('原来的标题回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '不能丢失的草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('名称保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '重命名会话 原来的标题' }));
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '新的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('名称保存失败');
    expect(screen.getByRole('button', { name: '打开会话 原来的标题' })).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('不能丢失的草稿');
    expect(screen.getByLabelText('会话名称')).toHaveValue('新的标题');
    expect(app.snapshot().aiConversations).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await screen.findByRole('button', { name: '打开会话 新的标题' });
    await waitFor(() => expect(screen.queryByLabelText('会话名称')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('不能丢失的草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('reports search failures, retries them, and clears filtering when creating a conversation', async () => {
    const app = await setup();
    const search = app.ai.searchConversations.bind(app.ai);
    let fail = true;
    vi.spyOn(app.ai, 'searchConversations').mockImplementation((query, signal) => query === '触发错误' && fail
      ? Promise.reject(new Error('本地读取失败')) : search(query, signal));
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('现有聊天');
    await screen.findByText('现有聊天回答[S1]');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '触发错误' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('本地读取失败');
    expect(screen.getByText('现有聊天回答[S1]')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试搜索' }));
    await screen.findByText('没有匹配的会话。');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await createConversation();
    expect(screen.getByRole('searchbox', { name: '搜索历史会话' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '打开会话 现有聊天' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 新对话' })).toHaveAttribute('aria-current', 'true');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('ignores late results for an earlier search query', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('第一份聊天');
    await screen.findByText('第一份聊天回答[S1]');
    await createConversation();
    ask('第二份聊天');
    await screen.findByText('第二份聊天回答[S1]');
    await act(async () => { await app.ai.flushAssistantSession(); });
    const search = app.ai.searchConversations.bind(app.ai);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(app.ai, 'searchConversations').mockImplementation(async (query, signal) => {
      if (query === '第一份') { await gate; return search(query); }
      return search(query, signal);
    });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '第一份' } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith('第一份', expect.any(AbortSignal)));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '第二份' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '打开会话 第二份聊天' })).toBeInTheDocument();
    await act(async () => { release(); await gate; });
    expect(screen.queryByRole('button', { name: '打开会话 第一份聊天' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索历史会话' })).toHaveValue('第二份');
    app.ai.dispose();
  });

  it('hides private search results and name drafts on lock, and restores search after unlocking', async () => {
    const app = await setup();
    const folder = await app.library.createFolder('私密');
    await app.library.categorize([app.first.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'private password');
    app.ai.saveAssistantSession({ epoch: app.ai.getView().answerEpoch, messages: [
      { id: 1, role: 'user', content: 'PRIVATE-QUESTION', contextKey: 'direct' },
      { id: 2, role: 'assistant', content: 'PRIVATE-ANSWER', contextKey: 'direct' },
    ], draft: 'PRIVATE-DRAFT', scope: 'selected', selectedPaperIds: [app.first.id], fileQuery: '', mode: 'direct' });
    await app.ai.flushAssistantSession();
    await app.ai.renameConversation(app.ai.getView().activeConversationId!, 'SECRET-NAME');
    await app.ai.createConversation();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    ask('公开问题');
    await screen.findByText('公开问题回答');
    await screen.findByRole('button', { name: '打开会话 SECRET-NAME' });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: 'PRIVATE' } });
    await screen.findByText('找到 1 个会话');
    fireEvent.click(screen.getByRole('button', { name: '重命名会话 SECRET-NAME' }));
    expect(screen.getByLabelText('会话名称')).toHaveValue('SECRET-NAME');
    await act(async () => { await app.library.lockVault(vault.id); });
    await screen.findByText('没有匹配的会话。');
    expect(screen.queryByRole('button', { name: '打开会话 SECRET-NAME' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('会话名称')).not.toBeInTheDocument();
    expect(screen.getByText('公开问题回答')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    expect(await screen.findByRole('button', { name: '重命名会话 加密会话' })).toBeDisabled();
    await act(async () => { await app.library.unlockVault(vault.id, 'private password'); });
    await screen.findByRole('button', { name: '打开会话 SECRET-NAME' });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: 'secret-name' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '打开会话 SECRET-NAME' })).toBeInTheDocument();
    expect(JSON.stringify(app.snapshot())).not.toMatch(/PRIVATE-|SECRET-NAME/);
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('restores independent models of the same provider and routes follow-ups to the restored model', async () => {
    const app = await setup();
    const provider = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...provider, models: ['chat-model', 'fast-model'] });
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('默认模型会话');
    await screen.findByText('默认模型会话回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '默认模型追问' } });
    await createConversation();
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    ask('快模型会话');
    await screen.findByText('快模型会话回答[S1]');
    expect(app.completion.mock.calls.at(-1)![0].model).toBe('fast-model');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 默认模型会话' }));
    await screen.findByText('默认模型会话回答[S1]');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('chat-model');
    expect(screen.getByLabelText('科研问题')).toHaveValue('默认模型追问');
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('默认模型追问回答[S1]');
    expect(app.completion.mock.calls.at(-1)![0].model).toBe('chat-model');
    expect(app.completion.mock.calls.at(-1)![2].map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    fireEvent.click(screen.getByRole('button', { name: '打开会话 快模型会话' }));
    await screen.findByText('快模型会话回答[S1]');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('restores different providers and models after restart without sharing their selections', async () => {
    const app = await setup();
    const one = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...one, models: ['chat-model', 'fast-model'] });
    const two = await app.ai.saveProvider({ name: '第二厂商', baseUrl: 'https://second.example/v1', model: 'second-model', models: ['second-fast'] }, 'fixture-second-key', undefined, true);
    const panel = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    ask('第一厂商会话');
    await screen.findByText('第一厂商会话回答[S1]');
    await createConversation();
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: two.id } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('second-model'));
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'second-fast' } });
    await waitFor(() => expect(screen.getByLabelText('聊天模型')).toHaveValue('second-fast'));
    ask('第二厂商会话');
    await screen.findByText('第二厂商会话回答[S1]');
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount();
    app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('第二厂商会话回答[S1]');
    expect(screen.getByLabelText('AI 厂商')).toHaveValue(two.id);
    expect(screen.getByLabelText('聊天模型')).toHaveValue('second-fast');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 第一厂商会话' }));
    await screen.findByText('第一厂商会话回答[S1]');
    expect(screen.getByLabelText('AI 厂商')).toHaveValue(one.id);
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    ask('继续第一厂商会话');
    await screen.findByText('继续第一厂商会话回答[S1]');
    expect(restarted.completion.mock.calls[0].slice(0, 2)).toEqual([expect.objectContaining({ id: one.id, model: 'fast-model', baseUrl: one.baseUrl }), 'fixture-key']);
    fireEvent.click(screen.getByRole('button', { name: '打开会话 第二厂商会话' }));
    await screen.findByText('第二厂商会话回答[S1]');
    expect(screen.getByLabelText('AI 厂商')).toHaveValue(two.id);
    expect(screen.getByLabelText('聊天模型')).toHaveValue('second-fast');
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('retains the saved model and chat when a selection update fails', async () => {
    const app = await setup();
    const provider = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...provider, models: ['chat-model', 'fast-model'] });
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('保留的会话');
    await screen.findByText('保留的会话回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留的草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('模型选择保存失败'));
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('模型选择保存失败');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('chat-model');
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留的草稿');
    expect(screen.getByText('保留的会话回答[S1]')).toBeInTheDocument();
    expect(app.snapshot().aiConversations).toEqual(before);
    app.ai.dispose();
  });

  it.each(['provider', 'model'] as const)('shows unavailable saved %s choices until the user explicitly chooses another', async (kind) => {
    const app = await setup();
    const one = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...one, models: ['chat-model', 'fast-model'] });
    const two = await app.ai.saveProvider({ name: '第二厂商', baseUrl: 'https://second.example/v1', model: 'second-model' }, 'fixture-second-key');
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    ask('原来的会话');
    await screen.findByText('原来的会话回答[S1]');
    await createConversation();
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: two.id } });
    await waitFor(() => expect(screen.getByLabelText('AI 厂商')).toHaveValue(two.id));
    ask('其他会话');
    await screen.findByText('其他会话回答[S1]');
    await act(async () => {
      await app.ai.flushAssistantSession();
      if (kind === 'provider') await app.ai.removeProvider(one.id);
      else await app.ai.saveProvider({ ...one, models: ['chat-model'] });
    });
    fireEvent.click(screen.getByRole('button', { name: '打开会话 原来的会话' }));
    await screen.findByText('原来的会话回答[S1]');
    expect(screen.getByRole('alert')).toHaveTextContent(kind === 'provider' ? '厂商配置已删除' : '模型已不在厂商配置中');
    expect(screen.getByLabelText('AI 厂商')).toHaveValue(one.id);
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('AI 厂商'), { target: { value: two.id } });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText('原来的会话回答[S1]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开会话 其他会话' }));
    await screen.findByText('其他会话回答[S1]');
    expect(screen.getByLabelText('AI 厂商')).toHaveValue(two.id);
    expect(screen.getByLabelText('聊天模型')).toHaveValue('second-model');
    app.ai.dispose();
  });

  it('keeps separate transcripts, drafts and selected file contexts and follows up in the selected history', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} initialPaperId={app.first.id} onOpenPaper={vi.fn()} />);
    ask('A问题');
    await screen.findByText('A问题回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: 'A追问' } });
    fireEvent.change(screen.getByLabelText('搜索知识库文件'), { target: { value: '甲' } });
    await createConversation();
    expect(screen.queryByText('A问题回答[S1]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 A问题' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '指定文件（可多选）' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 论文乙' }));
    ask('B问题');
    await screen.findByText('B问题回答[S1]');
    expect(app.completion.mock.calls.at(-1)![2]).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: 'B追问草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '打开会话 A问题' }));
    await screen.findByText('A问题回答[S1]');
    expect(screen.queryByText('B问题回答[S1]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('A追问');
    expect(screen.getByLabelText('搜索知识库文件')).toHaveValue('甲');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文甲' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('A追问回答[S1]');
    const followup = app.completion.mock.calls.at(-1)![2];
    expect(followup.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(followup[1].content).toBe('A问题');
    expect(JSON.stringify(followup)).not.toContain('B问题');
    expect(JSON.parse(followup[3].content).sources.every((source: { paperId: string }) => source.paperId === app.first.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '打开会话 B问题' }));
    await screen.findByText('B问题回答[S1]');
    expect(screen.getByLabelText('科研问题')).toHaveValue('B追问草稿');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文乙' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文甲' })).not.toBeChecked();
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('restores the active conversation and the complete history list after restarting', async () => {
    const app = await setup();
    const panel = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    ask('第一会话');
    await screen.findByText('第一会话回答');
    await createConversation();
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    ask('第二会话');
    await screen.findByText('第二会话回答');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '第二会话草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount();
    app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('第二会话回答');
    expect(screen.getByLabelText('科研问题')).toHaveValue('第二会话草稿');
    expect(screen.getByRole('button', { name: '打开会话 第二会话' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 第一会话' }));
    await screen.findByText('第一会话回答');
    expect(screen.getByRole('radio', { name: '直接与模型对话' })).toBeChecked();
    ask('继续第一会话');
    await screen.findByText('继续第一会话回答');
    expect(restarted.completion.mock.calls[0][2].map((message) => message.content)).toContain('第一会话');
    expect(JSON.stringify(restarted.completion.mock.calls[0][2])).not.toContain('第二会话');
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('supports cancellation and confirmation of deleting a history without clearing another conversation', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('删除目标');
    await screen.findByText('删除目标回答[S1]');
    await createConversation();
    ask('当前会话');
    await screen.findByText('当前会话回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '删除会话 删除目标' }));
    fireEvent.click(within(screen.getByRole('group', { name: '确认删除历史会话' })).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '打开会话 删除目标' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除会话 删除目标' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '打开会话 删除目标' })).not.toBeInTheDocument());
    expect(screen.getByText('当前会话回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    fireEvent.click(screen.getByRole('button', { name: '删除会话 当前会话' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await screen.findByRole('button', { name: '打开会话 新对话' });
    await waitFor(() => expect(screen.getByLabelText('科研问题')).toHaveValue(''));
    expect(app.snapshot().aiConversations?.entries).toHaveLength(1);
    expect(JSON.stringify(app.snapshot())).not.toContain('删除目标');
    app.ai.dispose();
  });

  it('keeps chat data and offers retry if deleting a history fails', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('不能丢失');
    await screen.findByText('不能丢失回答[S1]');
    await act(async () => { await app.ai.flushAssistantSession(); });
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('删除保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '删除会话 不能丢失' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除保存失败');
    expect(screen.getByText('不能丢失回答[S1]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 不能丢失' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '打开会话 不能丢失' })).not.toBeInTheDocument());
    app.ai.dispose();
  });

  it('hides locked private histories without disturbing a public conversation and permits deleting them without unlocking', async () => {
    const app = await setup();
    const folder = await app.library.createFolder('私密');
    await app.library.categorize([app.first.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'private password');
    app.ai.saveAssistantSession({ epoch: app.ai.getView().answerEpoch, messages: [
      { id: 1, role: 'user', contextKey: 'direct', content: 'PRIVATE-QUESTION' },
      { id: 2, role: 'assistant', contextKey: 'direct', content: 'PRIVATE-ANSWER' },
    ], draft: 'PRIVATE-DRAFT', scope: 'selected', selectedPaperIds: [app.first.id], fileQuery: '', mode: 'direct' });
    await app.ai.flushAssistantSession();
    await app.ai.createConversation();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '直接与模型对话' }));
    ask('公开会话');
    await screen.findByText('公开会话回答');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '公开草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); await app.library.lockVault(vault.id); });
    expect(screen.getByText('公开会话回答')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('公开草稿');
    expect(screen.queryByText('PRIVATE-QUESTION')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 加密会话' }));
    await screen.findByRole('button', { name: '取消置顶会话 加密会话' });
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 加密会话');
    expect(screen.getByLabelText('科研问题')).toHaveValue('公开草稿');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 加密会话' }));
    await screen.findByText(/已保存的对话涉及加密文献/);
    expect(screen.getByRole('button', { name: '新建对话' })).toBeEnabled();
    await createConversation();
    fireEvent.click(screen.getByRole('button', { name: '删除会话 加密会话' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '打开会话 加密会话' })).not.toBeInTheDocument());
    expect(screen.getByText('已置顶 0/10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 公开会话' })).toBeInTheDocument();
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE-');
    app.ai.dispose();
  });

  it('prevents changing history during a response and ignores cancelled late output', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    ask('已完成的问题');
    await screen.findByText('已完成的问题回答[S1]');
    let finish!: (answer: string) => void;
    app.completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    ask('生成中的问题');
    await waitFor(() => expect(app.completion).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '新建对话' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '打开会话 已完成的问题' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除会话 已完成的问题' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重命名会话 已完成的问题' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '置顶会话 已完成的问题' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消回答' }));
    await act(async () => { finish('迟到的回答'); });
    await waitFor(() => expect(screen.getByRole('button', { name: '新建对话' })).toBeEnabled());
    await createConversation();
    fireEvent.click(screen.getByRole('button', { name: '打开会话 已完成的问题' }));
    await screen.findByText('已完成的问题回答[S1]');
    expect(screen.queryByText('生成中的问题')).not.toBeInTheDocument();
    expect(screen.queryByText('迟到的回答')).not.toBeInTheDocument();
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });
});
