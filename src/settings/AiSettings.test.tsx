import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../ai/aiService';
import { LibraryService } from '../library/libraryService';
import type { LibrarySnapshot } from '../library/libraryModels';
import { AiSettings } from './AiSettings';

async function setup() {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const library = new LibraryService({
    load: async () => ({ revision, data: structuredClone(data) }),
    commit: async (_expected, next) => { data = structuredClone(next); return ++revision; },
    readFile: async () => new Uint8Array(),
  });
  await library.initialize();
  const completion = vi.fn().mockResolvedValue('OK');
  const ai = new AiService(library, completion);
  return { library, ai, completion };
}

function fillProvider() {
  fireEvent.change(screen.getByLabelText('厂商名称'), { target: { value: '我的兼容厂商' } });
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.example.com/v1' } });
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'user-selected-model' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'private-session-key' } });
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('AI settings', () => {
  it('opens the provider selected by the current conversation even when defaults point to another provider', async () => {
    const { library, ai } = await setup();
    const one = await ai.saveProvider({ name: '厂商甲', baseUrl: 'https://one.example/v1', model: 'one' }, 'fixture-one');
    const first = ai.getView().activeConversationId!;
    const two = await ai.saveProvider({ name: '厂商乙', baseUrl: 'https://two.example/v1', model: 'two' }, 'fixture-two');
    await ai.createConversation();
    await ai.selectProvider(two.id);
    await ai.selectConversation(first);
    expect(library.getView().snapshot.ai.activeProviderId).toBe(two.id);
    render(<AiSettings library={library} ai={ai} />);
    expect(screen.getByLabelText('选择厂商配置')).toHaveValue(one.id);
    expect(screen.getByLabelText('厂商名称')).toHaveValue('厂商甲');
    expect(screen.queryByRole('button', { name: '设为当前厂商' })).not.toBeInTheDocument();
    ai.dispose();
  });

  it('preserves each conversation model when saving a new key for their shared provider', async () => {
    const { library, ai, completion } = await setup();
    const provider = await ai.saveProvider({ name: '共用厂商', baseUrl: 'https://one.example/v1', model: 'one', models: ['two'] }, 'fixture-old');
    const first = ai.getView().activeConversationId!;
    await ai.createConversation();
    const second = ai.getView().activeConversationId!;
    await ai.selectProvider(provider.id, 'two');
    await ai.selectConversation(first);
    render(<AiSettings library={library} ai={ai} />);
    expect(screen.getByLabelText('模型名称')).toHaveValue('two');
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    expect(ai.getView().conversationSelection?.model).toBe('one');
    expect(library.getView().snapshot.aiConversations?.entries.find((entry) => entry.id === second)?.selection?.model).toBe('two');
    await ai.ask('继续', { grounding: 'direct' });
    expect(completion.mock.calls.at(-1)!.slice(0, 2)).toEqual([expect.objectContaining({ id: provider.id, model: 'one' }), 'fixture-new']);
    ai.dispose();
  });

  it('saves, reopens and edits multiple chat model presets while sharing the provider key', async () => {
    const { library, ai } = await setup();
    const first = render(<AiSettings library={library} ai={ai} />);
    fillProvider();
    fireEvent.change(screen.getByLabelText('其他可选模型'), { target: { value: ' fast-model \n\ndeep-model\nfast-model\nuser-selected-model' } });
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    const provider = library.getView().snapshot.ai.providers[0];
    expect(provider.models).toEqual(['user-selected-model', 'fast-model', 'deep-model']);
    expect(ai.hasApiKey(provider.id)).toBe(true);
    first.unmount();
    render(<AiSettings library={library} ai={ai} />);
    expect(screen.getByLabelText('其他可选模型')).toHaveValue('fast-model\ndeep-model');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('其他可选模型'), { target: { value: 'deep-model' } });
    expect(screen.getByRole('button', { name: '验证连接' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    expect(library.getView().snapshot.ai.providers[0].models).toEqual(['user-selected-model', 'deep-model']);
    expect(ai.hasApiKey(provider.id)).toBe(true);
    ai.dispose();
  });

  it('preconfigures providers and models without requiring a key before they are used', async () => {
    const { library, ai } = await setup();
    render(<AiSettings library={library} ai={ai} />);
    fillProvider();
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('其他可选模型'), { target: { value: 'fast-model' } });
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    const provider = library.getView().snapshot.ai.providers[0];
    expect(provider.models).toEqual(['user-selected-model', 'fast-model']);
    expect(ai.hasApiKey(provider.id)).toBe(false);
    expect(screen.getByRole('button', { name: '验证连接' })).toBeDisabled();
    ai.dispose();
  });

  it.each(['阿里云', 'aliyun'])('preserves an unset embedding model when opening and saving %s settings', async (name) => {
    const { library, ai, completion } = await setup();
    await ai.saveProvider({ name, baseUrl: 'https://api.example.com/v1', model: 'chat-model' }, 'session-key');
    render(<AiSettings library={library} ai={ai} />);
    expect(screen.getByLabelText('Embedding 模型')).toHaveValue('');
    expect(screen.getByRole('button', { name: '验证连接' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '验证连接' }));
    await screen.findByText('连接验证成功。');
    expect(completion).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    expect(library.getView().snapshot.ai.providers[0].embeddingModel).toBeUndefined();
    expect(screen.getByRole('button', { name: '验证连接' })).toBeEnabled();
    ai.dispose();
  });

  it('persists a separate embedding model and verifies its vector dimension', async () => {
    const { library, ai } = await setup();
    render(<AiSettings library={library} ai={ai} />);
    fillProvider();
    fireEvent.change(screen.getByLabelText('Embedding 模型'), { target: { value: 'text-embedding-v4' } });
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    expect(library.getView().snapshot.ai.providers[0]).toMatchObject({ model: 'user-selected-model', embeddingModel: 'text-embedding-v4' });
    vi.spyOn(ai, 'testEmbeddingConnection').mockResolvedValueOnce(1024);
    fireEvent.click(screen.getByRole('button', { name: '验证向量模型' }));
    await screen.findByText('向量模型验证成功，维度 1024。');
    ai.dispose();
  });

  it('configures cloud vector retrieval without persisting its token and forgets the token on endpoint change', async () => {
    const { library, ai } = await setup();
    render(<AiSettings library={library} ai={ai} />);
    fireEvent.change(screen.getByLabelText('向量检索位置'), { target: { value: 'milvus' } });
    fireEvent.change(screen.getByLabelText('Milvus 服务地址'), { target: { value: 'https://milvus.example.test/' } });
    fireEvent.change(screen.getByLabelText('Milvus 访问令牌'), { target: { value: 'private-vector-token' } });
    fireEvent.click(screen.getByRole('button', { name: '保存检索设置' }));
    await screen.findByText('知识库检索设置已保存。');
    expect(library.getView().snapshot.ai.knowledge).toEqual({ backend: 'milvus', milvusUrl: 'https://milvus.example.test' });
    expect(JSON.stringify(library.getView().snapshot)).not.toContain('private-vector-token');
    expect(ai.getView().milvusReady).toBe(true);
    fireEvent.change(screen.getByLabelText('Milvus 服务地址'), { target: { value: 'https://other-milvus.example.test/' } });
    fireEvent.click(screen.getByRole('button', { name: '保存检索设置' }));
    await waitFor(() => expect(ai.getView().milvusReady).toBe(false));
    ai.dispose();
  });
  it('saves provider settings and keeps the default session key masked and out of persistence', async () => {
    const { library, ai } = await setup();
    render(<AiSettings library={library} ai={ai} />);
    expect(screen.getByLabelText('模型名称')).toHaveValue('');
    fillProvider();
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    const provider = library.getView().snapshot.ai.providers[0];
    expect(provider).toMatchObject({ name: '我的兼容厂商', model: 'user-selected-model', savedKey: null });
    expect(ai.hasApiKey(provider.id)).toBe(true);
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(JSON.stringify(library.getView().snapshot)).not.toContain('private-session-key');
    expect(screen.getByText(/论文摘录/)).toBeInTheDocument();
    ai.dispose();
  });

  it('shows save failures without claiming success or exposing a password', async () => {
    const { library, ai } = await setup();
    vi.spyOn(ai, 'saveProvider').mockRejectedValueOnce(new Error('磁盘写入失败，请重试。'));
    render(<AiSettings library={library} ai={ai} />);
    fillProvider();
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘写入失败');
    expect(screen.queryByText('厂商配置已保存。')).not.toBeInTheDocument();
    expect(screen.queryByText('private-session-key')).not.toBeInTheDocument();
    expect(library.getView().snapshot.ai.providers).toEqual([]);
    ai.dispose();
  });

  it('requires a strong save password and stores only the encrypted key', async () => {
    const { library, ai } = await setup();
    render(<AiSettings library={library} ai={ai} />);
    fillProvider();
    fireEvent.change(screen.getByLabelText('密钥保存方式'), { target: { value: 'password' } });
    fireEvent.change(screen.getByLabelText('密钥保存密码'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByRole('form', { name: 'AI 厂商配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('至少 8');
    fireEvent.change(screen.getByLabelText('密钥保存密码'), { target: { value: 'private password' } });
    expect(screen.getByLabelText('密钥保存密码')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    expect(library.getView().snapshot.ai.providers[0].savedKey).not.toBeNull();
    expect(JSON.stringify(library.getView().snapshot)).not.toContain('private-session-key');
    expect(screen.queryByLabelText('密钥保存密码')).not.toBeInTheDocument();
    ai.dispose();
  });

  it('unlocks saved keys, validates the selected provider and forgets secrets', async () => {
    const { library, ai: previous, completion } = await setup();
    const provider = await previous.saveProvider({ name: '兼容服务', baseUrl: 'https://api.example.com/v1', model: 'chosen-model' }, 'stored-secret', 'saved password');
    previous.dispose();
    const ai = new AiService(library, completion);
    render(<AiSettings library={library} ai={ai} />);
    expect(screen.getByLabelText('密钥解锁密码')).toHaveAttribute('type', 'password');
    fireEvent.change(screen.getByLabelText('密钥解锁密码'), { target: { value: 'saved password' } });
    fireEvent.click(screen.getByRole('button', { name: '解锁密钥' }));
    await screen.findByText('密钥已解锁，仅在当前会话可用。');
    expect(ai.hasApiKey(provider.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '验证连接' }));
    await screen.findByText('连接验证成功。');
    expect(completion).toHaveBeenCalledWith(expect.objectContaining({ id: provider.id }), 'stored-secret', expect.any(Array), expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: '忘记密钥' }));
    await screen.findByText('会话密钥、本机密钥和加密保存的密钥均已清除。');
    expect(ai.hasApiKey(provider.id)).toBe(false);
    expect(library.getView().snapshot.ai.providers[0].savedKey).toBeNull();
    ai.dispose();
  });

  it('clears old credentials when an endpoint changes and supports explicit auto-enrichment', async () => {
    const { library, ai } = await setup();
    const provider = await ai.saveProvider({ name: '原服务', baseUrl: 'https://api.example.com/v1', model: 'chosen-model' }, 'original-key');
    render(<AiSettings library={library} ai={ai} />);
    fireEvent.click(screen.getByLabelText('导入后自动 AI 补全与分类'));
    await waitFor(() => expect(library.getView().snapshot.ai.autoEnrich).toBe(true));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://another.example/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存厂商配置' }));
    await screen.findByText('厂商配置已保存。');
    expect(ai.hasApiKey(provider.id)).toBe(false);
    expect(screen.getByRole('button', { name: '验证连接' })).toBeDisabled();
    ai.dispose();
  });

  it('switches between providers and deletes the selected configuration through the service', async () => {
    const { library, ai } = await setup();
    const first = await ai.saveProvider({ name: '第一家', baseUrl: 'https://one.example/v1', model: 'first-model' }, 'first-key');
    const second = await ai.saveProvider({ name: '第二家', baseUrl: 'https://two.example/v1', model: 'second-model' }, 'second-key');
    render(<AiSettings library={library} ai={ai} />);
    fireEvent.change(screen.getByLabelText('选择厂商配置'), { target: { value: second.id } });
    expect(screen.getByLabelText('模型名称')).toHaveValue('second-model');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '设为当前厂商' }));
    await screen.findByText('已切换当前 AI 厂商。');
    expect(library.getView().snapshot.ai.activeProviderId).toBe(second.id);
    fireEvent.click(screen.getByRole('button', { name: '删除厂商' }));
    await screen.findByText('厂商配置已删除。');
    expect(library.getView().snapshot.ai.providers.map((provider) => provider.id)).toEqual([first.id]);
    expect(ai.hasApiKey(second.id)).toBe(false);
    ai.dispose();
  });
});
