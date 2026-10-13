import type { AiProviderProfile, Paper } from '../library/libraryModels';
import type { LibraryService } from '../library/libraryService';
import { normalizeEmbeddingUrl, requestEmbeddings, validEmbedding } from './embeddingsClient';
import { createKnowledgeStorage, type KnowledgeStorage } from './knowledgeStorage';
import { createKnowledgeVectorSearch, type KnowledgeVectorSearch } from './knowledgeVectors';

export type KnowledgeChunk = { id: string; paperId: string; page: number; text: string; title: string };
type Embeddings = typeof requestEmbeddings;
export type KnowledgeDependencies = { embeddings?: Embeddings; storage?: KnowledgeStorage; vectors?: KnowledgeVectorSearch };

export class KnowledgeService {
  private cache = new Map<string, { contentKey: string; modelKey: string; vectors: number[][] }>();
  private embeddings: Embeddings;
  private storage: KnowledgeStorage;
  private vectors: KnowledgeVectorSearch;
  private stopLocked: () => void;

  constructor(private library: LibraryService, dependencies: KnowledgeDependencies = {}) {
    this.embeddings = dependencies.embeddings ?? requestEmbeddings;
    this.storage = dependencies.storage ?? createKnowledgeStorage();
    this.vectors = dependencies.vectors ?? createKnowledgeVectorSearch();
    this.stopLocked = library.onLocked((ids) => { for (const id of ids) this.cache.delete(id); });
  }

  async index(paper: Paper, provider: AiProviderProfile, key: string, signal: AbortSignal, assertAccess: () => void, force = false): Promise<{ chunks: KnowledgeChunk[]; vectors: number[][] }> {
    const chunks = chunkPaper(paper);
    if (!chunks.length) throw new Error('知识库文件没有可用文本，请重新索引或补充摘要。');
    if (chunks.length > 20000) throw new Error('知识库文件超过向量容量，请拆分文件后重试。');
    const projection = JSON.stringify(chunks);
    const assertContent = () => {
      const current = this.library.getPaper(paper.id);
      if (!current || JSON.stringify(chunkPaper(current)) !== projection) {
        throw Object.assign(new Error('文献内容已变化，正在更新知识库索引。'), { code: 'KNOWLEDGE_CONTENT_CHANGED' });
      }
    };
    const contentKey = await digest(JSON.stringify(chunks.map(({ page, text, title }) => [page, text, title])));
    const modelKey = await digest(JSON.stringify([provider.id, normalizeEmbeddingUrl(provider.embeddingBaseUrl || provider.baseUrl), provider.embeddingModel, 'chunks-1200-160-v1']));
    const cacheKey = { paperId: paper.id, contentKey, modelKey };
    signal.throwIfAborted(); assertAccess();
    const publicPaper = () => this.library.getView().snapshot.papers.find((item) => item.id === paper.id)?.kind === 'plain';
    const memory = this.cache.get(paper.id);
    let cached = !force && memory?.contentKey === contentKey && memory.modelKey === modelKey ? memory : null;
    if (!cached && !force && publicPaper()) {
      const stored = await this.storage.read(cacheKey);
      if (stored) cached = { ...cacheKey, vectors: stored.vectors };
    }
    if (cached && cached.vectors.length === chunks.length && cached.vectors.every((v) => validEmbedding(v, cached.vectors[0]?.length))) {
      signal.throwIfAborted(); assertAccess(); assertContent();
      this.cache.set(paper.id, cached);
      return { chunks, vectors: cached.vectors };
    }
    const vectors: number[][] = [];
    for (let at = 0; at < chunks.length; at += 4) {
      signal.throwIfAborted(); assertAccess();
      vectors.push(...await this.embeddings(provider, key, chunks.slice(at, at + 4).map((chunk) => `${chunk.title.slice(0, 200)}\n${chunk.text}`), { signal }));
      if (chunks.length * (vectors[0]?.length ?? 0) > 8 * 1024 * 1024) throw new Error('知识库文件超过向量容量，请拆分文件后重试。');
    }
    signal.throwIfAborted(); assertAccess();
    assertContent();
    if (vectors.length !== chunks.length || vectors.some((v) => !validEmbedding(v, vectors[0]?.length))) throw new Error('知识库向量不完整或维度不一致。');
    // Public vectors persist separately in SQLite. Private vectors remain only
    // in this unlock session; the native transaction also rejects private saves.
    if (publicPaper()) await this.storage.save({ key: cacheKey, vectors });
    signal.throwIfAborted(); assertAccess();
    this.cache.set(paper.id, { contentKey, modelKey, vectors });
    return { chunks, vectors };
  }

