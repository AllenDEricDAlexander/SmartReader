import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyLibrary, emptyMetadata, type AiAssistantSession, type LibrarySnapshot } from '../library/libraryModels';
import { LibraryService } from '../library/libraryService';
import type { LibraryStorage } from '../library/libraryStorage';
import { AiService } from './aiService';

function backend(initial: LibrarySnapshot | null = null) {
  let data = structuredClone(initial);
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
  return { storage, snapshot: () => structuredClone(data)! };
}

function services(storage: LibraryStorage) {
  const library = new LibraryService(storage, async () => ({
    metadata: emptyMetadata('论文'), pages: [{ page: 1, text: 'Research evidence.' }], pageCount: 1,
  }));
  const completion = vi.fn().mockResolvedValue('回答');
  const ai = new AiService(library, completion);
  return { library, ai, completion };
}

async function setup(initial?: LibrarySnapshot) {
  const store = backend(initial);
  const app = services(store.storage);
  await app.ai.loadAssistantSession();
  return { ...store, ...app };
}

function session(ai: { getView(): { answerEpoch: number } }, label: string): AiAssistantSession {
  return { epoch: ai.getView().answerEpoch, messages: [
    { id: 1, role: 'user', content: `${label}问题`, contextKey: 'direct' },
    { id: 2, role: 'assistant', content: `${label}回答`, contextKey: 'direct' },
  ], draft: `${label}草稿`, scope: 'all', selectedPaperIds: [], fileQuery: label, mode: 'direct' };
}

