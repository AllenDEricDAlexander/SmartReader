import { KeyRound, Plus, Server, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { AiService } from '../ai/aiService';
import type { AiProviderProfile } from '../library/libraryModels';
import { errorMessage, type LibraryService } from '../library/libraryService';
import '../ai/aiWorkspace.css';

type AiSettingsProps = { library: LibraryService; ai: AiService };
type ProviderDraft = { id?: string; name: string; baseUrl: string; model: string; embeddingModel: string; embeddingBaseUrl: string };

function providerDraft(provider?: AiProviderProfile): ProviderDraft {
  return provider
    ? { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, model: provider.model,
      embeddingModel: provider.embeddingModel ?? (/阿里云|aliyun/i.test(provider.name) ? 'text-embedding-v4' : ''), embeddingBaseUrl: provider.embeddingBaseUrl ?? '' }
    : { name: '', baseUrl: '', model: '', embeddingModel: '', embeddingBaseUrl: '' };
}

export function AiSettings({ library, ai }: AiSettingsProps) {
  const libraryView = useSyncExternalStore(library.subscribe, library.getView);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const settings = libraryView.snapshot.ai;
  const [draft, setDraft] = useState<ProviderDraft>(() => providerDraft(
    settings.providers.find((provider) => provider.id === settings.activeProviderId),
  ));
  const [apiKey, setApiKey] = useState('');
  const [rememberKey, setRememberKey] = useState(false);
  const [savePassword, setSavePassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState(settings.knowledge ?? { backend: 'local' as 'local' | 'milvus', milvusUrl: '' });
  const [milvusToken, setMilvusToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const selectedInitially = useRef(libraryView.loaded);
  const selected = settings.providers.find((provider) => provider.id === draft.id);
  const hasKey = selected ? activity.keyProviderIds.includes(selected.id) : false;
  const active = settings.providers.find((provider) => provider.id === settings.activeProviderId);
  const activeReady = Boolean(active && activity.keyProviderIds.includes(active.id));
  const dirty = !selected || draft.name !== selected.name || draft.baseUrl !== selected.baseUrl
    || draft.model !== selected.model || draft.embeddingModel !== (selected.embeddingModel ?? '')
    || draft.embeddingBaseUrl !== (selected.embeddingBaseUrl ?? '') || Boolean(apiKey) || rememberKey;

  useEffect(() => {
    mounted.current = true;
    void library.initialize().catch((failure: unknown) => {
      if (mounted.current) setError(errorMessage(failure));
    });
    return () => { mounted.current = false; operation.current += 1; };
  }, [library]);

  useEffect(() => {
    if (libraryView.loaded && !selectedInitially.current) {
      selectedInitially.current = true;
      setDraft(providerDraft(settings.providers.find((provider) => provider.id === settings.activeProviderId)));
      setKnowledgeDraft(settings.knowledge ?? { backend: 'local', milvusUrl: '' });
    }
  }, [libraryView.loaded, settings]);

  function selectDraft(provider?: AiProviderProfile) {
    setDraft(providerDraft(provider));
    setApiKey('');
    setRememberKey(false);
    setSavePassword('');
    setUnlockPassword('');
    setError(null);
    setNotice(null);
  }

  async function runAction<T>(name: string, action: () => Promise<T>, onSuccess: (value: T) => void) {
    if (busy) return;
    const generation = ++operation.current;
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (mounted.current && generation === operation.current) onSuccess(result);
    } catch (failure) {
      if (mounted.current && generation === operation.current) {
        let message = errorMessage(failure);
        for (const secret of [apiKey, savePassword, unlockPassword, milvusToken]) {
          if (secret) message = message.replaceAll(secret, '••••');
        }
        setError(message);
      }
    } finally {
      if (mounted.current && generation === operation.current) setBusy(null);
    }
  }

  function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (rememberKey && (!savePassword.trim() || savePassword.length < 8)) {
      setError('密钥保存密码至少 8 个字符。');
      return;
    }
    if (rememberKey && !apiKey.trim()) {
      setError('加密保存前请先输入 API Key。');
      return;
    }
    void runAction('save', () => ai.saveProvider(draft, apiKey.trim() || undefined, rememberKey ? savePassword : undefined), (provider) => {
      selectDraft(provider);
      setNotice('厂商配置已保存。');
    });
  }

  return (
    <section className="settings-card ai-settings" aria-labelledby="ai-settings-title">
      <div className="ai-section-heading">
        <div className="panel-title"><Server size={18} /><h2 id="ai-settings-title">AI 厂商</h2></div>
        <span className="ai-status-badge">OpenAI 兼容接口</span>
      </div>
      <p className="ai-muted">按需配置多个厂商，使用自己的 Base URL、模型和 API Key。</p>
      <div className="ai-privacy-note">
        <ShieldCheck size={17} />
        <p>启用 AI 后，会将相关论文摘录、文献信息和问题发送至所选厂商。文件导入、本地索引和阅读无需 AI。</p>
      </div>
      {!libraryView.loaded ? <p role="status">正在加载 AI 设置…</p> : null}
      <div className="ai-provider-selector">
        <label>
          <span>选择厂商配置</span>
          <select
            aria-label="选择厂商配置"
            disabled={Boolean(busy) || !libraryView.loaded}
            value={draft.id ?? ''}
            onChange={(event) => selectDraft(settings.providers.find((provider) => provider.id === event.target.value))}
          >
            <option value="">新增厂商</option>
            {settings.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}{provider.id === settings.activeProviderId ? ' · 当前使用' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={Boolean(busy) || !libraryView.loaded} onClick={() => selectDraft()}>
          <Plus size={15} />新增厂商
        </button>
      </div>
      <form aria-label="AI 厂商配置" onSubmit={saveProvider}>
        <fieldset className="ai-provider-fields" disabled={Boolean(busy) || !libraryView.loaded}>
          <div className="ai-form-grid">
            <label>
              <span>厂商名称</span>
              <input
                aria-label="厂商名称" required maxLength={80} value={draft.name}
                placeholder="例如：本地模型服务"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              <span>模型名称</span>
              <input
                aria-label="模型名称" required maxLength={200} value={draft.model}
                placeholder="填写厂商提供的模型名称"
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            </label>
            <label className="ai-full-width">
              <span>Embedding 模型</span>
              <input aria-label="Embedding 模型" value={draft.embeddingModel} maxLength={200}
                placeholder="阿里云可填写 text-embedding-v4"
                onChange={(event) => setDraft({ ...draft, embeddingModel: event.target.value })} />
              <small className="ai-field-help">向量模型与聊天模型分别配置，共用此厂商的 Base URL 和 API Key。配置后，新增文献会自动生成向量。</small>
            </label>
            <label className="ai-full-width">
              <span>Embedding Base URL（可选）</span>
              <input aria-label="Embedding Base URL" type="url" value={draft.embeddingBaseUrl}
                placeholder="留空复用聊天服务地址" onChange={(event) => setDraft({ ...draft, embeddingBaseUrl: event.target.value })} />
              <small className="ai-field-help">独立部署的聊天模型地址可能不提供向量模型，可指定 embedding 服务地址。共用此厂商 API Key；更换地址需重新输入密钥。</small>
            </label>
            <label className="ai-full-width">
              <span>Base URL</span>
              <input
                aria-label="Base URL" type="url" required value={draft.baseUrl}
                placeholder="https://api.example.com/v1" spellCheck={false}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </label>
            <label className="ai-full-width">
              <span>API Key <small>默认仅本次会话使用</small></span>
              <input
                aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={apiKey}
                placeholder={hasKey ? '留空保留当前密钥' : '输入厂商 API Key'}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          </div>
          <p className="ai-field-help">留空仅在 Base URL 未改变时保留原密钥；更换地址会清除旧密钥。密钥不会自动填回输入框。</p>
          <label className="ai-checkbox">
            <input
              type="checkbox" checked={rememberKey}
              onChange={(event) => { setRememberKey(event.target.checked); setSavePassword(''); }}
            />
            <span>加密保存 API Key</span>
          </label>
          {rememberKey ? (
            <label className="ai-password-field">
              <span>密钥保存密码</span>
              <input
                aria-label="密钥保存密码" type="password" autoComplete="new-password"
                required minLength={8} value={savePassword} placeholder="至少 8 个字符，重启后用于解锁"
                onChange={(event) => setSavePassword(event.target.value)}
              />
            </label>
          ) : null}
          <div className="ai-form-actions">
            <button type="submit" className="primary-action">{busy === 'save' ? '保存中…' : '保存厂商配置'}</button>
            {selected && selected.id !== settings.activeProviderId ? (
              <button
                type="button"
                onClick={() => void runAction('select', () => ai.selectProvider(selected.id), () => setNotice('已切换当前 AI 厂商。'))}
              >
                设为当前厂商
              </button>
            ) : null}
            {selected ? (
              <button
                type="button" className="ai-danger-button"
                onClick={() => void runAction('remove', () => ai.removeProvider(selected.id), () => {
                  selectDraft();
                  setNotice('厂商配置已删除。');
                })}
              >
                <Trash2 size={14} />删除厂商
              </button>
            ) : null}
          </div>
        </fieldset>
      </form>
      {selected ? (
        <div className="ai-key-panel">
          <div className="ai-key-status">
            <KeyRound size={16} />
            <strong>{hasKey ? '密钥已在当前会话可用' : selected.savedKey ? '已加密保存，待解锁' : '未配置密钥'}</strong>
          </div>
          {selected.savedKey && !hasKey ? (
            <form
              className="ai-unlock-form" aria-label="解锁已保存的密钥"
              onSubmit={(event) => {
                event.preventDefault();
                void runAction('unlock', () => ai.unlockSavedKey(selected.id, unlockPassword), () => {
                  setUnlockPassword('');
                  setNotice('密钥已解锁，仅在当前会话可用。');
                });
              }}
            >
              <label>
                <span>密钥解锁密码</span>
                <input
                  aria-label="密钥解锁密码" type="password" autoComplete="current-password"
                  value={unlockPassword} disabled={Boolean(busy)}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                />
              </label>
              <button type="submit" disabled={Boolean(busy) || !unlockPassword}>
                {busy === 'unlock' ? '解锁中…' : '解锁密钥'}
              </button>
            </form>
          ) : null}
          <div className="ai-form-actions">
            <button
              type="button" disabled={Boolean(busy) || dirty || !hasKey}
              onClick={() => void runAction('test', () => ai.testConnection(selected.id), () => setNotice('连接验证成功。'))}
            >
              {busy === 'test' ? '正在验证…' : '验证连接'}
            </button>
            <button type="button" disabled={Boolean(busy) || dirty || !hasKey || !selected.embeddingModel}
              onClick={() => void runAction('embedding', () => ai.testEmbeddingConnection(selected.id), (dimension) => setNotice(`向量模型验证成功，维度 ${dimension}。`))}>
              {busy === 'embedding' ? '验证向量中…' : '验证向量模型'}
            </button>
            {hasKey || selected.savedKey ? (
              <button
                type="button" disabled={Boolean(busy)}
                onClick={() => void runAction('forget', () => ai.forgetKey(selected.id), () => {
                  setApiKey('');
                  setUnlockPassword('');
                  setSavePassword('');
                  setRememberKey(false);
                  setNotice('会话密钥和已保存的密钥已清除。');
                })}
              >
                忘记密钥
              </button>
            ) : null}
          </div>
          {dirty ? <p className="ai-field-help">请先保存配置，再验证连接。</p> : null}
        </div>
      ) : null}
      <form className="ai-key-panel" aria-label="知识库检索设置" onSubmit={(event) => {
        event.preventDefault();
        void runAction('knowledge', () => ai.saveKnowledgeSettings(knowledgeDraft.backend, knowledgeDraft.milvusUrl, milvusToken || undefined), () => {
          setKnowledgeDraft(library.getView().snapshot.ai.knowledge!);
          setMilvusToken('');
          setNotice('知识库检索设置已保存。');
        });
      }}>
        <h3>知识库检索</h3>
        <label><span>向量检索位置</span>
          <select aria-label="向量检索位置" value={knowledgeDraft.backend} disabled={Boolean(busy) || !libraryView.loaded}
            onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, backend: event.target.value as 'local' | 'milvus' })}>
            <option value="local">本地 · SQLite + sqlite-vec</option><option value="milvus">云端 · Milvus</option>
          </select>
        </label>
        <p className="ai-field-help">原文和向量缓存保存于本地 SQLite。本地检索在内存中运行，向量生成仍使用所选 embedding 厂商。</p>
        {knowledgeDraft.backend === 'milvus' ? <>
          <label><span>Milvus 服务地址</span><input aria-label="Milvus 服务地址" type="url" required value={knowledgeDraft.milvusUrl}
            placeholder="https://your-milvus-endpoint" disabled={Boolean(busy)}
            onChange={(event) => { setKnowledgeDraft({ ...knowledgeDraft, milvusUrl: event.target.value }); setMilvusToken(''); }} /></label>
          <label><span>Milvus 访问令牌（仅本次会话）</span><input aria-label="Milvus 访问令牌" type="password" autoComplete="off" value={milvusToken}
            placeholder={activity.milvusReady ? '留空保留当前地址的令牌' : '输入 Milvus / Zilliz 令牌'} disabled={Boolean(busy)}
            onChange={(event) => setMilvusToken(event.target.value)} /></label>
          <p className="ai-field-help">仅上传未加密文件的向量，原文不上传至 Milvus。问答使用独立临时集合，结束后清理；加密文献请使用本地检索。令牌重启后需重新输入。</p>
        </> : null}
        <button type="submit" disabled={Boolean(busy) || !libraryView.loaded}>保存检索设置</button>
      </form>
      <div className="ai-auto-section">
        <label className="ai-checkbox">
          <input
            aria-label="导入后自动 AI 补全与分类" type="checkbox" checked={settings.autoEnrich}
            disabled={Boolean(busy) || (!activeReady && !settings.autoEnrich)}
            onChange={(event) => void runAction('automatic', () => ai.setAutoEnrich(event.target.checked), () => setNotice('自动补全设置已保存。'))}
          />
          <span>
            <strong>导入后自动 AI 补全与分类</strong>
            <small>使用当前厂商 {active?.name ?? '（尚未配置）'}，在本地索引后补全文献信息并按五个维度归类。</small>
          </span>
          <Sparkles size={17} />
        </label>
        {!activeReady ? <p className="ai-field-help">需先配置当前厂商并输入或解锁密钥。</p> : null}
      </div>
      {error || libraryView.error ? <p className="settings-error" role="alert">{error ?? libraryView.error}</p> : null}
      {notice ? <p className="ai-success-message" role="status">{notice}</p> : null}
    </section>
  );
}
