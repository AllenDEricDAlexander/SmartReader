import type { AiProviderProfile } from '../library/libraryModels';
import type { AiTransport } from './aiTransport';
import { normalizeBaseUrl, requestAiJson } from './openAiClient';

export function normalizeEmbeddingUrl(value: string): string {
  const url = new URL(normalizeBaseUrl(value));
  const base = url.pathname.replace(/\/chat\/completions$/, '');
  url.pathname = base.endsWith('/embeddings') ? base : `${base}/embeddings`;
  return url.toString();
}

export async function requestEmbeddings(
  provider: AiProviderProfile, key: string, texts: string[],
  options: { signal?: AbortSignal; transport?: AiTransport } = {},
): Promise<number[][]> {
  const model = provider.embeddingModel?.trim();
  if (!model) throw new Error('请在 AI 设置中填写独立的 embedding 模型名称。');
  if (!texts.length || texts.length > 10 || texts.some((text) => !text.trim() || text.length > 6000)) {
    throw new Error('向量输入为空或超过单次批量限制。');
  }
  const url = normalizeEmbeddingUrl(provider.embeddingBaseUrl || provider.baseUrl);
  const response = await requestAiJson(url, key, { model, input: texts, encoding_format: 'float' }, options);
  const data = typeof response === 'object' && response !== null && 'data' in response ? response.data : null;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('embedding 服务没有返回完整的向量，请检查模型配置。');
  const ordered = new Map<number, number[]>();
  let dimension = 0;
  for (const item of data) {
    if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= texts.length || ordered.has(item.index)
      || !validEmbedding(item.embedding)) throw new Error('embedding 响应的索引或向量格式无效。');
    dimension ||= item.embedding.length;
    if (item.embedding.length !== dimension) throw new Error('embedding 服务返回的向量维度不一致。');
    ordered.set(item.index, item.embedding);
  }
  return texts.map((_text, index) => ordered.get(index)!);
}

export function validEmbedding(value: unknown, dimension?: number): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 4096 && (!dimension || value.length === dimension)
    && value.every((item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 3.4e38)
    && value.some((item) => item !== 0);
}
