import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Invoke } from '../persistence/persistenceApi';
import type { AiTransport } from './aiTransport';
import { validEmbedding } from './embeddingsClient';
import { parseServiceUrl, requestAiJson, servicePath } from './openAiClient';

export type KnowledgeVector = { id: string; vector: number[] };
export type KnowledgeHit = { id: string; score: number };

/**
 * One retrieval scope. `paperIds` name papers whose vectors already live in the
 * durable store, so only the query vector travels; `entries` carry the
 * session-only vectors of unlocked encrypted papers, which are never persisted.
 */
export type KnowledgeScope = {
  query: number[];
  limit: number;
  modelKey: string;
  paperIds: string[];
  fingerprints?: Record<string, string>;
  entries: KnowledgeVector[];
};

export type KnowledgeSearchOptions = {
  backend: 'local' | 'milvus'; milvusUrl: string; milvusKey?: string;
  signal?: AbortSignal; assertAccess(): void;
};

export type KnowledgeVectorStore = {
  /**
   * Fingerprint of the vectors a cloud store already holds for this paper, or
   * `null` when it holds none. The local backend answers `null`: its durable
   * fingerprints come from `knowledgeStorage.status`.
   */
  fingerprint(paperId: string, dimension: number, expected: string, chunkCount: number, options: KnowledgeSearchOptions): Promise<string | null>;
  /** Replaces one paper's vectors in a cloud store. A no-op for the local backend. */
  publish(paperId: string, fingerprint: string, entries: KnowledgeVector[], options: KnowledgeSearchOptions): Promise<void>;
  /** Best-effort removal of cloud vectors for papers that were locked or deleted. */
  forget(paperIds: string[], options: KnowledgeSearchOptions): Promise<void>;
  search(scope: KnowledgeScope, options: KnowledgeSearchOptions): Promise<KnowledgeHit[]>;
};

/** Chunk identifiers are `<paper sha-256>:<ordinal>`; nothing else is in scope. */
const chunkId = /^[0-9a-f]{64}:\d+$/;
const paperId = /^[0-9a-f]{64}$/;
const paperFingerprint = /^[0-9a-f]{64}$/;

/** Paper identifiers reach Milvus inside filter expressions, never unchecked. */
function assertPaperIds(ids: string[]): string[] {
  if (!ids.length || ids.some((id) => !paperId.test(id))) throw new Error('知识库文献标识无效，请重新选择文件。');
  return ids;
}