  async retrieve(question: string, papers: Paper[], provider: AiProviderProfile, key: string, signal: AbortSignal, assertAccess: () => void, milvusKey?: string): Promise<KnowledgeChunk[]> {
    const settings = this.library.getView().snapshot.ai.knowledge ?? { backend: 'local', milvusUrl: '' };
    if (settings.backend === 'milvus' && !milvusKey) throw new Error('请先输入云端 Milvus 的访问令牌。');
    if (settings.backend === 'milvus' && papers.some((paper) => this.library.getView().snapshot.papers.find((record) => record.id === paper.id)?.kind === 'encrypted')) {
      throw new Error('加密文献仅支持本地向量检索，请切换本地模式。');
    }
    const [query] = await this.embeddings(provider, key, [question], { signal });
    assertAccess(); signal.throwIfAborted();
    const chunkCount = papers.reduce((count, paper) => count + chunkPaper(paper).length, 0);
    if (chunkCount > 20000 || chunkCount * query.length > 8 * 1024 * 1024) throw new Error('所选知识库超过向量容量，请缩小文件范围后重试。');
    const chunks: KnowledgeChunk[] = [];
    const entries: Array<{ id: string; vector: number[] }> = [];
    for (const paper of papers) {
      let indexed;
      try { indexed = await this.index(paper, provider, key, signal, assertAccess); }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'KNOWLEDGE_CONTENT_CHANGED') throw error;
        assertAccess();
        indexed = await this.index(this.library.getPaper(paper.id)!, provider, key, signal, assertAccess, true);
      }
      if (indexed.vectors[0]?.length !== query.length) indexed = await this.index(this.library.getPaper(paper.id)!, provider, key, signal, assertAccess, true);
      chunks.push(...indexed.chunks);
      entries.push(...indexed.chunks.map((chunk, index) => ({ id: chunk.id, vector: indexed.vectors[index] })));
    }
    const hits = await this.vectors(entries, query, { ...settings, milvusKey, signal, assertAccess });
    signal.throwIfAborted(); assertAccess();
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const perPaper = new Map<string, number>();
    return hits.filter((hit) => hit.score > 0.1).sort((a, b) => b.score - a.score).flatMap((hit) => {
      const chunk = byId.get(hit.id);
      if (!chunk || (perPaper.get(chunk.paperId) ?? 0) >= 3) return [];
      perPaper.set(chunk.paperId, (perPaper.get(chunk.paperId) ?? 0) + 1);
      return [chunk];
    }).slice(0, 6);
  }

  clear() { this.cache.clear(); }
  dispose() { this.stopLocked(); this.clear(); }
}

export function chunkPaper(paper: Paper): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const pages = paper.pages.some((page) => page.text.trim()) ? paper.pages : [{ page: 1, text: paper.metadata.abstract }];
  for (const page of pages) {
    const characters = Array.from(page.text.normalize('NFKC').replace(/\s+/g, ' ').trim());
    for (let at = 0; at < characters.length; at += 1040) {
      chunks.push({ id: `${paper.id}:${chunks.length}`, paperId: paper.id, page: page.page,
        title: paper.metadata.title || paper.fileName, text: characters.slice(at, at + 1200).join('') });
      if (at + 1200 >= characters.length) break;
    }
  }
  return chunks;
}

async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
