import type { AiProviderProfile, Paper } from '../library/libraryModels';
import type { LibraryService } from '../library/libraryService';
import { normalizeEmbeddingUrl, requestEmbeddings, validEmbedding } from './embeddingsClient';
import { createKnowledgeStorage, type KnowledgeStorage } from './knowledgeStorage';
import {
  createKnowledgeVectorStore,
  type KnowledgeSearchOptions,
  type KnowledgeVector,
  type KnowledgeVectorStore,
} from './knowledgeVectors';

export type KnowledgeChunk = { id: string; paperId: string; page: number; text: string; title: string };
type Embeddings = typeof requestEmbeddings;
export type KnowledgeDependencies = { embeddings?: Embeddings; storage?: KnowledgeStorage; store?: KnowledgeVectorStore };

/** Chunk geometry; part of the index fingerprint, so changing it re-indexes. */
const CHUNK_CHARS = 1200;
const CHUNK_STRIDE = 1040;
const CHUNK_GEOMETRY = 'chunks-1200-160-v1';

/** Retrieval shape: enough candidates to rank, few enough to fit a prompt. */
const CANDIDATES = 40;
const MIN_SCORE = 0.15;
const PER_PAPER = 3;
const SOURCES = 8;

/** Embedding batch sizes, tried in order; a provider that rejects a batch size
 * usually accepts a smaller one, and shrinking beats failing a whole index. */
const BATCHES = [16, 8, 4, 1];

type IndexOptions = { force?: boolean; expectDimension?: number };
type Indexed = { chunks: KnowledgeChunk[]; dimension: number; fingerprint: string; entries: KnowledgeVector[] | null };

export class KnowledgeService {
  private cache = new Map<string, { contentKey: string; modelKey: string; vectors: number[][] }>();
  private embeddings: Embeddings;
  private storage: KnowledgeStorage;
  private store: KnowledgeVectorStore;
  private stopLocked: () => void;

  constructor(private library: LibraryService, dependencies: KnowledgeDependencies = {}) {
    this.embeddings = dependencies.embeddings ?? requestEmbeddings;
    this.storage = dependencies.storage ?? createKnowledgeStorage();
    this.store = dependencies.store ?? createKnowledgeVectorStore();
    this.stopLocked = library.onLocked((ids) => { for (const id of ids) this.cache.delete(id); });
  }

  async forget(paperIds: string[], options: KnowledgeSearchOptions): Promise<void> {
    for (const id of paperIds) this.cache.delete(id);
    await this.store.forget(paperIds, options);
  }

