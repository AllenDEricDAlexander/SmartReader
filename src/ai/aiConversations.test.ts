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
  const ai = new AiService(library, vi.fn().mockResolvedValue('回答'));
  return { library, ai };
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

describe('independent local AI conversations', () => {
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