export function normalizeMilvusUrl(value: string): string {
  const url = parseServiceUrl(value);
  url.pathname = servicePath(url).replace(/\/v2\/vectordb$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function createKnowledgeVectorStore(invoke: Invoke = tauriInvoke, transport?: AiTransport): KnowledgeVectorStore {
  return {
    async fingerprint(paperId, dimension, expected, chunkCount, options) {
      if (options.backend === 'local') return null;
      return milvusFingerprint(paperId, dimension, expected, chunkCount, options, transport);
    },
    async publish(paperId, fingerprint, entries, options) {
      if (options.backend === 'local') return;
      await milvusPublish(paperId, fingerprint, entries, options, transport);
    },
    async forget(paperIds, options) {
      if (options.backend === 'local' || !paperIds.length) return;
      await milvusForget(paperIds, options, transport);
    },
    async search(scope, options) {
      options.signal?.throwIfAborted();
      options.assertAccess();
      if (!validEmbedding(scope.query) || scope.entries.some((entry) => !validEmbedding(entry.vector, scope.query.length))) {
        throw new Error('知识库向量维度不一致，请重新建立索引。');
      }
      const hits = options.backend === 'local'
        ? await searchLocal(invoke, scope)
        : await milvusSearch(scope, options, transport);
      options.signal?.throwIfAborted();
      options.assertAccess();
      const papers = new Set(scope.paperIds);
      const session = new Set(scope.entries.map((entry) => entry.id));
      if (!Array.isArray(hits) || hits.some((hit) => typeof hit?.id !== 'string' || !Number.isFinite(hit.score)
        || !(session.has(hit.id) || (chunkId.test(hit.id) && papers.has(hit.id.slice(0, 64)))))) {
        throw new Error('向量检索返回了所选知识库范围以外的结果。');
      }
      return hits;
    },
  };
}

async function searchLocal(invoke: Invoke, scope: KnowledgeScope): Promise<KnowledgeHit[]> {
  try {
    // The native command reads the durable vectors inside SQLite and ranks them
    // there, so a large knowledge base never serializes its vectors for a query.
    return await invoke<KnowledgeHit[]>('search_knowledge_scope', { scope });
  } catch {
    throw new Error('本地向量检索未完成，请检查文献索引并重试。');
  }
}

/**
 * Persistent collection per embedding dimension. Vectors stay between sessions,
 * so a question costs one search instead of re-uploading the whole library, and
 * a paper's own rows are replaced only when its fingerprint changes. Source text
 * and encrypted papers are never uploaded.
 */
function collectionFor(dimension: number): string {
  return `smartreader_knowledge_${dimension}`;
}

type MilvusCall = (path: string, body: Record<string, unknown>, options: { tolerate?: boolean; timeoutMs?: number }) => Promise<unknown>;

function milvusClient(options: KnowledgeSearchOptions, transport?: AiTransport): { url: string; key: string; call: MilvusCall } {
  const url = normalizeMilvusUrl(options.milvusUrl);
  const key = options.milvusKey;
  if (!key) throw new Error('请先输入云端 Milvus 的访问令牌。');
  const call: MilvusCall = async (path, body, { tolerate = false, timeoutMs = 60_000 } = {}) => {
    options.signal?.throwIfAborted();
    options.assertAccess();
    const response = await requestAiJson(`${url}/v2/vectordb/${path}`, key, body, { transport, signal: options.signal, timeoutMs });
    const record = response && typeof response === 'object' ? response as Record<string, unknown> : null;
    if (record?.code !== 0) {
      if (tolerate) return undefined;
      throw new Error('Milvus 操作未完成，请检查服务地址、权限和集合容量。');
    }
    return record.data;
  };
  return { url, key, call };
}

/** JSON-encoded float vectors are large; batches stay inside the native request cap. */
function batchSize(dimension: number): number {
  return Math.min(500, Math.max(1, Math.floor(5_000_000 / Math.max(1, dimension * 14))));
}

/**
 * A matching fingerprint is reusable only when every chunk reached the server.
 * Counting with Strong consistency also detects an upload interrupted after its
 * first batch, which must be replaced on the next indexing attempt.
 */
async function milvusFingerprint(
  paper: string, dimension: number, expected: string, chunkCount: number,
  options: KnowledgeSearchOptions, transport?: AiTransport,
): Promise<string | null> {
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 4096) return null;
  if (!paperFingerprint.test(expected) || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 20000) {
    throw new Error('知识库指纹无效，请重新建立索引。');
  }
  const { call } = milvusClient(options, transport);
  const [id] = assertPaperIds([paper]);
  const data = await call('entities/query', {
    collectionName: collectionFor(dimension), filter: `paper_id == "${id}" and paper_fp == "${expected}"`,
    outputFields: ['count(*)'], consistencyLevel: 'Strong', limit: 0,
  }, { tolerate: true, timeoutMs: 30_000 });
  const row = Array.isArray(data) && data[0] && typeof data[0] === 'object' ? data[0] as Record<string, unknown> : null;
  const count = row?.['count(*)'];
  return (typeof count === 'number' || (typeof count === 'string' && /^\d+$/.test(count)))
    && Number(count) === chunkCount ? expected : null;
}

async function milvusPublish(
  paper: string, fingerprint: string, entries: KnowledgeVector[],
  options: KnowledgeSearchOptions, transport?: AiTransport,
): Promise<void> {
  if (!entries.length) return;
  const [id] = assertPaperIds([paper]);
  if (!paperFingerprint.test(fingerprint)) throw new Error('知识库指纹无效，请重新建立索引。');
  const dimension = entries[0].vector.length;
  if (entries.some((entry) => !validEmbedding(entry.vector, dimension) || !chunkId.test(entry.id) || !entry.id.startsWith(`${id}:`))) {
    throw new Error('知识库向量维度不一致，请重新建立索引。');
  }
  const collectionName = collectionFor(dimension);
  const { call } = milvusClient(options, transport);
  // Another index job can create the same collection after this status read.
  // Accept a failed create only when a subsequent describe confirms it exists.
  const described = await call('collections/describe', { collectionName }, { tolerate: true, timeoutMs: 30_000 });
  if (described === undefined) {
    try {
      await call('collections/create', {
        collectionName,
        schema: { autoId: false, enableDynamicField: false, fields: [
          { fieldName: 'id', dataType: 'VarChar', isPrimary: true, elementTypeParams: { max_length: '160' } },
          { fieldName: 'paper_id', dataType: 'VarChar', elementTypeParams: { max_length: '80' } },
          { fieldName: 'paper_fp', dataType: 'VarChar', elementTypeParams: { max_length: '80' } },
          { fieldName: 'vector', dataType: 'FloatVector', elementTypeParams: { dim: String(dimension) } },
        ] },
        indexParams: [{ fieldName: 'vector', indexName: 'vector_idx', metricType: 'COSINE', params: { index_type: 'AUTOINDEX' } }],
      }, {});
    } catch (error) {
      options.signal?.throwIfAborted(); options.assertAccess();
      const existing = await call('collections/describe', { collectionName }, { tolerate: true, timeoutMs: 30_000 });
      if (existing === undefined) throw error;
    }
  }
  // A collection released since the last session answers searches with an
  // error, so loading is attempted on every publish rather than only on create.
  await call('collections/load', { collectionName }, { tolerate: true, timeoutMs: 30_000 });
  // Replacing by filter, not by primary key, so a shorter re-index cannot leave
  // this paper's obsolete chunks behind in the collection.
  await call('entities/delete', { collectionName, filter: `paper_id == "${id}"` }, {});
  const size = batchSize(dimension);
  for (let at = 0; at < entries.length; at += size) {
    await call('entities/insert', {
      collectionName,
      data: entries.slice(at, at + size).map((entry) => ({ id: entry.id, paper_id: id, paper_fp: fingerprint, vector: entry.vector })),
    }, {});
  }
}

async function milvusSearch(scope: KnowledgeScope, options: KnowledgeSearchOptions, transport?: AiTransport): Promise<KnowledgeHit[]> {
  if (!scope.paperIds.length) return [];
  const dimension = scope.query.length;
  const selected = assertPaperIds(scope.paperIds);
  if (selected.some((id) => !paperFingerprint.test(scope.fingerprints?.[id] ?? ''))) {
    throw new Error('知识库指纹无效，请重新建立索引。');
  }
  const { call } = milvusClient(options, transport);
  const data = await call('entities/search', {
    collectionName: collectionFor(dimension),
    data: [scope.query], annsField: 'vector', limit: scope.limit,
    filter: selected.map((id) => `(paper_id == "${id}" and paper_fp == "${scope.fingerprints![id]}")`).join(' or '),
    consistencyLevel: 'Strong', outputFields: ['id', 'paper_fp'],
  }, {});
  if (!Array.isArray(data)) throw new Error('Milvus 返回的检索结果格式无效。');
  if (data.some((hit) => typeof hit?.id !== 'string' || !chunkId.test(hit.id)
    || hit.paper_fp !== scope.fingerprints?.[hit.id.slice(0, 64)])) {
    throw new Error('云端向量索引已变化，请重新检索。');
  }
  return data.map((hit) => ({ id: hit?.id, score: hit?.distance }));
}

async function milvusForget(
  paperIds: string[], options: KnowledgeSearchOptions, transport?: AiTransport,
): Promise<void> {
  const filter = `paper_id in [${assertPaperIds(paperIds).map((id) => `"${id}"`).join(', ')}]`;
  const { call } = milvusClient(options, transport);
  const collections = await call('collections/list', {}, { timeoutMs: 30_000 });
  if (!Array.isArray(collections) || collections.some((name) => typeof name !== 'string')) {
    throw new Error('Milvus 返回的集合列表无效，云端索引尚未清理。');
  }
  for (const collectionName of collections) {
    const match = /^smartreader_knowledge_([1-9]\d{0,3})$/.exec(collectionName);
    if (!match || Number(match[1]) > 4096) continue;
    await call('entities/delete', { collectionName, filter }, { timeoutMs: 30_000 });
  }
}