  /**
   * Makes a paper's vectors available for retrieval. Public papers persist in
   * SQLite and, with the cloud backend, in the Milvus collection; the vectors of
   * an unlocked encrypted paper stay in this session only and are returned so
   * the caller can pass them into one query's scope.
   */
  async index(
    paper: Paper, provider: AiProviderProfile, key: string, signal: AbortSignal,
    assertAccess: () => void, options: IndexOptions = {}, search?: KnowledgeSearchOptions,
  ): Promise<Indexed> {
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
    const modelKey = await digest(JSON.stringify([provider.id,
      normalizeEmbeddingUrl(provider.embeddingBaseUrl || provider.baseUrl), provider.embeddingModel, CHUNK_GEOMETRY]));
    const cacheKey = { paperId: paper.id, contentKey, modelKey };
    const fingerprint = `${contentKey.slice(0, 32)}${modelKey.slice(0, 32)}`;
    signal.throwIfAborted(); assertAccess();
    const publicPaper = this.library.getView().snapshot.papers.find((item) => item.id === paper.id)?.kind === 'plain';
    if (search?.backend === 'milvus' && !publicPaper) {
      throw new Error('加密文献仅支持本地向量检索，请切换本地模式。');
    }
    const force = options.force ?? false;
    const fresh = (dimension: number) => !options.expectDimension || dimension === options.expectDimension;

    if (!publicPaper) {
      const memory = this.cache.get(paper.id);
      const reusable = !force && memory?.contentKey === contentKey && memory.modelKey === modelKey
        && memory.vectors.length === chunks.length && fresh(memory.vectors[0]?.length ?? 0)
        && memory.vectors.every((vector) => validEmbedding(vector, memory.vectors[0]?.length));
      const vectors = reusable ? memory!.vectors
        : await this.embed(chunks, provider, key, signal, assertAccess, assertContent);
      if (!reusable) this.cache.set(paper.id, { contentKey, modelKey, vectors });
      signal.throwIfAborted(); assertAccess(); assertContent();
      return { chunks, dimension: vectors[0].length, fingerprint, entries: entriesFor(chunks, vectors) };
    }

    // Public papers: the durable fingerprint decides whether anything has to be
    // embedded again, so an already indexed library costs one status read.
    const [stored] = force ? [] : await this.storage.status([paper.id]);
    signal.throwIfAborted(); assertAccess(); assertContent();
    let dimension = stored?.contentKey === contentKey && stored.modelKey === modelKey
      && stored.chunkCount === chunks.length && fresh(stored.dimension) ? stored.dimension : 0;
    let vectors: number[][] | null = null;
    if (!dimension) {
      vectors = await this.embed(chunks, provider, key, signal, assertAccess, assertContent);
      assertContent();
      await this.storage.save({ key: cacheKey, vectors });
      signal.throwIfAborted(); assertAccess();
      dimension = vectors[0].length;
    }
    this.cache.delete(paper.id);
    if (search?.backend === 'milvus') {
      await this.library.withStableAccess(async () => {
        const assertPublic = () => {
          signal.throwIfAborted(); assertAccess(); assertContent();
          if (this.library.getView().snapshot.papers.find((item) => item.id === paper.id)?.kind !== 'plain') {
            throw new Error('加密文献仅支持本地向量检索，请切换本地模式。');
          }
        };
        const cloud = { ...search, assertAccess: assertPublic };
        assertPublic();
        const published = await this.store.fingerprint(paper.id, dimension, fingerprint, chunks.length, cloud);
        assertPublic();
        if (published !== fingerprint) {
          // Read back only the public paper being published; protection changes
          // wait for this operation before their cloud cleanup can begin.
          vectors ??= (await this.storage.read(cacheKey))?.vectors ?? null;
          if (!vectors?.length) vectors = await this.embed(chunks, provider, key, signal, assertPublic, assertContent);
          assertPublic();
          await this.store.publish(paper.id, fingerprint, entriesFor(chunks, vectors), cloud);
        }
        assertPublic();
      });
    }
    signal.throwIfAborted(); assertAccess(); assertContent();
    return { chunks, dimension, fingerprint, entries: null };
  }

