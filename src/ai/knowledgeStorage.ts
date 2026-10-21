import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Invoke } from '../persistence/persistenceApi';
import { validEmbedding } from './embeddingsClient';

export type KnowledgeCacheKey = { paperId: string; modelKey: string; contentKey: string };
export type KnowledgeCache = { key: KnowledgeCacheKey; vectors: number[][] };
export type KnowledgeCacheStatus = KnowledgeCacheKey & { dimension: number; chunkCount: number };
export type KnowledgeStorage = {
  /**
   * Fingerprints of the durable vectors held for these papers. Retrieval decides
   * what still needs embedding from this alone, so no vector crosses IPC until a
   * paper genuinely has to be re-indexed or published to a cloud store.
   */
  status(paperIds: string[]): Promise<KnowledgeCacheStatus[]>;
  /** One paper's vectors, read back only to publish them to a cloud store. */
  read(key: KnowledgeCacheKey): Promise<KnowledgeCache | null>;
  save(cache: KnowledgeCache): Promise<void>;
};

export function createKnowledgeStorage(invoke: Invoke = tauriInvoke): KnowledgeStorage {
  return {
    async status(paperIds) {
      if (!paperIds.length) return [];
      const status = await invoke<KnowledgeCacheStatus[]>('knowledge_cache_status', { paperIds });
      const scope = new Set(paperIds);
      if (!Array.isArray(status) || status.some((item) => !scope.has(item.paperId)
        || !Number.isInteger(item.dimension) || item.dimension < 1 || item.dimension > 4096
        || !Number.isInteger(item.chunkCount) || item.chunkCount < 1)) {
        throw new Error('本地向量缓存状态无效，请重新建立知识库索引。');
      }
      return status;
    },
    async read(key) {
      const cache = await invoke<KnowledgeCache | null>('read_knowledge_cache', { key });
      if (cache && (cache.key.paperId !== key.paperId || cache.key.modelKey !== key.modelKey || cache.key.contentKey !== key.contentKey || !Array.isArray(cache.vectors)
        || cache.vectors.some((vector) => !validEmbedding(vector, cache.vectors[0]?.length)))) {
        throw new Error('本地向量缓存已损坏，请重新建立知识库索引。');
      }
      return cache;
    },
    async save(cache) {
      try { await invoke('write_knowledge_cache', { cache }); }
      catch { throw new Error('知识库向量缓存保存失败，或文献已经锁定/移除。'); }
    },
  };
}