async function save(ai: AiService, label: string) {
  ai.saveAssistantSession(session(ai, label));
  await ai.flushAssistantSession();
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('pinned AI conversation histories', () => {
  async function histories(count: number) {
    const app = await setup();
    const ids = [];
    for (let index = 0; index < count; index += 1) {
      if (index) await app.ai.createConversation();
      await save(app.ai, `会话${index + 1}`);
      ids.push(app.ai.getView().activeConversationId!);
    }
    return { ...app, ids };
  }

  it('puts pinned histories first in both navigation and search without changing their timestamps or payloads', async () => {
    const app = await histories(4);
    const before = app.snapshot().aiConversations!;
    const order = app.ai.getView().conversations!.map((entry) => entry.id);
    const pinned = order.slice(-2);
    for (const id of pinned) await app.ai.setConversationPinned(id, true);
    const expected = [...pinned, ...order.filter((id) => !pinned.includes(id))];
    expect(app.ai.getView().conversations?.map((entry) => entry.id)).toEqual(expected);
    expect((await app.ai.searchConversations('会话')).map((entry) => entry.id)).toEqual(expected);
    for (const entry of app.snapshot().aiConversations!.entries) {
      const original = before.entries.find((item) => item.id === entry.id)!;
      expect(entry).toEqual(pinned.includes(entry.id) ? { ...original, pinned: true, pinOrder: pinned.indexOf(entry.id) } : original);
    }
    for (const id of pinned) await app.ai.setConversationPinned(id, false);
    expect(app.ai.getView().conversations?.map((entry) => entry.id)).toEqual(order);
    expect((await app.ai.searchConversations('')).map((entry) => entry.id)).toEqual(order);
    app.ai.dispose();
  });

  it('enforces ten pins atomically, permits unpinning at the limit and frees a slot on deletion', async () => {
    const app = await histories(12);
    for (const id of app.ids.slice(0, 9)) await app.library.setAiConversationPinned(id, true);
    const attempts = await Promise.allSettled(app.ids.slice(9, 11).map((id) => app.library.setAiConversationPinned(id, true)));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ message: expect.stringContaining('最多置顶 10 个会话') }) });
    expect(app.snapshot().aiConversations?.entries.filter((entry) => entry.pinned)).toHaveLength(10);
    await app.ai.setConversationPinned(app.ids[0], true);
    const before = app.snapshot();
    await expect(app.ai.setConversationPinned(app.ids[11], true)).rejects.toThrow('最多置顶 10 个会话');
    expect(app.snapshot()).toEqual(before);
    await app.ai.setConversationPinned(app.ids[0], false);
    await app.ai.setConversationPinned(app.ids[11], true);
    expect(app.snapshot().aiConversations?.entries.filter((entry) => entry.pinned)).toHaveLength(10);
    await app.ai.deleteConversation(app.ids[1]);
    await app.ai.setConversationPinned(app.ids[0], true);
    expect(app.snapshot().aiConversations?.entries.filter((entry) => entry.pinned)).toHaveLength(10);
    app.ai.dispose();
  });

  it('persists a manual order without changing chats and keeps it through renames, autosaves and restart', async () => {
    const app = await histories(4);
    for (const id of app.ids.slice(0, 3)) await app.ai.setConversationPinned(id, true);
    const desired = [app.ids[2], app.ids[0], app.ids[1]];
    const before = app.snapshot().aiConversations!;
    const active = app.ai.getAssistantSession();
    await app.ai.reorderPinnedConversations(desired);
    expect(app.ai.getView().activeConversationId).toBe(before.activeId);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.ai.getView().conversations?.map((entry) => entry.id)).toEqual([...desired, app.ids[3]]);
    expect((await app.ai.searchConversations('会话')).map((entry) => entry.id)).toEqual([...desired, app.ids[3]]);
    for (const entry of app.snapshot().aiConversations!.entries) {
      const original = before.entries.find((item) => item.id === entry.id)!;
      expect(entry).toEqual(entry.pinned ? { ...original, pinOrder: desired.indexOf(entry.id) } : original);
    }
    await app.ai.renameConversation(app.ids[0], '重命名后的常用会话');
    await app.ai.selectConversation(app.ids[1]);
    await save(app.ai, '最新的问答');
    await app.ai.selectConversation(app.ids[3]);
    expect(app.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual(desired);
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().activeConversationId).toBe(app.ids[3]);
    expect(restarted.ai.getAssistantSession()?.draft).toBe(active?.draft);
    expect(restarted.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual(desired);
    expect((await restarted.ai.searchConversations('')).filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual(desired);
    await restarted.ai.selectConversation(app.ids[0]);
    expect(restarted.ai.getAssistantSession()).toMatchObject({ title: '重命名后的常用会话', messages: session(restarted.ai, '会话1').messages });
    restarted.ai.dispose();
  });

  it('keeps legacy pin order on load, appends new pins and preserves remaining order after unpinning or deletion', async () => {
    const app = await histories(4);
    app.ai.dispose();
    const legacy = app.snapshot();
    legacy.aiConversations!.entries.forEach((entry, index) => {
      entry.updatedAt = `2026-10-${20 + index}T00:00:00.000Z`;
      if (index < 2) entry.pinned = true;
      delete entry.pinOrder;
    });
    const stored = await app.storage.load();
    await app.storage.commit(stored.revision, legacy, []);
    const commits = vi.mocked(app.storage.commit).mock.calls.length;
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(app.snapshot()).toEqual(legacy);
    expect(app.storage.commit).toHaveBeenCalledTimes(commits);
    expect(restarted.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[1], app.ids[0]]);
    await restarted.ai.setConversationPinned(app.ids[2], true);
    expect(restarted.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[1], app.ids[0], app.ids[2]]);
    await restarted.ai.reorderPinnedConversations([app.ids[2], app.ids[0], app.ids[1]]);
    await restarted.ai.setConversationPinned(app.ids[0], false);
    expect(app.snapshot().aiConversations?.entries[0].pinOrder).toBeUndefined();
    await restarted.ai.setConversationPinned(app.ids[0], true);
    expect(restarted.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[2], app.ids[1], app.ids[0]]);
    await restarted.ai.deleteConversation(app.ids[1]);
    await restarted.ai.setConversationPinned(app.ids[3], true);
    expect(restarted.ai.getView().conversations?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual([app.ids[2], app.ids[0], app.ids[3]]);
    restarted.ai.dispose();
  });

  it('rejects duplicate, missing, unknown, unpinned and stale reorder requests without writing', async () => {
    const app = await histories(3);
    await app.ai.setConversationPinned(app.ids[0], true);
    await app.ai.setConversationPinned(app.ids[1], true);
    const before = app.snapshot();
    const active = app.ai.getAssistantSession();
    const commits = vi.mocked(app.storage.commit).mock.calls.length;
    for (const ids of [[app.ids[0], app.ids[0]], [app.ids[0]], [app.ids[0], 'missing'], [app.ids[0], app.ids[2]], app.ids]) {
      await expect(app.ai.reorderPinnedConversations(ids)).rejects.toThrow('置顶会话列表已变化');
      expect(app.snapshot()).toEqual(before);
      expect(app.ai.getAssistantSession()).toEqual(active);
      expect(app.storage.commit).toHaveBeenCalledTimes(commits);
    }
    await app.ai.setConversationPinned(app.ids[1], false);
    const afterUnpin = app.snapshot();
    await expect(app.ai.reorderPinnedConversations(app.ids.slice(0, 2))).rejects.toThrow('置顶会话列表已变化');
    expect(app.snapshot()).toEqual(afterUnpin);
    app.ai.dispose();
  });

  it('keeps the original order and context on a failed save and permits retrying', async () => {
    const app = await histories(2);
    for (const id of app.ids) await app.ai.setConversationPinned(id, true);
    const before = app.snapshot();
    const active = app.ai.getAssistantSession();
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    await expect(app.ai.reorderPinnedConversations([...app.ids].reverse())).rejects.toThrow('disk full');
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.ai.getView().conversations?.map((entry) => entry.id)).toEqual(app.ids);
    await app.ai.reorderPinnedConversations([...app.ids].reverse());
    expect(app.ai.getView().conversations?.map((entry) => entry.id)).toEqual([...app.ids].reverse());
    app.ai.dispose();
  });

  it('waits for pending drafts and ordering before shutdown and copies the requested order', async () => {
    const app = await histories(2);
    for (const id of app.ids) await app.ai.setConversationPinned(id, true);
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(app.storage.commit).mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    app.ai.saveAssistantSession(session(app.ai, '最新'));
    const order = [...app.ids].reverse();
    const sorting = app.ai.reorderPinnedConversations(order);
    order.reverse();
    let closed = false;
    const closing = app.ai.flushAssistantSession().then(() => { closed = true; });
    await vi.waitFor(() => expect(app.ai.getView().conversationBusy).toBe(true));
    expect(closed).toBe(false);
    release();
    await Promise.all([sorting, closing]);
    expect(app.ai.getView().conversations?.map((entry) => entry.id)).toEqual([...app.ids].reverse());
    expect(app.ai.getAssistantSession()?.draft).toBe('最新草稿');
    app.ai.dispose();
  });

  it('restores pins after restart without sharing names, models or drafts between conversations', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] });
    await save(app.ai, '第一份');
    const first = app.ai.getView().activeConversationId!;
    await app.ai.renameConversation(first, '常用课题');
    await app.ai.setConversationPinned(first, true);
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    expect(app.ai.getView().conversations?.find((entry) => entry.id === second)?.pinned).toBe(false);
    await app.ai.selectProvider(provider.id, 'two');
    await save(app.ai, '第二份');
    const active = app.ai.getAssistantSession();
    await app.ai.setConversationPinned(first, false);
    await app.ai.setConversationPinned(first, true);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.ai.getView().conversationSelection?.model).toBe('two');
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().activeConversationId).toBe(second);
    expect(restarted.ai.getAssistantSession()?.draft).toBe('第二份草稿');
    expect(restarted.ai.getView().conversations?.[0]).toMatchObject({ id: first, title: '常用课题', pinned: true });
    await restarted.ai.selectConversation(first);
    expect(restarted.ai.getAssistantSession()).toMatchObject({ title: '常用课题', draft: '第一份草稿' });
    expect(restarted.ai.getView().conversationSelection?.model).toBe('one');
    restarted.ai.dispose();
  });

  it('loads older histories as unpinned without rewriting their records', async () => {
    const app = await histories(2);
    const before = app.snapshot();
    expect(before.aiConversations?.entries.every((entry) => entry.pinned === undefined)).toBe(true);
    const commits = vi.mocked(app.storage.commit).mock.calls.length;
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().conversations?.every((entry) => entry.pinned === false)).toBe(true);
    expect(app.snapshot()).toEqual(before);
    expect(app.storage.commit).toHaveBeenCalledTimes(commits);
    restarted.ai.dispose();
  });

  it.each([true, false])('preserves records and permits retrying when saving pinned=%s fails', async (pinned) => {
    const app = await histories(2);
    const id = app.ids[0];
    await app.ai.setConversationPinned(id, !pinned);
    const before = app.snapshot();
    const active = app.ai.getAssistantSession();
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    await expect(app.ai.setConversationPinned(id, pinned)).rejects.toThrow('disk full');
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.ai.getView().conversationBusy).toBe(false);
    await app.ai.setConversationPinned(id, pinned);
    expect(app.ai.getView().conversations?.find((entry) => entry.id === id)?.pinned).toBe(pinned);
    await expect(app.ai.setConversationPinned('missing', true)).rejects.toThrow('历史会话不存在');
    app.ai.dispose();
  });

  it('pins a locked encrypted history without decrypting its contents or changing the active conversation', async () => {
    const app = await setup();
    const paper = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nprivate pin'), 'private.pdf');
    const folder = await app.library.createFolder('私密');
    await app.library.categorize([paper.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'private password');
    const privateId = app.ai.getView().activeConversationId!;
    app.ai.saveAssistantSession({ ...session(app.ai, 'PRIVATE'), selectedPaperIds: [paper.id] });
    await app.ai.flushAssistantSession();
    await app.ai.renameConversation(privateId, 'SECRET');
    await app.ai.createConversation();
    await save(app.ai, '公开');
    const publicId = app.ai.getView().activeConversationId!;
    await app.ai.setConversationPinned(publicId, true);
    await app.library.lockVault(vault.id);
    const ciphertext = app.snapshot().aiConversations?.entries.find((entry) => entry.id === privateId)?.session;
    await app.ai.setConversationPinned(privateId, true);
    await app.ai.reorderPinnedConversations([privateId, publicId]);
    expect(app.ai.getView().conversations?.[0]).toMatchObject({ id: privateId, title: '加密会话', pinned: true, locked: true });
    expect((await app.ai.searchConversations(''))[0]).toMatchObject({ id: privateId, pinned: true });
    expect(await app.ai.searchConversations('SECRET')).toEqual([]);
    expect(app.snapshot().aiConversations?.entries.find((entry) => entry.id === privateId)?.session).toEqual(ciphertext);
    expect(app.ai.getAssistantSession()?.draft).toBe('公开草稿');
    expect(JSON.stringify(app.snapshot())).not.toMatch(/PRIVATE|SECRET/);
    await app.ai.setConversationPinned(privateId, false);
    app.ai.dispose();
  });

  it('waits for a pending pin before shutdown and retains the latest draft', async () => {
    const app = await histories(1);
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(app.storage.commit).mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    app.ai.saveAssistantSession(session(app.ai, '最新'));
    const pinning = app.ai.setConversationPinned(app.ids[0], true);
    let closed = false;
    const closing = app.ai.flushAssistantSession().then(() => { closed = true; });
    await vi.waitFor(() => expect(app.ai.getView().conversationBusy).toBe(true));
    expect(closed).toBe(false);
    release();
    await Promise.all([pinning, closing]);
    expect(app.snapshot().aiConversations?.entries[0].pinned).toBe(true);
    expect(app.ai.getAssistantSession()?.draft).toBe('最新草稿');
    app.ai.dispose();
  });
});

