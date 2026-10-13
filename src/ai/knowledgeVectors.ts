import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Invoke } from '../persistence/persistenceApi';
import type { AiTransport } from './aiTransport';
import { validEmbedding } from './embeddingsClient';
import { normalizeBaseUrl, requestAiJson } from './openAiClient';

export type KnowledgeVector = { id: string; vector: number[] };
export type KnowledgeHit = { id: string; score: number };
export type KnowledgeSearchOptions = {
  backend: 'local' | 'milvus'; milvusUrl: string; milvusKey?: string;
  signal?: AbortSignal; assertAccess(): void;
};
export type KnowledgeVectorSearch = (entries: KnowledgeVector[], query: number[], options: KnowledgeSearchOptions) => Promise<KnowledgeHit[]>;

export function normalizeMilvusUrl(value: string): string {
  return normalizeBaseUrl(value).replace(/\/chat\/completions$/, '').replace(/\/v2\/vectordb$/, '');
}

export function createKnowledgeVectorSearch(invoke: Invoke = tauriInvoke, transport?: AiTransport): KnowledgeVectorSearch {
  return async (entries, query, options) => {
    options.signal?.throwIfAborted();
    options.assertAccess();
    if (!validEmbedding(query) || entries.some((entry) => !validEmbedding(entry.vector, query.length))) {
      throw new Error('知识库向量维度不一致，请重新建立索引。');
    }
    let hits: KnowledgeHit[];
    if (options.backend === 'local') {
      try { hits = await invoke<KnowledgeHit[]>('search_knowledge_vectors', { entries, query, limit: 20 }); }
      catch { throw new Error('本地向量检索未完成，请检查文献索引并重试。'); }
    } else hits = await searchMilvus(entries, query, options, transport);
    options.signal?.throwIfAborted();
    options.assertAccess();
    const allowed = new Set(entries.map((entry) => entry.id));
    if (!Array.isArray(hits) || hits.some((hit) => !allowed.has(hit.id) || !Number.isFinite(hit.score))) {
      throw new Error('向量检索返回了所选知识库范围以外的结果。');
    }
    return hits;
  };
}

async function searchMilvus(entries: KnowledgeVector[], query: number[], options: KnowledgeSearchOptions, transport?: AiTransport): Promise<KnowledgeHit[]> {
  const url = normalizeMilvusUrl(options.milvusUrl);
  const key = options.milvusKey;
  if (!key) throw new Error('请先输入云端 Milvus 的访问令牌。');
  // Each request owns an isolated collection. Never reset or drop a user's
  // existing collections, and never upload source text or encrypted papers.
  const collectionName = `smartreader_${crypto.randomUUID().replaceAll('-', '')}`;
  const call = async (path: string, body: Record<string, unknown>, cleanup = false) => {
    if (!cleanup) { options.signal?.throwIfAborted(); options.assertAccess(); }
    const response = await requestAiJson(`${url}/v2/vectordb/${path}`, key, { collectionName, ...body },
      { transport, signal: cleanup ? undefined : options.signal, timeoutMs: cleanup ? 10_000 : 60_000 });
    if (!response || typeof response !== 'object' || !('code' in response) || response.code !== 0) {
      throw new Error('Milvus 操作未完成，请检查服务地址、权限和集合容量。');
    }
    return 'data' in response ? response.data : undefined;
  };
  let result: KnowledgeHit[] = [];
  let failure: unknown;
  try {
    await call('collections/create', {
      schema: { autoId: false, enableDynamicField: false, fields: [
        { fieldName: 'id', dataType: 'VarChar', isPrimary: true, elementTypeParams: { max_length: '160' } },
        { fieldName: 'vector', dataType: 'FloatVector', elementTypeParams: { dim: String(query.length) } },
      ] },
      indexParams: [{ fieldName: 'vector', indexName: 'vector_idx', metricType: 'COSINE', params: { index_type: 'AUTOINDEX' } }],
    });
    for (let at = 0; at < entries.length; at += 4) await call('entities/insert', { data: entries.slice(at, at + 4) });
    const data = await call('entities/search', { data: [query], annsField: 'vector', limit: 20, consistencyLevel: 'Strong', outputFields: ['id'] });
    if (!Array.isArray(data)) throw new Error('Milvus 返回的检索结果格式无效。');
    result = data.map((hit) => ({ id: hit?.id, score: hit?.distance }));
  } catch (error) { failure = error; }
  // An aborted create may still have reached the server. Attempt cleanup even
  // when its response was lost; a new request can cancel without waiting for it.
  try { await call('collections/drop', {}, true); }
  catch { if (!failure) failure = new Error('云端临时向量索引清理失败，请检查 Milvus 连接后重试。'); }
  if (failure) throw failure;
  return result;
}
