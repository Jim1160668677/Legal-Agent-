/**
 * EmbeddingService 单元测试（A2-W2）。
 *
 * 覆盖三类场景：
 *   - 正常场景：embed 单条 / embedBatch 多条 / dimension getter / 分批处理
 *   - 边界场景：空入参 / 无缓存注入 / 缓存命中跳过 Provider / 缓存部分命中
 *   - 异常场景：Provider 调用失败抛错 / 缓存读取失败降级 / 缓存写入失败不阻塞
 *
 * 实现注：手动 new EmbeddingService(provider, cache?, logger?) 绕过 DI，
 *       mock EmbeddingProvider 与 CacheService。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { EmbeddingService } from '../../src/modules/legal/embedding/embedding.service';
import type { EmbeddingProvider } from '../../src/modules/legal/embedding/embedding.types';

/** 计算与 EmbeddingService 一致的缓存键 */
function cacheKey(text: string): string {
  return `embed:${createHash('sha256').update(text).digest('hex')}`;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    log: vi.fn(),
  };
}

/** 构造 mock EmbeddingProvider：embed 按文本哈希生成伪向量（确定长度） */
function makeProvider(dim = 4): EmbeddingProvider & { embedMock: ReturnType<typeof vi.fn> } {
  const embedMock = vi.fn(async (texts: string[]): Promise<number[][]> => {
    return texts.map((t, i) => {
      const vec = new Array<number>(dim).fill(0);
      vec[0] = t.length + i * 0.1;
      return vec;
    });
  });
  return {
    name: 'mock-test',
    dimension: dim,
    embed: embedMock,
    embedMock,
  };
}

/** 构造 mock CacheService：get/set 可控 */
function makeCache(store = new Map<string, unknown>()) {
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, val: unknown) => {
      store.set(key, val);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    incr: vi.fn(),
    getLlmCache: vi.fn(),
    setLlmCache: vi.fn(),
    invalidateByLawArticle: vi.fn(),
    _store: store,
  };
}

