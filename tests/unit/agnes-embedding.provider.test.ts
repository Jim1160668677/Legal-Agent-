/**
 * AgnesEmbeddingProvider 单元测试（A2-W2 真实 Embedding API）。
 *
 * 通过 mock 全局 fetch 验证：
 *   - 未配置 apiKey → 抛错
 *   - 成功：URL/方法/头/请求体正确 + 解析 embedding
 *   - 非 2xx → 抛带状态码错误
 *
 * 设计依据：A2 §五 Embedding 接入。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgnesEmbeddingProvider } from '../../src/modules/legal/embedding/providers/agnes-embedding.provider';

function mockFetch(ok: boolean, payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    text: vi.fn().mockResolvedValue('bad body'),
    json: vi.fn().mockResolvedValue(payload),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const cfg = { apiKey: 'emk-1', baseUrl: 'https://embed.example.com/v1', model: 'text-embed-v3', dimension: 8 };

describe('AgnesEmbeddingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('未配置 apiKey → 抛错', async () => {
    const p = new AgnesEmbeddingProvider({ ...cfg, apiKey: '' });
    await expect(p.embed(['x'])).rejects.toThrow('未配置 EMBEDDING_API_KEY');
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });

  it('成功 → POST /embeddings + 解析向量', async () => {
    const fetchMock = mockFetch(true, { data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });
    const p = new AgnesEmbeddingProvider(cfg);

    const result = await p.embed(['文本一', '文本二']);

    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://embed.example.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer emk-1' });
    expect(JSON.parse(init.body)).toEqual({ model: 'text-embed-v3', input: ['文本一', '文本二'] });
  });

  it('非 2xx → 抛带状态码错误', async () => {
    mockFetch(false, null, 429);
    const p = new AgnesEmbeddingProvider(cfg);
    await expect(p.embed(['x'])).rejects.toThrow('429');
  });

  it('name/dimension 暴露', () => {
    const p = new AgnesEmbeddingProvider(cfg);
    expect(p.name).toBe('agnes');
    expect(p.dimension).toBe(8);
  });
});