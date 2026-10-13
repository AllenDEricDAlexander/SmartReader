import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Invoke } from '../persistence/persistenceApi';
import { validEmbedding } from './embeddingsClient';

export type KnowledgeCacheKey = { paperId: string; modelKey: string; contentKey: string };
export type KnowledgeCache = { key: KnowledgeCacheKey; vectors: number[][] };
export type KnowledgeStorage = {
  read(key: KnowledgeCacheKey): Promise<KnowledgeCache | null>;
  save(cache: KnowledgeCache): Promise<void>;
};

export function createKnowledgeStorage(invoke: Invoke = tauriInvoke): KnowledgeStorage {
  return {
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