describe('EmbeddingService', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('正常场景', () => {
    it('embed 单条文本返回向量（长度等于 provider.dimension）', async () => {
      const provider = makeProvider(8);
      const svc = new EmbeddingService(provider, undefined, logger);
      const vec = await svc.embed('民法典');
      expect(vec).toHaveLength(8);
      expect(provider.embedMock).toHaveBeenCalledTimes(1);
    });

    it('embedBatch 多条文本按顺序返回', async () => {
      const provider = makeProvider(4);
      const svc = new EmbeddingService(provider, undefined, logger);
      const vecs = await svc.embedBatch(['民法典', '刑法', '行政法']);
      expect(vecs).toHaveLength(3);
      expect(vecs[0]).toHaveLength(4);
      expect(vecs[1]).toHaveLength(4);
      expect(vecs[2]).toHaveLength(4);
      // 每条向量首元素不同（makeProvider 注入 i*0.1 偏移）
      expect(vecs[0][0]).not.toBe(vecs[1][0]);
    });

    it('dimension getter 返回 provider.dimension', () => {
      const provider = makeProvider(16);
      const svc = new EmbeddingService(provider, undefined, logger);
      expect(svc.dimension).toBe(16);
    });

    it('embedBatch 按 batchSize 分批调用 Provider', async () => {
      const provider = makeProvider(2);
      const svc = new EmbeddingService(provider, undefined, logger);
      const texts = ['a', 'b', 'c', 'd', 'e'];
      await svc.embedBatch(texts, 2);
      // 5 条 / 每批 2 = 3 次调用（2 + 2 + 1）
      expect(provider.embedMock).toHaveBeenCalledTimes(3);
      expect(provider.embedMock).toHaveBeenNthCalledWith(1, ['a', 'b']);
      expect(provider.embedMock).toHaveBeenNthCalledWith(2, ['c', 'd']);
      expect(provider.embedMock).toHaveBeenNthCalledWith(3, ['e']);
    });
  });

  describe('边界场景', () => {
    it('空入参 embedBatch 返回空数组且不调 Provider', async () => {
      const provider = makeProvider(4);
      const svc = new EmbeddingService(provider, undefined, logger);
      const result = await svc.embedBatch([]);
      expect(result).toEqual([]);
      expect(provider.embedMock).not.toHaveBeenCalled();
    });

    it('无缓存注入时直接调 Provider', async () => {
      const provider = makeProvider(4);
      const svc = new EmbeddingService(provider, undefined, logger);
      await svc.embedBatch(['文本一', '文本二']);
      expect(provider.embedMock).toHaveBeenCalledTimes(1);
      expect(provider.embedMock).toHaveBeenCalledWith(['文本一', '文本二']);
    });

    it('缓存命中时跳过 Provider 调用', async () => {
      const provider = makeProvider(4);
      const cache = makeCache();
      const svc = new EmbeddingService(provider, cache as never, logger);
      // 第一次调用：miss → 写缓存
      const firstVec = await svc.embed('民法典');
      expect(provider.embedMock).toHaveBeenCalledTimes(1);
      expect(cache.get).toHaveBeenCalledWith(cacheKey('民法典'));
      // 第二次调用：hit → 不调 Provider
      provider.embedMock.mockClear();
      const vec = await svc.embed('民法典');
      expect(provider.embedMock).not.toHaveBeenCalled();
      expect(vec).toEqual(firstVec);
    });

    it('缓存部分命中时只对未命中文本调 Provider', async () => {
      const provider = makeProvider(4);
      const cache = makeCache();
      const svc = new EmbeddingService(provider, cache as never, logger);
      // 预填充第一条文本的缓存
      const cachedVec = await svc.embed('已缓存文本');

      provider.embedMock.mockClear();
      const vecs = await svc.embedBatch(['已缓存文本', '新文本']);
      expect(vecs).toHaveLength(2);
      // 仅未命中的 1 条触发 Provider
      expect(provider.embedMock).toHaveBeenCalledTimes(1);
      expect(provider.embedMock).toHaveBeenCalledWith(['新文本']);
      // 第一条命中缓存
      expect(vecs[0]).toEqual(cachedVec);
    });
  });

  describe('异常场景', () => {
    it('Provider 调用失败时抛错并记 error 日志', async () => {
      const provider = makeProvider(4);
      provider.embedMock.mockRejectedValueOnce(new Error('provider boom'));
      const svc = new EmbeddingService(provider, undefined, logger);
      await expect(svc.embed('文本')).rejects.toThrow('provider boom');
      expect(logger.error).toHaveBeenCalledWith(
        'embedBatch Provider 调用失败',
        expect.objectContaining({ provider: 'mock-test', count: 1 }),
      );
    });

    it('缓存读取失败时降级直连 Provider（不抛错）', async () => {
      const provider = makeProvider(4);
      const cache = makeCache();
      cache.get.mockRejectedValue(new Error('redis down'));
      const svc = new EmbeddingService(provider, cache as never, logger);
      const vec = await svc.embed('文本');
      expect(vec).toHaveLength(4);
      expect(provider.embedMock).toHaveBeenCalledTimes(1);
    });

    it('缓存写入失败时不阻塞返回（fire-and-forget）', async () => {
      const provider = makeProvider(4);
      const cache = makeCache();
      cache.set.mockRejectedValue(new Error('redis write fail'));
      const svc = new EmbeddingService(provider, cache as never, logger);
      const vec = await svc.embed('文本');
      // 主流程仍正常返回
      expect(vec).toHaveLength(4);
      // 等待 fire-and-forget 的 warn 日志
      await new Promise((r) => setImmediate(r));
      expect(logger.warn).toHaveBeenCalledWith(
        '向量缓存写入失败，降级跳过',
        expect.objectContaining({ error: 'redis write fail' }),
      );
    });
  });
});