  async retrieve(
    question: string, papers: Paper[], provider: AiProviderProfile, key: string,
    signal: AbortSignal, assertAccess: () => void, milvusKey?: string,
  ): Promise<KnowledgeChunk[]> {
    const settings = this.library.getView().snapshot.ai.knowledge ?? { backend: 'local' as const, milvusUrl: '' };
    if (settings.backend === 'milvus' && !milvusKey) throw new Error('请先输入云端 Milvus 的访问令牌。');
    const records = this.library.getView().snapshot.papers;
    if (settings.backend === 'milvus' && papers.some((paper) => records.find((record) => record.id === paper.id)?.kind === 'encrypted')) {
      throw new Error('加密文献仅支持本地向量检索，请切换本地模式。');
    }
    const search: KnowledgeSearchOptions = { ...settings, milvusKey, signal, assertAccess };
    const [query] = await this.embeddings(provider, key, [question], { signal });
    assertAccess(); signal.throwIfAborted();
    const chunks: KnowledgeChunk[] = [];
    const paperIds: string[] = [];
    const fingerprints: Record<string, string> = {};
    const projections = new Map<string, string>();
    const entries: KnowledgeVector[] = [];
    for (const paper of papers) {
      let indexed: Indexed;
      try { indexed = await this.index(paper, provider, key, signal, assertAccess, { expectDimension: query.length }, search); }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'KNOWLEDGE_CONTENT_CHANGED') throw error;
        assertAccess();
        indexed = await this.index(this.library.getPaper(paper.id)!, provider, key, signal, assertAccess,
          { force: true, expectDimension: query.length }, search);
      }
      if (indexed.dimension !== query.length) {
        indexed = await this.index(this.library.getPaper(paper.id)!, provider, key, signal, assertAccess,
          { force: true, expectDimension: query.length }, search);
      }
      chunks.push(...indexed.chunks);
      projections.set(paper.id, JSON.stringify(indexed.chunks));
      if (indexed.entries) entries.push(...indexed.entries);
      else { paperIds.push(paper.id); fingerprints[paper.id] = indexed.fingerprint; }
    }
    const modelKey = await digest(JSON.stringify([provider.id,
      normalizeEmbeddingUrl(provider.embeddingBaseUrl || provider.baseUrl), provider.embeddingModel, CHUNK_GEOMETRY]));
    const assertScopeContent = () => {
      signal.throwIfAborted(); assertAccess();
      for (const [id, projection] of projections) {
        const current = this.library.getPaper(id);
        if (!current || JSON.stringify(chunkPaper(current)) !== projection) {
          throw new Error('文献内容已变化，请重新提问以更新来源。');
        }
      }
    };
    assertScopeContent();
    const hits = await this.store.search({ query, limit: CANDIDATES, modelKey, paperIds, fingerprints, entries }, search);
    assertScopeContent();
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const perPaper = new Map<string, number>();
    return hits.filter((hit) => hit.score > MIN_SCORE).sort((a, b) => b.score - a.score).flatMap((hit) => {
      const chunk = byId.get(hit.id);
      if (!chunk || (perPaper.get(chunk.paperId) ?? 0) >= PER_PAPER) return [];
      perPaper.set(chunk.paperId, (perPaper.get(chunk.paperId) ?? 0) + 1);
      return [chunk];
    }).slice(0, SOURCES);
  }

  /** Embeds every chunk, shrinking the batch when a provider rejects the size. */
  private async embed(
    chunks: KnowledgeChunk[], provider: AiProviderProfile, key: string,
    signal: AbortSignal, assertAccess: () => void, assertContent: () => void,
  ): Promise<number[][]> {
    const vectors: number[][] = [];
    let batch = BATCHES[0];
    for (let at = 0; at < chunks.length;) {
      signal.throwIfAborted(); assertAccess();
      const texts = chunks.slice(at, at + batch).map((chunk) => `${chunk.title.slice(0, 200)}\n${chunk.text}`);
      try {
        vectors.push(...await this.embeddings(provider, key, texts, { signal }));
      } catch (error) {
        const smaller = BATCHES.find((size) => size < batch);
        if (!smaller || signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        batch = smaller;
        continue;
      }
      at += texts.length;
      if (chunks.length * (vectors[0]?.length ?? 0) > 8 * 1024 * 1024) {
        throw new Error('知识库文件超过向量容量，请拆分文件后重试。');
      }
    }
    signal.throwIfAborted(); assertAccess(); assertContent();
    if (vectors.length !== chunks.length || vectors.some((vector) => !validEmbedding(vector, vectors[0]?.length))) {
      throw new Error('知识库向量不完整或维度不一致。');
    }
    return vectors;
  }

  clear() { this.cache.clear(); }
  dispose() { this.stopLocked(); this.clear(); }
}

function entriesFor(chunks: KnowledgeChunk[], vectors: number[][]): KnowledgeVector[] {
  return chunks.map((chunk, index) => ({ id: chunk.id, vector: vectors[index] }));
}

/**
 * Splits a paper into overlapping chunks, one window set per page. A chunk keeps
 * its own page number, which is where its citation jumps to, so pages are never
 * merged even when text extraction leaves one nearly empty.
 */
export function chunkPaper(paper: Paper): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const title = paper.metadata.title || paper.fileName;
  const pages = paper.pages.some((page) => page.text.trim()) ? paper.pages : [{ page: 1, text: paper.metadata.abstract }];
  for (const page of pages) {
    const characters = Array.from(page.text.normalize('NFKC').replace(/\s+/g, ' ').trim());
    for (let at = 0; at < characters.length; at += CHUNK_STRIDE) {
      chunks.push({ id: `${paper.id}:${chunks.length}`, paperId: paper.id, page: page.page,
        title, text: characters.slice(at, at + CHUNK_CHARS).join('') });
      if (at + CHUNK_CHARS >= characters.length) break;
    }
  }
  return chunks;
}

async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