describe('conversation names and local search', () => {
  it('keeps a custom name through autosaves, follow-ups and restart', async () => {
    const app = await setup();
    await save(app.ai, '原始');
    const id = app.ai.getView().activeConversationId!;
    const before = app.ai.getAssistantSession()!;
    await app.ai.renameConversation(id, '  课题一\n  文献讨论  ');
    expect(app.ai.getAssistantSession()).toEqual({ ...before, title: '课题一 文献讨论' });
    expect(app.ai.getView().conversations?.find((entry) => entry.id === id)?.title).toBe('课题一 文献讨论');
    app.ai.saveAssistantSession({ ...before, draft: '继续追问的草稿' });
    await app.ai.flushAssistantSession();
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getAssistantSession()).toEqual({ ...before, draft: '继续追问的草稿', title: '课题一 文献讨论' });
    expect((await restarted.ai.searchConversations('文献讨论')).map((entry) => entry.id)).toEqual([id]);
    restarted.ai.dispose();
  });

  it('renames an inactive conversation without changing either model selection or the active draft', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] });
    await save(app.ai, '第一份');
    const first = app.ai.getView().activeConversationId!;
    const firstSession = await app.library.loadAiAssistantSession(first);
    await app.ai.createConversation();
    await app.ai.selectProvider(provider.id, 'two');
    await save(app.ai, '第二份');
    const before = app.snapshot();
    const activeSession = app.ai.getAssistantSession();
    await app.ai.renameConversation(first, '第一份的新名称');
    const after = app.snapshot();
    expect(after.ai).toEqual(before.ai);
    expect(after.aiConversations?.activeId).toBe(before.aiConversations?.activeId);
    expect(after.aiConversations?.entries.find((entry) => entry.id !== first)).toEqual(before.aiConversations?.entries.find((entry) => entry.id !== first));
    expect(after.aiConversations?.entries.find((entry) => entry.id === first)?.selection).toEqual({ providerId: provider.id, model: 'one' });
    expect(app.ai.getView().conversationSelection).toEqual({ providerId: provider.id, model: 'two' });
    expect(app.ai.getAssistantSession()).toEqual(activeSession);
    expect(await app.library.loadAiAssistantSession(first)).toEqual({ ...firstSession, title: '第一份的新名称' });
    app.ai.dispose();
  });

  it('names an empty conversation without inheriting that name into a new conversation', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    await app.ai.renameConversation(first, '待讨论的课题');
    expect(app.ai.getAssistantSession()?.messages).toEqual([]);
    await app.ai.createConversation();
    expect(app.ai.getAssistantSession()).toBeNull();
    expect(app.ai.getView().conversations?.find((entry) => entry.id !== first)?.title).toBe('新对话');
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    await restarted.ai.selectConversation(first);
    expect(restarted.ai.getAssistantSession()).toMatchObject({ title: '待讨论的课题', messages: [], draft: '' });
    restarted.ai.dispose();
  });

  it.each(['', '  \n ', '字'.repeat(101)])('rejects an invalid name without changing saved data: %j', async (title) => {
    const app = await setup();
    await save(app.ai, '保留');
    const before = app.snapshot();
    const active = app.ai.getAssistantSession();
    const commits = vi.mocked(app.storage.commit).mock.calls.length;
    await expect(app.ai.renameConversation(app.ai.getView().activeConversationId!, title)).rejects.toThrow('1–100');
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.storage.commit).toHaveBeenCalledTimes(commits);
    await expect(app.ai.renameConversation('missing', '有效名称')).rejects.toThrow('历史会话不存在');
    expect(app.storage.commit).toHaveBeenCalledTimes(commits);
    app.ai.dispose();
  });

  it('retains the original name and context on a failed rename and permits retrying', async () => {
    const app = await setup();
    await save(app.ai, '原始');
    const id = app.ai.getView().activeConversationId!;
    const before = app.snapshot();
    const active = app.ai.getAssistantSession();
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    await expect(app.ai.renameConversation(id, '新名称')).rejects.toThrow('disk full');
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.ai.getView().conversations?.[0].title).toBe('原始问题');
    await app.ai.renameConversation(id, '新名称');
    expect(app.ai.getView().conversations?.[0].title).toBe('新名称');
    app.ai.dispose();
  });

  it('searches names and all completed question and answer text locally without changing the active history', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    const one = session(app.ai, '第一份');
    one.messages[1].content = 'An analysis of Neural   Networks and 上下文';
    one.messages.push({ id: 3, role: 'user', content: '后来追问的关键词', contextKey: 'direct' });
    one.draft = '未发送的独有草稿';
    app.ai.saveAssistantSession(one);
    await app.ai.flushAssistantSession();
    await app.ai.renameConversation(first, '科研课题');
    await app.ai.createConversation();
    await save(app.ai, '第二份');
    const second = app.ai.getView().activeConversationId!;
    const before = app.snapshot();
    for (const query of ['科研课题', '第一份问题', ' neural\n NETWORKS ', '上下文', '后来追问的关键词']) {
      expect((await app.ai.searchConversations(query)).map((entry) => entry.id)).toEqual([first]);
    }
    expect((await app.ai.searchConversations('第二份回答')).map((entry) => entry.id)).toEqual([second]);
    expect(await app.ai.searchConversations('不存在的记录')).toEqual([]);
    expect(await app.ai.searchConversations('未发送的独有草稿')).toEqual([]);
    expect(await app.ai.searchConversations('  \n ')).toHaveLength(2);
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getView().activeConversationId).toBe(second);
    expect(app.ai.getAssistantSession()?.draft).toBe('第二份草稿');
    expect(app.completion).not.toHaveBeenCalled();
    app.ai.dispose();
  });

  it('encrypts custom names and searches private histories only after every required vault is unlocked', async () => {
    const app = await setup();
    const vaults = [];
    const ids = [];
    for (const label of ['one', 'two']) {
      const paper = await app.library.importPdf(new TextEncoder().encode(`%PDF-1.7\n${label}`), `${label}.pdf`);
      const folder = await app.library.createFolder(label);
      await app.library.categorize([paper.id], [folder.id], 'move');
      vaults.push(await app.library.encryptFolder(folder.id, 'private password'));
      ids.push(paper.id);
    }
    const privateId = app.ai.getView().activeConversationId!;
    app.ai.saveAssistantSession({ ...session(app.ai, 'PRIVATE'), selectedPaperIds: ids });
    await app.ai.flushAssistantSession();
    await app.ai.renameConversation(privateId, 'SECRET-NAME');
    await app.ai.createConversation();
    await save(app.ai, '公开');
    expect((await app.ai.searchConversations('secret-name')).map((entry) => entry.id)).toEqual([privateId]);
    expect((await app.ai.searchConversations('PRIVATE回答')).map((entry) => entry.id)).toEqual([privateId]);
    expect(JSON.stringify(app.snapshot())).not.toMatch(/PRIVATE|SECRET-NAME/);
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    const before = app.snapshot();
    expect((await restarted.ai.searchConversations('')).find((entry) => entry.id === privateId)).toMatchObject({ title: '加密会话', locked: true });
    expect(await restarted.ai.searchConversations('PRIVATE')).toEqual([]);
    await expect(restarted.ai.renameConversation(privateId, '不会泄露')).rejects.toThrow('请先解锁');
    expect(app.snapshot()).toEqual(before);
    await restarted.library.unlockVault(vaults[0].id, 'private password');
    expect(await restarted.ai.searchConversations('secret-name')).toEqual([]);
    await restarted.library.unlockVault(vaults[1].id, 'private password');
    expect((await restarted.ai.searchConversations('secret-name')).map((entry) => entry.id)).toEqual([privateId]);
    await restarted.ai.renameConversation(privateId, 'SECRET-UPDATED');
    expect((await restarted.library.loadAiAssistantSession(privateId))?.messages).toEqual(session(app.ai, 'PRIVATE').messages);
    await restarted.library.lockVault(vaults[0].id);
    expect(await restarted.ai.searchConversations('secret-updated')).toEqual([]);
    expect(restarted.ai.getAssistantSession()?.draft).toBe('公开草稿');
    expect(JSON.stringify(app.snapshot())).not.toMatch(/PRIVATE|SECRET-/);
    restarted.ai.dispose();
  });

  it('discards private matches when a vault is locked during decryption', async () => {
    const app = await setup();
    const paper = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nprivate search'), 'private.pdf');
    const folder = await app.library.createFolder('私密');
    await app.library.categorize([paper.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'private password');
    app.ai.saveAssistantSession({ ...session(app.ai, 'PRIVATE'), selectedPaperIds: [paper.id] });
    await app.ai.flushAssistantSession();
    await app.ai.renameConversation(app.ai.getView().activeConversationId!, 'SECRET');
    await app.ai.createConversation();
    await save(app.ai, '公开');
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => { await gate; return decrypt(...args); });
    try {
      const searching = app.ai.searchConversations('PRIVATE');
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      const locking = app.library.lockVault(vault.id);
      release();
      expect(await searching).toEqual([]);
      await locking;
      expect(JSON.stringify(await app.ai.searchConversations(''))).not.toMatch(/PRIVATE|SECRET/);
    } finally { release(); spy.mockRestore(); app.ai.dispose(); }
  });

  it('waits for the latest draft before renaming and flushes a pending rename before shutdown', async () => {
    const app = await setup();
    await save(app.ai, '初始');
    const id = app.ai.getView().activeConversationId!;
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(app.storage.commit).mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    app.ai.saveAssistantSession(session(app.ai, '最新'));
    const renaming = app.ai.renameConversation(id, '新名称');
    let closed = false;
    const closing = app.ai.flushAssistantSession().then(() => { closed = true; });
    await vi.waitFor(() => expect(app.ai.getView().conversationBusy).toBe(true));
    expect(closed).toBe(false);
    release();
    await Promise.all([renaming, closing]);
    expect(await app.library.loadAiAssistantSession(id)).toMatchObject({ title: '新名称', draft: '最新草稿', messages: session(app.ai, '最新').messages });
    app.ai.dispose();
  });

  it('cancels obsolete searches without writing or changing the current conversation', async () => {
    const app = await setup();
    await save(app.ai, '保留');
    const before = app.snapshot();
    const controller = new AbortController();
    const searching = app.ai.searchConversations('保留', controller.signal);
    controller.abort();
    await expect(searching).rejects.toMatchObject({ name: 'AbortError' });
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getAssistantSession()?.draft).toBe('保留草稿');
    app.ai.dispose();
  });
});

