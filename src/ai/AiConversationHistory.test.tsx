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

function openGroupManager() {
  const summary = screen.getByText('管理分组').closest('summary')!;
  const details = summary.closest('details') as HTMLDetailsElement;
  if (!details.open) fireEvent.click(summary);
  return details;
}

async function waitForConversationReady(ai: AiService) {
  await waitFor(() => expect(ai.getView().conversationBusy).toBe(false));
}

async function createGroup(ai: AiService, name: string) {
  await waitForConversationReady(ai);
  openGroupManager();
  fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
  fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(screen.queryByLabelText('分组名称')).not.toBeInTheDocument());
  await waitForConversationReady(ai);
  const group = ai.getView().conversationGroups!.find((item) => item.name === name)!;
  expect(screen.getByRole('combobox', { name: '筛选会话分组' })).toHaveValue(group.id);
  return group;
}

let hitTest: ReturnType<typeof vi.fn<(x: number, y: number) => Element | null>>;

function pointerEvent(node: Element, type: string, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: 120, ...options });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  fireEvent(node, event);
}

function startDrag(title: string) {
  const handle = screen.getByRole('button', { name: `拖动排序置顶会话 ${title}` });
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  pointerEvent(handle, 'pointerdown', { clientY: 20 });
  return handle;
}

function aimDrag(handle: Element, title: string | null) {
  const row = title ? screen.getByRole('button', { name: `打开会话 ${title}` }).closest('li') : null;
  hitTest.mockReturnValue(row);
  pointerEvent(handle, 'pointermove');
  return row;
}

function startGroupDrag(name: string) {
  openGroupManager();
  const handle = screen.getByRole('button', { name: `拖动排序分组 ${name}` });
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  pointerEvent(handle, 'pointerdown', { clientY: 20 });
  return handle;
}

function aimGroupDrag(handle: Element, name: string | null) {
  const row = name ? screen.getByRole('button', { name: `查看分组 ${name}` }).closest('li') : null;
  hitTest.mockReturnValue(row);
  pointerEvent(handle, 'pointermove');
  return row;
}

async function namedConversations(names: string[], pinCount = names.length) {
  const app = await setup();
  const ids = [];
  for (let index = 0; index < names.length; index += 1) {
    if (index) await app.ai.createConversation();
    const id = app.ai.getView().activeConversationId!;
    ids.push(id);
    await app.ai.renameConversation(id, names[index]);
    if (index < pinCount) await app.ai.setConversationPinned(id, true);
  }
  return { ...app, ids };
}

async function groupedConversations() {
  const app = await namedConversations(['历史会话', '当前会话']);
  const groups = [];
  for (const name of ['研究', '归档', '参考']) groups.push(await app.ai.createConversationGroup(name));
  for (let index = 0; index < app.ids.length; index += 1) await app.ai.moveConversationToGroup(app.ids[index], groups[index].id);
  return { ...app, groups };
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  hitTest = vi.fn<(x: number, y: number) => Element | null>().mockReturnValue(null);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hitTest });
});