describe('independent local AI conversations', () => {
  it('restores different models of the same provider without changing another conversation', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'model-one', models: ['model-two'] }, 'fixture-key');
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '第一份');
    const before = app.snapshot().aiConversations!.entries.find((entry) => entry.id === first);
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    expect(app.ai.getView().conversationSelection).toEqual({ providerId: provider.id, model: 'model-one' });
    await app.ai.selectProvider(provider.id, 'model-two');
    await save(app.ai, '第二份');
    expect(app.snapshot().aiConversations!.entries.find((entry) => entry.id === first)).toEqual(before);
    await app.ai.selectConversation(first);
    expect(app.ai.getView().conversationSelection).toEqual({ providerId: provider.id, model: 'model-one' });
    await app.ai.ask('第一份追问', { grounding: 'direct' });
    expect(app.completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: provider.id, model: 'model-one' }), 'fixture-key']);
    await app.ai.selectConversation(second);
    expect(app.ai.getView().conversationSelection).toEqual({ providerId: provider.id, model: 'model-two' });
    await app.ai.ask('第二份追问', { grounding: 'direct' });
    expect(app.completion.mock.calls.at(-1)![0].model).toBe('model-two');
    app.ai.dispose();
  });

  it('restores each provider, endpoint, model and key after switching and restarting', async () => {
    const app = await setup();
    const one = await app.ai.saveProvider({ name: '厂商甲', baseUrl: 'https://one.example/v1', model: 'one', models: ['one-fast'] }, 'fixture-one', undefined, true);
    const two = await app.ai.saveProvider({ name: '厂商乙', baseUrl: 'https://two.example/v1', model: 'two' }, 'fixture-two', undefined, true);
    const first = app.ai.getView().activeConversationId!;
    await app.ai.selectProvider(one.id, 'one-fast');
    await save(app.ai, '甲');
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    await app.ai.selectProvider(two.id);
    await save(app.ai, '乙');
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().activeConversationId).toBe(second);
    expect(restarted.ai.getView().conversationSelection).toEqual({ providerId: two.id, model: 'two' });
    await restarted.ai.ask('乙追问', { grounding: 'direct' });
    expect(restarted.completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: two.id, baseUrl: two.baseUrl, model: 'two' }), 'fixture-two']);
    await restarted.ai.selectConversation(first);
    await restarted.ai.ask('甲追问', { grounding: 'direct' });
    expect(restarted.completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: one.id, baseUrl: one.baseUrl, model: 'one-fast' }), 'fixture-one']);
    expect(restarted.ai.getAssistantSession()?.draft).toBe('甲草稿');
    expect(JSON.stringify(app.snapshot().aiConversations)).not.toContain('fixture-one');
    restarted.ai.dispose();
  });

  it('persists selections for empty conversations and inherits them by value on creation', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] });
    const first = app.ai.getView().activeConversationId!;
    await app.ai.selectProvider(provider.id, 'two');
    expect(app.ai.getAssistantSession()).toBeNull();
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    expect(app.ai.getView().conversationSelection?.model).toBe('two');
    await app.ai.selectProvider(provider.id, 'one');
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().activeConversationId).toBe(second);
    expect(restarted.ai.getView().conversationSelection?.model).toBe('one');
    await restarted.ai.selectConversation(first);
    expect(restarted.ai.getView().conversationSelection?.model).toBe('two');
    expect(restarted.ai.getAssistantSession()).toBeNull();
    restarted.ai.dispose();
  });

  it('initializes old history selections once without modifying chat payloads or dates', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] });
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '旧会话');
    await app.ai.createConversation();
    await app.ai.selectProvider(provider.id, 'two');
    await app.ai.flushAssistantSession();
    app.ai.dispose();
    const stored = await app.storage.load();
    for (const entry of stored.data!.aiConversations!.entries) delete entry.selection;
    const before = structuredClone(stored.data!.aiConversations!);
    await app.storage.commit(stored.revision, stored.data!, []);
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    for (const entry of app.snapshot().aiConversations!.entries) {
      const old = before.entries.find((item) => item.id === entry.id)!;
      expect(entry).toEqual({ ...old, selection: { providerId: provider.id, model: 'two' } });
    }
    await restarted.ai.selectProvider(provider.id, 'one');
    await restarted.ai.selectConversation(first);
    expect(restarted.ai.getView().conversationSelection?.model).toBe('two');
    restarted.ai.dispose();
  });

  it('atomically rolls back both selection and defaults when changing the model fails', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] }, 'fixture-key');
    await save(app.ai, '保留');
    const before = app.snapshot();
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    await expect(app.ai.selectProvider(provider.id, 'two')).rejects.toThrow('disk full');
    expect(app.snapshot()).toEqual(before);
    expect(app.ai.getView().conversationSelection).toEqual({ providerId: provider.id, model: 'one' });
    expect(app.ai.getAssistantSession()?.draft).toBe('保留草稿');
    await app.ai.ask('继续', { grounding: 'direct' });
    expect(app.completion.mock.calls.at(-1)![0].model).toBe('one');
    app.ai.dispose();
  });

  it('retains unavailable selections and blocks requests until explicitly reselected', async () => {
    const app = await setup();
    const one = await app.ai.saveProvider({ name: '甲', baseUrl: 'https://one.example/v1', model: 'one', models: ['removed'] }, 'fixture-one');
    const two = await app.ai.saveProvider({ name: '乙', baseUrl: 'https://two.example/v1', model: 'two' }, 'fixture-two');
    const first = app.ai.getView().activeConversationId!;
    await app.ai.selectProvider(one.id, 'removed');
    await save(app.ai, '保留');
    await app.ai.createConversation();
    await app.ai.selectProvider(two.id);
    await app.ai.saveProvider({ ...one, model: 'one', models: ['one'] });
    await app.ai.selectConversation(first);
    expect(app.ai.getView().conversationSelection?.model).toBe('removed');
    await expect(app.ai.ask('继续', { grounding: 'direct' })).rejects.toThrow('模型已不在厂商配置中');
    expect(app.completion).not.toHaveBeenCalled();
    await app.ai.removeProvider(one.id);
    expect(app.ai.getAssistantSession()?.draft).toBe('保留草稿');
    await expect(app.ai.ask('继续', { grounding: 'direct' })).rejects.toThrow('厂商配置已删除');
    expect(app.completion).not.toHaveBeenCalled();
    await app.ai.selectProvider(two.id);
    await app.ai.ask('继续', { grounding: 'direct' });
    expect(app.completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: two.id, model: 'two' }), 'fixture-two']);
    app.ai.dispose();
  });

  it('updates a model edited in settings only for the active conversation', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] }, 'fixture-key');
    const first = app.ai.getView().activeConversationId!;
    await app.ai.createConversation();
    await app.ai.selectProvider(provider.id, 'two');
    await app.ai.saveProvider({ ...provider, model: 'three', models: ['one', 'two', 'three'] });
    expect(app.ai.getView().conversationSelection?.model).toBe('three');
    await app.ai.selectConversation(first);
    expect(app.ai.getView().conversationSelection?.model).toBe('one');
    await app.ai.ask('继续', { grounding: 'direct' });
    expect(app.completion.mock.calls.at(-1)![0].model).toBe('one');
    app.ai.dispose();
  });

  it('blocks requests and selection changes while a conversation switch is being persisted', async () => {
    const app = await setup();
    const provider = await app.ai.saveProvider({ name: '厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] }, 'fixture-key');
    const first = app.ai.getView().activeConversationId!;
    await app.ai.createConversation();
    await app.ai.selectProvider(provider.id, 'two');
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writes = vi.mocked(app.storage.commit).mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    writes.mockClear();
    const switching = app.ai.selectConversation(first);
    await vi.waitFor(() => expect(writes).toHaveBeenCalledOnce());
    await expect(app.ai.ask('尚未切换完', { grounding: 'direct' })).rejects.toThrow('会话操作完成');
    await expect(app.ai.selectProvider(provider.id, 'one')).rejects.toThrow('会话操作完成');
    expect(app.ai.getView().conversationSelection?.model).toBe('two');
    expect(app.completion).not.toHaveBeenCalled();
    release();
    await switching;
    await app.ai.ask('已经切换完', { grounding: 'direct' });
    expect(app.completion.mock.calls.at(-1)![0].model).toBe('one');
    app.ai.dispose();
  });

  it('migrates the existing single conversation without losing content or duplicating it on restart', async () => {
    const initial = emptyLibrary();
    const { epoch: _epoch, ...legacy } = session({ getView: () => ({ answerEpoch: 0 }) }, '旧会话');
    initial.aiSession = { kind: 'plain', paperIds: [], session: legacy };
    const app = await setup(initial);
    expect(app.ai.getAssistantSession()).toEqual({ ...legacy, epoch: 0 });
    expect(app.snapshot().aiSession).toBeUndefined();
    expect(app.snapshot().aiConversations?.entries).toHaveLength(1);
    const id = app.ai.getView().activeConversationId;
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().activeConversationId).toBe(id);
    expect(restarted.ai.getView().conversations).toHaveLength(1);
    expect(restarted.ai.getAssistantSession()?.draft).toBe('旧会话草稿');
    restarted.ai.dispose();
  });

  it('keeps each conversation, draft, mode and file scope independent across selection and restart', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '第一份');
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    expect(second).not.toBe(first);
    expect(app.ai.getAssistantSession()).toBeNull();
    await save(app.ai, '第二份');
    await app.ai.selectConversation(first);
    expect(app.ai.getAssistantSession()).toMatchObject({ draft: '第一份草稿', fileQuery: '第一份', messages: [
      expect.objectContaining({ content: '第一份问题' }), expect.objectContaining({ content: '第一份回答' }),
    ] });
    await app.ai.selectConversation(second);
    expect(app.ai.getAssistantSession()?.draft).toBe('第二份草稿');
    app.ai.dispose();
    const restarted = services(app.storage);
    await restarted.ai.loadAssistantSession();
    expect(restarted.ai.getView().activeConversationId).toBe(second);
    expect(restarted.ai.getAssistantSession()?.draft).toBe('第二份草稿');
    await restarted.ai.selectConversation(first);
    expect(restarted.ai.getAssistantSession()?.draft).toBe('第一份草稿');
    restarted.ai.dispose();
  });

  it('deletes only the chosen conversation and creates a usable empty conversation after the last deletion', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '保留');
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    await save(app.ai, '删除');
    await app.ai.deleteConversation(first);
    expect(app.ai.getView().activeConversationId).toBe(second);
    expect(app.ai.getAssistantSession()?.draft).toBe('删除草稿');
    expect(app.snapshot().aiConversations?.entries.map((entry) => entry.id)).toEqual([second]);
    await app.ai.deleteConversation(second);
    expect(app.ai.getView().conversations).toHaveLength(1);
    expect(app.ai.getView().activeConversationId).not.toBe(second);
    expect(app.ai.getAssistantSession()).toBeNull();
    expect(JSON.stringify(app.snapshot())).not.toContain('删除问题');
    await save(app.ai, '新会话');
    expect(app.ai.getAssistantSession()?.draft).toBe('新会话草稿');
    app.ai.dispose();
  });

  it('selects another saved conversation when deleting the active one', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '第一份');
    await app.ai.createConversation();
    const second = app.ai.getView().activeConversationId!;
    await save(app.ai, '第二份');
    await app.ai.deleteConversation(second);
    expect(app.ai.getView().activeConversationId).toBe(first);
    expect(app.ai.getAssistantSession()?.draft).toBe('第一份草稿');
    app.ai.dispose();
  });

  it.each(['create', 'select', 'delete'] as const)('preserves the active conversation and history when %s cannot be saved', async (operation) => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '第一份');
    await app.ai.createConversation();
    await save(app.ai, '第二份');
    const before = app.snapshot().aiConversations;
    const active = app.ai.getAssistantSession();
    vi.mocked(app.storage.commit).mockRejectedValueOnce(new Error('disk full'));
    const action = operation === 'create' ? app.ai.createConversation()
      : operation === 'select' ? app.ai.selectConversation(first) : app.ai.deleteConversation(first);
    await expect(action).rejects.toThrow('disk full');
    expect(app.snapshot().aiConversations).toEqual(before);
    expect(app.ai.getAssistantSession()).toEqual(active);
    expect(app.ai.getView().conversationBusy).toBe(false);
    app.ai.dispose();
  });

  it('rejects stale writes from a previously active conversation', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    const stale = session(app.ai, '旧内容');
    app.ai.saveAssistantSession(stale);
    await app.ai.createConversation();
    app.ai.saveAssistantSession(stale);
    await app.ai.flushAssistantSession();
    expect(app.ai.getAssistantSession()).toBeNull();
    await app.ai.selectConversation(first);
    expect(app.ai.getAssistantSession()?.draft).toBe('旧内容草稿');
    app.ai.dispose();
  });

  it('waits for pending writes before switching and for conversation changes before shutdown', async () => {
    const app = await setup();
    const first = app.ai.getView().activeConversationId!;
    await save(app.ai, '第一份');
    await app.ai.createConversation();
    const commit = vi.mocked(app.storage.commit).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(app.storage.commit).mockImplementationOnce(async (...args) => { await gate; return commit(...args); });
    app.ai.saveAssistantSession(session(app.ai, '待写入'));
    const selecting = app.ai.selectConversation(first);
    let closed = false;
    const closing = app.ai.flushAssistantSession().then(() => { closed = true; });
    await vi.waitFor(() => expect(app.ai.getView().conversationBusy).toBe(true));
    expect(closed).toBe(false);
    release();
    await Promise.all([selecting, closing]);
    expect(app.ai.getAssistantSession()?.draft).toBe('第一份草稿');
    expect(JSON.stringify(app.snapshot())).toContain('待写入草稿');
    app.ai.dispose();
  });

  it('retains encrypted histories while another conversation is active and permits deletion without unlocking', async () => {
    const app = await setup();
    const paper = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nprivate history'), 'private.pdf');
    const folder = await app.library.createFolder('加密');
    await app.library.categorize([paper.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'private password');
    const privateId = app.ai.getView().activeConversationId!;
    const privateSession = session(app.ai, 'PRIVATE');
    privateSession.selectedPaperIds = [paper.id];
    app.ai.saveAssistantSession(privateSession);
    await app.ai.flushAssistantSession();
    await app.ai.createConversation();
    await save(app.ai, '公开');
    await app.library.lockVault(vault.id);
    await app.ai.flushAssistantSession();
    expect(app.ai.getAssistantSession()?.draft).toBe('公开草稿');
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE');
    expect(app.ai.getView().conversations?.find((entry) => entry.id === privateId)).toMatchObject({ title: '加密会话', locked: true });
    await app.ai.selectConversation(privateId);
    expect(app.ai.getView().sessionLocked).toBe(true);
    await app.ai.createConversation();
    expect(app.ai.getView()).toMatchObject({ sessionLoaded: true, sessionLocked: false });
    await app.ai.deleteConversation(privateId);
    expect(app.ai.getView().conversations?.some((entry) => entry.id === privateId)).toBe(false);
    expect(JSON.stringify(app.snapshot())).toContain('公开草稿');
    app.ai.dispose();
  });

  it('invalidates protected context before its first pending save even when no sources were returned', async () => {
    const app = await setup();
    const paper = await app.library.importPdf(new TextEncoder().encode('%PDF-1.7\nprivate pending context'), 'private.pdf');
    const folder = await app.library.createFolder('私密');
    await app.library.categorize([paper.id], [folder.id], 'move');
    const vault = await app.library.encryptFolder(folder.id, 'private password');
    const saved = session(app.ai, 'PRIVATE');
    saved.messages = saved.messages.map((message) => ({ ...message, contextKey: JSON.stringify([paper.id]) }));
    app.ai.saveAssistantSession(saved);
    await app.library.lockVault(vault.id);
    await app.ai.flushAssistantSession();
    expect(app.ai.getAssistantSession()).toBeNull();
    expect(JSON.stringify(app.snapshot())).not.toContain('PRIVATE');
    app.ai.dispose();
  });
});