describe('AI conversation history UI', () => {
  it('keeps search visible while group management starts collapsed and remains keyboard reachable', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: '搜索历史会话' })).toBeInTheDocument();
    const details = screen.getByText('管理分组').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('管理分组'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: '新建分组' })).toBeEnabled();
    app.ai.dispose();
  });

  it('independently collapses groups, restores them after restart and preserves the active chat and follow-up context', async () => {
    const app = await groupedConversations();
    const provider = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...provider, models: ['chat-model', 'fast-model'] });
    await app.ai.selectProvider(provider.id, 'fast-model');
    const panel = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    expect(screen.getByRole('button', { name: '折叠分组 研究' })).toHaveAttribute('aria-expanded', 'true');
    ask('折叠前的问题');
    await screen.findByText('折叠前的问题回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '继续追问草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations!.entries;
    fireEvent.click(screen.getByRole('button', { name: '折叠分组 研究' }));
    await screen.findByRole('button', { name: '展开分组 研究' });
    await waitForConversationReady(app.ai);
    expect(screen.queryByRole('button', { name: '打开会话 历史会话' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 当前会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '折叠分组 归档' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '折叠分组 归档' }));
    await screen.findByText('会话所在分组已折叠，可展开分组查看。');
    await waitForConversationReady(app.ai);
    expect(screen.getByText('折叠前的问题回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('继续追问草稿');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(app.snapshot().aiConversations?.entries).toEqual(before);
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount(); app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    await screen.findByText('折叠前的问题回答[S1]');
    expect(screen.getByRole('button', { name: '展开分组 研究' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '展开分组 归档' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '打开会话 当前会话' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('继续追问草稿');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '折叠前的问题' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '打开会话 当前会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开分组 归档' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    expect(screen.queryByRole('button', { name: '打开会话 当前会话' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开分组 归档' }));
    await screen.findByRole('button', { name: '折叠分组 归档' });
    await waitForConversationReady(restarted.ai);
    expect(screen.getByRole('button', { name: '打开会话 当前会话' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('继续追问草稿回答[S1]');
    expect(restarted.completion.mock.calls[0][0].model).toBe('fast-model');
    expect(restarted.completion.mock.calls[0][2].map((message) => message.content)).toContain('折叠前的问题');
    expect(JSON.stringify(restarted.completion.mock.calls[0][2])).not.toContain('历史会话');
    expect(restarted.ai.getView().conversationGroups?.find((group) => group.id === app.groups[0].id)?.collapsed).toBe(true);
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it.each([true, false])('keeps the original expanded state and chat after a failed collapsed=%s update and supports retrying', async (collapsed) => {
    const app = await groupedConversations();
    const group = app.groups[0];
    await app.ai.setConversationGroupCollapsed(group.id, !collapsed);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    const label = `${collapsed ? '折叠' : '展开'}分组 研究`;
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('折叠状态保存失败'));
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(await screen.findByRole('alert')).toHaveTextContent('折叠状态保存失败');
    await waitForConversationReady(app.ai);
    expect(app.snapshot().aiConversations).toEqual(before);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-expanded', collapsed ? 'true' : 'false');
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    fireEvent.click(screen.getByRole('button', { name: label }));
    await screen.findByText(collapsed ? '分组已折叠。' : '分组已展开。');
    await waitForConversationReady(app.ai);
    expect(screen.getByRole('button', { name: `${collapsed ? '展开' : '折叠'}分组 研究` })).toHaveAttribute('aria-expanded', collapsed ? 'false' : 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(app.snapshot().aiConversations?.entries).toEqual(before?.entries);
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('keeps collapsed groups searchable, sortable and renameable without changing their saved collapsed state', async () => {
    const app = await groupedConversations();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    const group = app.groups[0];
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    fireEvent.click(screen.getByRole('button', { name: '折叠分组 研究' }));
    await screen.findByText('该分组已折叠，展开后可查看会话。');
    await waitForConversationReady(app.ai);
    expect(screen.getByRole('combobox', { name: '筛选会话分组' })).toHaveValue(group.id);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '历史会话' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('combobox', { name: '移动会话 历史会话 到分组' })).toHaveValue(group.id);
    fireEvent.click(screen.getByText('调整分组顺序'));
    const handle = startGroupDrag('研究');
    aimGroupDrag(handle, '参考');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('分组顺序已保存。');
    await waitForConversationReady(app.ai);
    expect(app.ai.getView().conversationGroups?.find((item) => item.id === group.id)?.collapsed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重命名分组' }));
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: '重点研究' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
    await screen.findByRole('button', { name: '展开分组 重点研究' });
    await screen.findByText('找到 1 个会话');
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 历史会话 到分组' }), { target: { value: app.groups[1].id } });
    await screen.findByText('没有匹配的会话。');
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    expect(screen.getByRole('button', { name: '展开分组 重点研究' })).toHaveAttribute('aria-expanded', 'false');
    expect(app.snapshot().aiConversations?.entries.find((entry) => entry.id === app.ids[0])?.groupId).toBe(app.groups[1].id);
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('drags and keyboard-sorts groups consistently across selectors and restart while preserving membership and drafts', async () => {
    const app = await groupedConversations();
    const [one, two, three] = app.groups;
    const panel = render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留的草稿' } });
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: two.id } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations!;
    fireEvent.click(screen.getByText('调整分组顺序'));
    const handle = startGroupDrag('参考');
    expect(aimGroupDrag(handle, '研究')).toHaveClass('drop-before');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('分组顺序已保存。');
    await waitForConversationReady(app.ai);
    expect(app.snapshot().aiConversations).toEqual({ ...before, groups: [three, one, two] });
    expect(screen.getByRole('combobox', { name: '筛选会话分组' })).toHaveValue(two.id);
    expect(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' })).toHaveValue(two.id);
    expect(within(screen.getByRole('combobox', { name: '筛选会话分组' })).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['all', '', three.id, one.id, two.id]);
    expect(within(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' })).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', three.id, one.id, two.id]);
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序分组 参考' }), { key: 'ArrowDown' });
    await waitFor(() => expect(app.ai.getView().conversationGroups).toEqual([one, three, two]));
    await waitForConversationReady(app.ai);
    await waitFor(() => expect(screen.getByRole('button', { name: '拖动排序分组 参考' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序分组 参考' }), { key: 'ArrowUp' });
    await waitFor(() => expect(app.ai.getView().conversationGroups).toEqual([three, one, two]));
    expect(screen.queryByRole('button', { name: '拖动排序分组 全部会话' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拖动排序分组 未分组' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留的草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount(); app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    await waitFor(() => expect(screen.getByLabelText('科研问题')).toHaveValue('保留的草稿'));
    expect(restarted.ai.getView().conversationGroups).toEqual([three, one, two]);
    expect(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' })).toHaveValue(two.id);
    fireEvent.click(screen.getByText('调整分组顺序'));
    expect(screen.getAllByRole('button', { name: /^查看分组 / }).map((button) => button.getAttribute('aria-label'))).toEqual(['查看分组 参考', '查看分组 研究', '查看分组 归档']);
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('retains original group order and chat state when saving a drag fails and supports retrying', async () => {
    const app = await groupedConversations();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    fireEvent.click(screen.getByText('调整分组顺序'));
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('分组顺序保存失败'));
    let handle = startGroupDrag('参考');
    aimGroupDrag(handle, '研究');
    pointerEvent(handle, 'pointerup');
    expect(await screen.findByRole('alert')).toHaveTextContent('分组顺序保存失败');
    await waitForConversationReady(app.ai);
    expect(app.snapshot().aiConversations).toEqual(before);
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    handle = startGroupDrag('参考');
    aimGroupDrag(handle, '研究');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('分组顺序已保存。');
    await waitForConversationReady(app.ai);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(app.snapshot().aiConversations?.entries).toEqual(before?.entries);
    expect(app.ai.getView().conversationGroups).toEqual([app.groups[2], app.groups[0], app.groups[1]]);
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('cancels group dragging on escape, pointer cancellation, a click, an invalid target or closing the editor', async () => {
    const app = await groupedConversations();
    const drop = vi.fn();
    render(<div onDrop={drop}><AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} /></div>);
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    const reorder = vi.spyOn(app.ai, 'reorderConversationGroups');
    fireEvent.click(screen.getByText('调整分组顺序'));
    let handle = startGroupDrag('研究');
    aimGroupDrag(handle, '归档');
    pointerEvent(handle, 'pointercancel');
    handle = startGroupDrag('研究');
    aimGroupDrag(handle, '归档');
    fireEvent.keyDown(handle, { key: 'Escape' });
    pointerEvent(handle, 'pointerup');
    handle = startGroupDrag('研究');
    pointerEvent(handle, 'pointerup', { clientY: 20 });
    for (const target of ['研究', null]) {
      handle = startGroupDrag('研究'); aimGroupDrag(handle, target); pointerEvent(handle, 'pointerup');
    }
    handle = startGroupDrag('研究');
    hitTest.mockReturnValue(screen.getByRole('button', { name: '打开会话 当前会话' }).closest('li'));
    pointerEvent(handle, 'pointermove'); pointerEvent(handle, 'pointerup');
    handle = startGroupDrag('研究');
    aimGroupDrag(handle, '归档');
    const source = handle.closest('li')!;
    fireEvent.click(screen.getByText('调整分组顺序'));
    await waitFor(() => expect(source).not.toHaveClass('is-dragging'));
    pointerEvent(handle, 'pointerup');
    fireEvent.drop(source, { dataTransfer: { files: [new File(['%PDF-1.7'], 'drop.pdf')] } });
    expect(drop).toHaveBeenCalledTimes(1);
    expect(reorder).not.toHaveBeenCalled();
    expect(app.snapshot().aiConversations).toEqual(before);
    app.ai.dispose();
  });

  it('rejects stale group dragging when a new group appears', async () => {
    const app = await groupedConversations();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    await act(async () => { await app.ai.flushAssistantSession(); });
    const reorder = vi.spyOn(app.ai, 'reorderConversationGroups');
    fireEvent.click(screen.getByText('调整分组顺序'));
    const handle = startGroupDrag('参考');
    aimGroupDrag(handle, '研究');
    await act(async () => { await app.library.createAiConversationGroup('新增'); });
    const beforeDrop = app.snapshot().aiConversations;
    pointerEvent(handle, 'pointerup');
    expect(await screen.findByRole('alert')).toHaveTextContent('会话分组列表已变化');
    expect(reorder).not.toHaveBeenCalled();
    expect(app.snapshot().aiConversations).toEqual(beforeDrop);
    app.ai.dispose();
  });

  it('scrolls the group ordering list near its edge and stops after cancellation', async () => {
    const app = await groupedConversations();
    for (let index = 0; index < 5; index += 1) await app.ai.createConversationGroup(`其他${index}`);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    fireEvent.click(screen.getByText('调整分组顺序'));
    const list = screen.getByRole('list', { name: '分组排序' });
    const bounds = vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, left: 0, right: 240, x: 0, y: 0, width: 240, height: 200, toJSON: () => ({}) });
    const frames: FrameRequestCallback[] = [];
    let frameId = 0;
    const request = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return ++frameId; });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      const handle = startGroupDrag('研究');
      hitTest.mockReturnValue(screen.getByRole('button', { name: '查看分组 归档' }).closest('li'));
      pointerEvent(handle, 'pointermove', { clientY: 195 });
      expect(frames).toHaveLength(1);
      act(() => { frames.shift()!(0); });
      expect(list.scrollTop).toBe(10);
      pointerEvent(handle, 'pointercancel');
      expect(cancel).toHaveBeenCalledWith(frameId);
    } finally { request.mockRestore(); cancel.mockRestore(); bounds.mockRestore(); app.ai.dispose(); }
  });

  it('manages groups and restores memberships after restarting while deleted-group chats keep their own follow-up context', async () => {
    const app = await setup();
    const provider = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...provider, models: ['chat-model', 'fast-model'] });
    const panel = render(<AiAssistant library={app.library} ai={app.ai} initialPaperId={app.first.id} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    ask('课题甲');
    await screen.findByText('课题甲回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '甲的追问' } });
    const research = await createGroup(app.ai, '研究讨论');
    expect(screen.getByLabelText('科研问题')).toHaveValue('甲的追问');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 课题甲 到分组' }), { target: { value: research.id } });
    await screen.findByText('会话分组已更新。');
    await waitForConversationReady(app.ai);
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: research.id } });
    await createConversation();
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'chat-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    fireEvent.click(screen.getByRole('radio', { name: '指定文件（可多选）' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 论文乙' }));
    ask('课题乙');
    await screen.findByText('课题乙回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '乙的草稿' } });
    const archive = await createGroup(app.ai, '归档');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 课题乙 到分组' }), { target: { value: archive.id } });
    await screen.findByText('会话分组已更新。');
    await waitForConversationReady(app.ai);
    const first = app.ai.getView().conversations!.find((entry) => entry.title === '课题甲')!.id;
    const second = app.ai.getView().activeConversationId!;
    await act(async () => {
      await app.ai.setConversationPinned(first, true); await app.ai.setConversationPinned(second, true);
      await app.ai.reorderPinnedConversations([second, first]);
    });
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: archive.id } });
    fireEvent.click(screen.getByRole('button', { name: '重命名分组' }));
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: '已归档' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
    await waitFor(() => expect(screen.queryByLabelText('分组名称')).not.toBeInTheDocument());
    await waitForConversationReady(app.ai);
    const beforeOrder = app.snapshot().aiConversations!;
    fireEvent.click(screen.getByText('调整分组顺序'));
    const groupHandle = startGroupDrag('已归档');
    aimGroupDrag(groupHandle, '研究讨论');
    pointerEvent(groupHandle, 'pointerup');
    await screen.findByText('分组顺序已保存。');
    await waitForConversationReady(app.ai);
    expect(app.snapshot().aiConversations?.entries).toEqual(beforeOrder.entries);
    expect(screen.getByRole('combobox', { name: '筛选会话分组' })).toHaveValue(archive.id);
    expect(screen.getByLabelText('科研问题')).toHaveValue('乙的草稿');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: research.id } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations!;
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
    expect(screen.getByRole('group', { name: '确认删除会话分组' })).toHaveTextContent('聊天记录和上下文继续保留');
    fireEvent.click(screen.getByRole('button', { name: '确认删除分组' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '筛选会话分组' })).toHaveValue('all'));
    expect(screen.getByRole('combobox', { name: '移动会话 课题甲 到分组' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '移动会话 课题乙 到分组' })).toHaveValue(archive.id);
    expect(screen.getByText('课题乙回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('乙的草稿');
    for (const entry of app.snapshot().aiConversations!.entries) {
      expect(entry).toEqual(entry.id === first ? { ...before.entries.find((item) => item.id === first), groupId: null } : before.entries.find((item) => item.id === entry.id));
    }
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount(); app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('课题乙回答[S1]');
    expect(screen.getByRole('option', { name: '已归档（1）' })).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('乙的草稿');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('chat-model');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 课题甲' }));
    await screen.findByText('课题甲回答[S1]');
    expect(screen.getByLabelText('科研问题')).toHaveValue('甲的追问');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文甲' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('甲的追问回答[S1]');
    expect(restarted.completion.mock.calls[0][0].model).toBe('fast-model');
    expect(restarted.completion.mock.calls[0][2].map((message) => message.content)).toContain('课题甲');
    expect(JSON.stringify(restarted.completion.mock.calls[0][2])).not.toContain('课题乙');
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 课题乙');
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('filters groups and ungrouped chats, searches within the chosen group and creates new chats there', async () => {
    const app = await namedConversations(['组内目标', '其他目标', '普通目标'], 2);
    const one = await app.ai.createConversationGroup('研究');
    const two = await app.ai.createConversationGroup('归档');
    await app.ai.moveConversationToGroup(app.ids[0], one.id);
    await app.ai.moveConversationToGroup(app.ids[1], two.id);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: one.id } });
    expect(screen.getByRole('button', { name: '打开会话 组内目标' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开会话 其他目标' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '目标' } });
    await screen.findByText('找到 1 个会话');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: two.id } });
    expect(screen.getByRole('button', { name: '打开会话 其他目标' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '打开会话 普通目标' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: two.id } });
    await createConversation();
    expect(screen.getByRole('combobox', { name: '移动会话 新对话 到分组' })).toHaveValue(two.id);
    expect(screen.getByRole('option', { name: '归档（2）' })).toBeInTheDocument();
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '置顶会话 新对话' })).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('moves active and inactive chats out of a filtered group and retries a failed membership change', async () => {
    const app = await namedConversations(['历史会话', '当前会话'], 0);
    const group = await app.ai.createConversationGroup('研究');
    await app.ai.moveConversationToGroup(app.ids[0], group.id);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留草稿' } });
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 历史会话 到分组' }), { target: { value: '' } });
    await screen.findByText('该分组暂无会话。');
    await waitForConversationReady(app.ai);
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' }), { target: { value: group.id } });
    await waitFor(() => expect(screen.queryByRole('button', { name: '打开会话 当前会话' })).not.toBeInTheDocument());
    await waitForConversationReady(app.ai);
    expect(app.ai.getView().activeConversationId).toBe(app.ids[1]);
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('归属保存失败'));
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' }), { target: { value: '' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('归属保存失败');
    await waitForConversationReady(app.ai);
    expect(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' })).toHaveValue(group.id);
    expect(app.snapshot().aiConversations).toEqual(before);
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 当前会话 到分组' }), { target: { value: '' } });
    await screen.findByText('该分组暂无会话。');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it.each(['create', 'rename', 'delete'] as const)('preserves groups and the active draft after a failed %s operation and permits retrying', async (operation) => {
    const app = await namedConversations(['保留的聊天'], 0);
    const group = await app.ai.createConversationGroup('原分组');
    await app.ai.moveConversationToGroup(app.ids[0], group.id);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '保留草稿' } });
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    if (operation === 'delete') fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
    else {
      fireEvent.click(screen.getByRole('button', { name: operation === 'create' ? '新建分组' : '重命名分组' }));
      fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: '新名称' } });
    }
    const submit = () => fireEvent.click(screen.getByRole('button', { name: operation === 'delete' ? '确认删除分组' : '保存分组' }));
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('分组保存失败'));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('分组保存失败');
    await waitForConversationReady(app.ai);
    if (operation === 'rename') {
      const details = screen.getByText('管理分组').closest('details')!;
      fireEvent.click(screen.getByText('管理分组'));
      expect(details).not.toHaveAttribute('open');
      expect(screen.getByRole('alert')).toHaveTextContent('分组保存失败');
      fireEvent.click(screen.getByText('管理分组'));
    }
    expect(app.snapshot().aiConversations).toEqual(before);
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    if (operation !== 'delete') expect(screen.getByLabelText('分组名称')).toHaveValue('新名称');
    submit();
    if (operation === 'delete') await waitFor(() => expect(app.ai.getView().conversationGroups).toEqual([]));
    else await waitFor(() => expect(screen.queryByLabelText('分组名称')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(app.ai.getView().activeConversationId).toBe(app.ids[0]);
    expect(screen.getByLabelText('科研问题')).toHaveValue('保留草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('validates group names, supports cancelling and protects the built-in history views', async () => {
    const app = await setup();
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    expect(screen.getByRole('button', { name: '重命名分组' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除分组' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
    expect(screen.getByLabelText('分组名称')).toHaveFocus();
    expect(screen.getByLabelText('分组名称')).toHaveAttribute('maxlength', '100');
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: '保存分组' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('分组名称'), { key: 'Escape' });
    expect(screen.queryByLabelText('分组名称')).not.toBeInTheDocument();
    const group = await createGroup(app.ai, '研究');
    fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: ' 研究 ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('同名会话分组');
    fireEvent.click(within(screen.getByRole('form', { name: '新建会话分组' })).getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
    fireEvent.click(within(screen.getByRole('group', { name: '确认删除会话分组' })).getByRole('button', { name: '取消' }));
    expect(app.ai.getView().conversationGroups).toEqual([group]);
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '重命名分组' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除分组' })).toBeDisabled();
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('preserves global pin ordering and hidden memberships while dragging or using arrow keys within a group', async () => {
    const app = await namedConversations(['组内甲', '隐藏置顶', '组内乙', '普通'], 3);
    const group = await app.ai.createConversationGroup('研究');
    const other = await app.ai.createConversationGroup('其他');
    await app.ai.moveConversationToGroup(app.ids[0], group.id);
    await app.ai.moveConversationToGroup(app.ids[2], group.id);
    await app.ai.moveConversationToGroup(app.ids[1], other.id);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    const handle = startDrag('组内乙');
    aimDrag(handle, '组内甲');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('置顶顺序已保存。');
    expect(app.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[2], app.ids[0], app.ids[1]]);
    expect(app.ai.getView().conversations?.find((entry) => entry.id === app.ids[1])?.groupId).toBe(other.id);
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序置顶会话 组内乙' }), { key: 'ArrowDown' });
    await waitFor(() => expect(app.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[0], app.ids[2], app.ids[1]]));
    expect(screen.getByText('3/10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开会话 隐藏置顶' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: 'all' } });
    expect(screen.getByRole('combobox', { name: '移动会话 隐藏置顶 到分组' })).toHaveValue(other.id);
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('drags pinned chats into a durable order without changing their model, scope or follow-up context', async () => {
    const app = await setup();
    const provider = app.library.getView().snapshot.ai.providers[0];
    await app.ai.saveProvider({ ...provider, models: ['chat-model', 'fast-model'] });
    const panel = render(<AiAssistant library={app.library} ai={app.ai} initialPaperId={app.first.id} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'fast-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    ask('排序甲');
    await screen.findByText('排序甲回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '甲的追问' } });
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 排序甲' }));
    await screen.findByRole('button', { name: '取消置顶会话 排序甲' });
    await createConversation();
    fireEvent.change(screen.getByLabelText('聊天模型'), { target: { value: 'chat-model' } });
    await screen.findByText('AI 厂商与模型已切换，可继续当前对话。');
    fireEvent.click(screen.getByRole('radio', { name: '指定文件（可多选）' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择知识库文件 论文乙' }));
    ask('排序乙');
    await screen.findByText('排序乙回答[S1]');
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '乙的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 排序乙' }));
    await screen.findByRole('button', { name: '取消置顶会话 排序乙' });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations!;
    const handle = startDrag('排序乙');
    expect(aimDrag(handle, '排序甲')).toHaveClass('drop-before');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('置顶顺序已保存。');
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 排序乙');
    expect(screen.getByText('排序乙回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('乙的草稿');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('chat-model');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文乙' })).toBeChecked();
    for (const entry of app.snapshot().aiConversations!.entries) {
      const original = before.entries.find((item) => item.id === entry.id)!;
      expect(entry.session).toEqual(original.session);
      expect(entry.selection).toEqual(original.selection);
      expect(entry.updatedAt).toBe(original.updatedAt);
    }
    await act(async () => { await app.ai.flushAssistantSession(); });
    panel.unmount(); app.ai.dispose();
    const restarted = services(app.storage);
    render(<AiAssistant library={restarted.library} ai={restarted.ai} onOpenPaper={vi.fn()} />);
    await screen.findByText('排序乙回答[S1]');
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 排序乙');
    expect(screen.getByLabelText('科研问题')).toHaveValue('乙的草稿');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 排序甲' }));
    await screen.findByText('排序甲回答[S1]');
    expect(screen.getByLabelText('科研问题')).toHaveValue('甲的追问');
    expect(screen.getByLabelText('聊天模型')).toHaveValue('fast-model');
    expect(screen.getByRole('checkbox', { name: '选择知识库文件 论文甲' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
    await screen.findByText('甲的追问回答[S1]');
    expect(restarted.completion.mock.calls[0][0].model).toBe('fast-model');
    expect(restarted.completion.mock.calls[0][2].map((message) => message.content)).toContain('排序甲');
    expect(JSON.stringify(restarted.completion.mock.calls[0][2])).not.toContain('排序乙');
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 排序乙');
    await act(async () => { await restarted.ai.flushAssistantSession(); });
    restarted.ai.dispose();
  });

  it('reorders search results using the full pinned list and supports keyboard moves with focus restoration', async () => {
    const app = await namedConversations(['目标甲', '隐藏会话', '目标乙', '普通会话'], 3);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '拖动排序置顶会话 普通会话' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '目标' } });
    await screen.findByText('找到 2 个会话');
    const handle = startDrag('目标乙');
    aimDrag(handle, '目标甲');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('置顶顺序已保存。');
    await screen.findByText('找到 2 个会话');
    expect(app.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[2], app.ids[0], app.ids[1]]);
    expect(screen.getByText('3/10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    const keyboard = await screen.findByRole('button', { name: '拖动排序置顶会话 目标甲' });
    keyboard.focus();
    fireEvent.keyDown(keyboard, { key: 'ArrowDown' });
    await waitFor(() => expect(app.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[2], app.ids[1], app.ids[0]]));
    await waitFor(() => expect(screen.getByRole('button', { name: '拖动排序置顶会话 目标甲' })).toHaveFocus());
    expect(screen.getAllByRole('button', { name: /^打开会话 / }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '打开会话 目标乙', '打开会话 隐藏会话', '打开会话 目标甲', '打开会话 普通会话',
    ]);
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('leaves order unchanged on cancellation, a click, an invalid target or an external file drop', async () => {
    const app = await namedConversations(['甲', '乙', '普通'], 2);
    const externalDrop = vi.fn();
    render(<div onDrop={externalDrop}><AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} /></div>);
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    const reorder = vi.spyOn(app.ai, 'reorderPinnedConversations');
    let handle = startDrag('甲');
    aimDrag(handle, '乙');
    pointerEvent(handle, 'pointercancel');
    handle = startDrag('甲');
    aimDrag(handle, '乙');
    fireEvent.keyDown(handle, { key: 'Escape' });
    pointerEvent(handle, 'pointerup');
    handle = startDrag('甲');
    pointerEvent(handle, 'pointerup', { clientY: 20 });
    for (const target of ['甲', '普通', null]) {
      handle = startDrag('甲');
      aimDrag(handle, target);
      pointerEvent(handle, 'pointerup');
    }
    fireEvent.drop(screen.getByRole('button', { name: '打开会话 乙' }).closest('li')!, { dataTransfer: { files: [new File(['%PDF-1.7'], 'drop.pdf')] } });
    expect(externalDrop).toHaveBeenCalledTimes(1);
    expect(reorder).not.toHaveBeenCalled();
    expect(app.snapshot().aiConversations).toEqual(before);
    expect(screen.queryByText('置顶顺序已保存。')).not.toBeInTheDocument();
    app.ai.dispose();
  });

  it('keeps the original order and draft on a failed reorder and supports dragging again to retry', async () => {
    const app = await namedConversations(['常用甲', '常用乙', '当前会话'], 2);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: '需要保留的草稿' } });
    await act(async () => { await app.ai.flushAssistantSession(); });
    const before = app.snapshot().aiConversations;
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('排序写入失败'));
    let handle = startDrag('常用甲');
    aimDrag(handle, '常用乙');
    pointerEvent(handle, 'pointerup');
    expect(await screen.findByRole('alert')).toHaveTextContent('排序写入失败');
    await waitForConversationReady(app.ai);
    expect(app.snapshot().aiConversations).toEqual(before);
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用甲');
    expect(screen.getByLabelText('科研问题')).toHaveValue('需要保留的草稿');
    await waitFor(() => expect(screen.getByRole('button', { name: '拖动排序置顶会话 常用甲' })).toHaveFocus());
    handle = startDrag('常用甲');
    aimDrag(handle, '常用乙');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('置顶顺序已保存。');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用乙');
    expect(screen.getByLabelText('科研问题')).toHaveValue('需要保留的草稿');
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

  it('rejects a stale drag after the pinned membership changes', async () => {
    const app = await namedConversations(['甲', '乙', '新增会话'], 2);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    await act(async () => { await app.ai.flushAssistantSession(); });
    const reorder = vi.spyOn(app.ai, 'reorderPinnedConversations');
    const handle = startDrag('甲');
    aimDrag(handle, '乙');
    await act(async () => { await app.library.setAiConversationPinned(app.ids[2], true); });
    const afterPin = app.snapshot().aiConversations;
    pointerEvent(handle, 'pointerup');
    expect(await screen.findByRole('alert')).toHaveTextContent('置顶会话列表已变化');
    expect(reorder).not.toHaveBeenCalled();
    expect(app.snapshot().aiConversations).toEqual(afterPin);
    expect(screen.getByText('3/10')).toBeInTheDocument();
    app.ai.dispose();
  });

  it('scrolls near the list edge and stops the animation after cancelling', async () => {
    const app = await namedConversations(['甲', '乙']);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    const panel = screen.getByRole('complementary', { name: '历史会话' });
    const bounds = vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, left: 0, right: 240, x: 0, y: 0, width: 240, height: 200, toJSON: () => ({}) });
    const frames: FrameRequestCallback[] = [];
    let frameId = 0;
    const request = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return ++frameId; });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      const handle = startDrag('甲');
      hitTest.mockReturnValue(screen.getByRole('button', { name: '打开会话 乙' }).closest('li'));
      pointerEvent(handle, 'pointermove', { clientY: 195 });
      expect(frames).toHaveLength(1);
      act(() => { frames.shift()!(0); });
      expect(panel.scrollTop).toBe(10);
      expect(frames).toHaveLength(1);
      pointerEvent(handle, 'pointercancel');
      expect(cancel).toHaveBeenCalledWith(frameId);
      expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 甲');
    } finally { request.mockRestore(); cancel.mockRestore(); bounds.mockRestore(); app.ai.dispose(); }
  });

  it('disables pointer and keyboard reordering while a response is in progress', async () => {
    const app = await namedConversations(['甲', '乙']);
    const group = await app.ai.createConversationGroup('研究');
    await app.ai.createConversationGroup('参考');
    for (const id of app.ids) await app.ai.moveConversationToGroup(id, group.id);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    openGroupManager();
    fireEvent.click(screen.getByText('调整分组顺序'));
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    const reorder = vi.spyOn(app.ai, 'reorderPinnedConversations');
    let finish!: (answer: string) => void;
    app.completion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    ask('生成中的回答');
    await waitFor(() => expect(app.completion).toHaveBeenCalled());
    const handle = screen.getByRole('button', { name: '拖动排序置顶会话 甲' });
    expect(handle).toBeDisabled();
    expect(screen.getByRole('button', { name: '拖动排序分组 研究' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '折叠分组 研究' })).toBeDisabled();
    for (const name of ['新建分组', '重命名分组', '删除分组']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '移动会话 甲 到分组' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: 'all' } });
    pointerEvent(handle, 'pointerdown', { clientY: 20 });
    aimDrag(handle, '乙');
    pointerEvent(handle, 'pointerup');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(reorder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消回答' }));
    await act(async () => { finish('迟到的回答'); });
    await waitFor(() => expect(handle).toBeEnabled());
    await act(async () => { await app.ai.flushAssistantSession(); });
    app.ai.dispose();
  });

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
    expect(screen.getByText('1/10')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用课题');
    expect(screen.getByText('当前课题回答[S1]')).toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('当前草稿');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '课题' } });
    await screen.findByText('找到 2 个会话');
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 常用课题');
    fireEvent.click(screen.getByRole('button', { name: '取消置顶会话 常用课题' }));
    await screen.findByText('0/10');
    await screen.findByText('找到 2 个会话');
    expect(screen.getAllByRole('button', { name: /^打开会话 / }).map((button) => button.getAttribute('aria-label'))).toEqual(recentOrder);
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 常用课题' }));
    await screen.findByText('1/10');
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

  it('counts all ten pins across groups and search results and frees a slot when unpinning or deleting a pinned chat', async () => {
    const app = await setup();
    const ids = [];
    for (let index = 1; index <= 12; index += 1) {
      if (index > 1) await app.ai.createConversation();
      const id = app.ai.getView().activeConversationId!;
      ids.push(id);
      await app.ai.renameConversation(id, `课题${index}`);
      if (index <= 10) await app.ai.setConversationPinned(id, true);
    }
    const group = await app.ai.createConversationGroup('筛选分组');
    await app.ai.moveConversationToGroup(ids[0], group.id);
    await app.ai.moveConversationToGroup(ids[10], group.id);
    render(<AiAssistant library={app.library} ai={app.ai} onOpenPaper={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getByText('置顶已达上限，请先取消其他会话的置顶。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '置顶会话 课题11' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消置顶会话 课题1' })).toBeEnabled();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '课题11' } });
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '置顶会话 课题11' })).toBeDisabled();
    expect(screen.getByText('10/10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消置顶会话 课题1' }));
    await screen.findByText('9/10');
    expect(screen.getByRole('button', { name: '置顶会话 课题11' })).toBeEnabled();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: '课题11' } });
    await screen.findByText('找到 1 个会话');
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 课题11' }));
    await screen.findByText('10/10');
    await screen.findByText('找到 1 个会话');
    expect(screen.getByRole('button', { name: '取消置顶会话 课题11' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '删除会话 课题11' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await screen.findByText('9/10');
    await screen.findByText('没有匹配的会话。');
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: 'all' } });
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
    await waitForConversationReady(app.ai);
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
    await waitForConversationReady(app.ai);
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

  it('hides locked private histories without disturbing a public conversation and permits grouping, sorting and deleting them without unlocking', async () => {
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
    await waitForConversationReady(app.ai);
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 加密会话');
    expect(screen.getByLabelText('科研问题')).toHaveValue('公开草稿');
    fireEvent.click(screen.getByRole('button', { name: '置顶会话 公开会话' }));
    await screen.findByRole('button', { name: '取消置顶会话 公开会话' });
    await waitForConversationReady(app.ai);
    const handle = startDrag('公开会话');
    aimDrag(handle, '加密会话');
    pointerEvent(handle, 'pointerup');
    await screen.findByText('置顶顺序已保存。');
    expect(screen.getAllByRole('button', { name: /^打开会话 / })[0]).toHaveAccessibleName('打开会话 公开会话');
    expect(screen.getByLabelText('科研问题')).toHaveValue('公开草稿');
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE-');
    fireEvent.click(screen.getByRole('button', { name: '取消置顶会话 公开会话' }));
    await screen.findByRole('button', { name: '置顶会话 公开会话' });
    const ciphertext = app.snapshot().aiConversations!.entries.find((entry) => entry.session?.kind === 'encrypted')!.session;
    const group = await createGroup(app.ai, '私密归档');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('combobox', { name: '移动会话 加密会话 到分组' }), { target: { value: group.id } });
    await screen.findByText('会话分组已更新。');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选会话分组' }), { target: { value: group.id } });
    fireEvent.click(screen.getByRole('button', { name: '折叠分组 私密归档' }));
    await screen.findByText('该分组已折叠，展开后可查看会话。');
    expect(app.snapshot().aiConversations!.entries.find((entry) => entry.session?.kind === 'encrypted')?.session).toEqual(ciphertext);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史会话' }), { target: { value: 'PRIVATE-' } });
    await screen.findByText('没有匹配的会话。');
    fireEvent.click(screen.getByRole('button', { name: '清空会话搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '展开分组 私密归档' }));
    await screen.findByRole('button', { name: '打开会话 加密会话' });
    await waitForConversationReady(app.ai);
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除分组' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '筛选会话分组' })).toHaveValue('all'));
    expect(screen.getByRole('combobox', { name: '移动会话 加密会话 到分组' })).toHaveValue('');
    expect(app.snapshot().aiConversations!.entries.find((entry) => entry.session?.kind === 'encrypted')?.session).toEqual(ciphertext);
    expect(screen.getByLabelText('科研问题')).toHaveValue('公开草稿');
    fireEvent.click(screen.getByRole('button', { name: '打开会话 加密会话' }));
    await screen.findByText(/已保存的对话涉及加密文献/);
    expect(screen.getByRole('button', { name: '新建对话' })).toBeEnabled();
    await createConversation();
    fireEvent.click(screen.getByRole('button', { name: '删除会话 加密会话' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '打开会话 加密会话' })).not.toBeInTheDocument());
    expect(screen.getByText('0/10')).toBeInTheDocument();
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
