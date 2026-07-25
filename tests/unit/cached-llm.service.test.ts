/**
 * CachedLlmService 单元测试（A3-W1）。
 *
 * 覆盖（A3 §3.2-3.3 + §十 验收）：
 *   - 缓存命中：不调 legacy，raw.fromCache=true，usage 全 0
 *   - 缓存未命中：调 legacy + 写缓存 + 审计
 *   - enableCache=false 跳过缓存
 *   - 无 cache 注入直连 legacy
 *   - 缓存读/写失败降级不阻塞
 *   - 熔断器包裹 generate / stream
 *   - 熔断 open 抛 LlmDegradedError
 *   - 流式不查缓存、错误记 failure
 *   - validateLawRefs 委托
 *   - promptHash 随采样参数变化
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CachedLlmService } from '../../src/modules/legal/llm/cached-llm.service';
import { LlmDegradedError } from '../../src/modules/legal/llm/llm-errors';
import type {
  LlmService,
  ChatMessage,
  LlmOpts,
  LlmResponse,
  LlmChunk,
  LawRefCheckResult,
} from '../../src/types/llm';

// ===== Mock 工具 =====

function makeLlmResponse(content: string, model = 'agnes-2.0-flash'): LlmResponse {
  return {
    content,
    model,
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    raw: { fromCache: false },
  };
}

/** Mock legacy LlmService */
function makeLegacy(overrides: Partial<LlmService> = {}): LlmService & { mockClear: () => void } {
  const generate = vi.fn(async (_input: string | ChatMessage[], _opts?: LlmOpts) =>
    makeLlmResponse('legacy-response'),
  );
  const stream = vi.fn(async function* (
    _input: string | ChatMessage[],
    _opts?: LlmOpts,
  ): AsyncGenerator<LlmChunk> {
    yield { delta: 'chunk-', done: false };
    yield {
      delta: '1',
      done: true,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  });
  const validateLawRefs = vi.fn(async (text: string): Promise<LawRefCheckResult> => ({
    verified: [],
    unverified: [],
    sanitizedText: text,
  }));
  const obj = { generate, stream, validateLawRefs, ...overrides } as unknown as LlmService & {
    mockClear: () => void;
  };
  Object.defineProperty(obj, 'mockClear', {
    value: () => {
      generate.mockClear();
      stream.mockClear();
      validateLawRefs.mockClear();
    },
  });
  return obj;
}

/** Mock CacheService */
interface MockCache {
  getLlmCache: ReturnType<typeof vi.fn>;
  setLlmCache: ReturnType<typeof vi.fn>;
}
function makeCache(): MockCache {
  return {
    getLlmCache: vi.fn(async (_hash: string) => null as string | null),
    setLlmCache: vi.fn(async () => undefined),
  };
}

/** Mock AuditLogService */
function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn(async () => undefined) };
}

/** Mock CircuitBreaker：可配置 execute/executeStream 行为 */
function makeBreaker(opts: { executeThrows?: boolean; streamThrows?: boolean } = {}) {
  return {
    execute: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
      if (opts.executeThrows) throw new LlmDegradedError('LLM circuit breaker open', 'open');
      return fn();
    }),
    executeStream: vi.fn(async function* <T>(
      fn: () => AsyncIterable<T>,
    ): AsyncGenerator<T, void, void> {
      if (opts.streamThrows) throw new LlmDegradedError('LLM circuit breaker open', 'open');
      for await (const chunk of fn()) yield chunk;
    }),
  };
}

describe('CachedLlmService', () => {
  let legacy: ReturnType<typeof makeLegacy>;
  let cache: MockCache;
  let audit: ReturnType<typeof makeAudit>;
  let breaker: ReturnType<typeof makeBreaker>;

  beforeEach(() => {
    legacy = makeLegacy();
    cache = makeCache();
    audit = makeAudit();
    breaker = makeBreaker();
  });

  describe('generate - 缓存命中', () => {
    it('命中时直返缓存内容，不调 legacy', async () => {
      cache.getLlmCache.mockResolvedValueOnce('cached-answer');
      const svc = new CachedLlmService(legacy, cache, breaker, audit);

      const res = await svc.generate('问题', { model: 'm' });

      expect(legacy.generate).not.toHaveBeenCalled();
      expect(res.content).toBe('cached-answer');
      expect(res.raw).toEqual({ fromCache: true });
      expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
      expect(res.finishReason).toBe('stop');
    });

    it('命中时审计写 cacheHit=true', async () => {
      cache.getLlmCache.mockResolvedValueOnce('cached');
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      await svc.generate('q');
      expect(audit.write).toHaveBeenCalledWith(
        'llm_call',
        expect.objectContaining({ cacheHit: true }),
      );
    });

    it('命中时 model 回退到 opts.model', async () => {
      cache.getLlmCache.mockResolvedValueOnce('cached');
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      const res = await svc.generate('q', { model: 'agnes-x' });
      expect(res.model).toBe('agnes-x');
    });
  });

  describe('generate - 缓存未命中', () => {
    it('未命中调 legacy 并写缓存', async () => {
      cache.getLlmCache.mockResolvedValueOnce(null);
      const svc = new CachedLlmService(legacy, cache, breaker, audit);

      const res = await svc.generate('问题', { model: 'm' });

      expect(legacy.generate).toHaveBeenCalledWith('问题', expect.objectContaining({ model: 'm' }));
      expect(res.content).toBe('legacy-response');
      expect(cache.setLlmCache).toHaveBeenCalledWith(
        expect.any(String),
        'legacy-response',
        expect.objectContaining({ model: 'agnes-2.0-flash' }),
      );
    });

    it('写缓存时提取法条引用作为 affectedLawArticles', async () => {
      legacy.generate = vi.fn(async () => makeLlmResponse('依据《民法典》第一百四十三条之规定'));
      cache.getLlmCache.mockResolvedValueOnce(null);
      const svc = new CachedLlmService(legacy, cache, breaker, audit);

      await svc.generate('q');

      expect(cache.setLlmCache).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('民法典'),
        expect.objectContaining({
          affectedLawArticles: expect.arrayContaining(['民法典第一百四十三条']),
        }),
      );
    });

    it('未命中审计写 cacheHit=false', async () => {
      cache.getLlmCache.mockResolvedValueOnce(null);
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      await svc.generate('q');
      expect(audit.write).toHaveBeenCalledWith(
        'llm_call',
        expect.objectContaining({ cacheHit: false }),
      );
    });
  });

  describe('generate - 缓存控制', () => {
    it('enableCache=false 跳过缓存读写，仍走熔断', async () => {
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      const res = await svc.generate('q', { enableCache: false });

      expect(cache.getLlmCache).not.toHaveBeenCalled();
      expect(cache.setLlmCache).not.toHaveBeenCalled();
      expect(breaker.execute).toHaveBeenCalled();
      expect(res.content).toBe('legacy-response');
    });

    it('无 cache 注入时直连 legacy + 熔断', async () => {
      const svc = new CachedLlmService(legacy, undefined, breaker, audit);
      const res = await svc.generate('q');
      expect(breaker.execute).toHaveBeenCalled();
      expect(res.content).toBe('legacy-response');
    });
  });

  describe('generate - 容错', () => {
    it('缓存读失败降级到 legacy', async () => {
      cache.getLlmCache.mockRejectedValueOnce(new Error('redis down'));
      const svc = new CachedLlmService(legacy, cache, breaker, audit);

      const res = await svc.generate('q');

      expect(legacy.generate).toHaveBeenCalled();
      expect(res.content).toBe('legacy-response');
    });

    it('缓存写失败不阻塞主流程', async () => {
      cache.getLlmCache.mockResolvedValueOnce(null);
      cache.setLlmCache.mockRejectedValueOnce(new Error('mongo down'));
      const svc = new CachedLlmService(legacy, cache, breaker, audit);

      const res = await svc.generate('q');
      expect(res.content).toBe('legacy-response');
    });
  });

  describe('generate - 熔断', () => {
    it('熔断器 open 时抛 LlmDegradedError，不调 legacy', async () => {
      const openBreaker = makeBreaker({ executeThrows: true });
      const svc = new CachedLlmService(legacy, cache, openBreaker, audit);
      cache.getLlmCache.mockResolvedValueOnce(null);

      await expect(svc.generate('q')).rejects.toBeInstanceOf(LlmDegradedError);
      expect(legacy.generate).not.toHaveBeenCalled();
    });

    it('无 breaker 注入时直连 legacy', async () => {
      const svc = new CachedLlmService(legacy, cache, undefined, audit);
      cache.getLlmCache.mockResolvedValueOnce(null);
      const res = await svc.generate('q');
      expect(legacy.generate).toHaveBeenCalled();
      expect(res.content).toBe('legacy-response');
    });
  });

  describe('stream', () => {
    it('不查缓存，经熔断 executeStream 包裹', async () => {
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      const chunks: LlmChunk[] = [];
      for await (const c of svc.stream('q')) chunks.push(c);

      expect(cache.getLlmCache).not.toHaveBeenCalled();
      expect(breaker.executeStream).toHaveBeenCalled();
      expect(chunks.map((c) => c.delta).join('')).toBe('chunk-1');
    });

    it('无 breaker 时直连 legacy 流', async () => {
      const svc = new CachedLlmService(legacy, cache, undefined, audit);
      const chunks: LlmChunk[] = [];
      for await (const c of svc.stream('q')) chunks.push(c);
      expect(legacy.stream).toHaveBeenCalled();
      expect(chunks.map((c) => c.delta).join('')).toBe('chunk-1');
    });

    it('熔断 open 时流式抛 LlmDegradedError', async () => {
      const openBreaker = makeBreaker({ streamThrows: true });
      const svc = new CachedLlmService(legacy, cache, openBreaker, audit);
      await expect(async () => {
        for await (const _c of svc.stream('q')) {
          // consume
        }
      }).rejects.toBeInstanceOf(LlmDegradedError);
    });

    it('流式错误透传（breaker 记 failure）', async () => {
      const errBreaker = makeBreaker();
      errBreaker.executeStream.mockImplementationOnce(async function* () {
        yield undefined; // 满足 require-yield；消费方丢弃后即见 throw
        throw new Error('stream-boom');
      });
      const svc = new CachedLlmService(legacy, cache, errBreaker, audit);
      await expect(async () => {
        for await (const _c of svc.stream('q')) {
          // consume
        }
      }).rejects.toThrow('stream-boom');
    });
  });

  describe('validateLawRefs', () => {
    it('直接委托 legacy，不查缓存/熔断', async () => {
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      const result = await svc.validateLawRefs('text');
      expect(legacy.validateLawRefs).toHaveBeenCalledWith('text');
      expect(result.sanitizedText).toBe('text');
      expect(cache.getLlmCache).not.toHaveBeenCalled();
    });
  });

  describe('promptHash', () => {
    it('不同 temperature 产生不同 hash（缓存隔离）', async () => {
      cache.getLlmCache.mockResolvedValue(null);
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      await svc.generate('q', { temperature: 0.3 });
      await svc.generate('q', { temperature: 0.7 });
      const hash1 = cache.setLlmCache.mock.calls[0][0] as string;
      const hash2 = cache.setLlmCache.mock.calls[1][0] as string;
      expect(hash1).not.toBe(hash2);
    });

    it('相同输入 + 相同参数产生相同 hash（缓存命中前提）', async () => {
      cache.getLlmCache.mockResolvedValue(null);
      const svc = new CachedLlmService(legacy, cache, breaker, audit);
      await svc.generate('q', { temperature: 0.3, model: 'm' });
      await svc.generate('q', { temperature: 0.3, model: 'm' });
      const hash1 = cache.setLlmCache.mock.calls[0][0] as string;
      const hash2 = cache.setLlmCache.mock.calls[1][0] as string;
      expect(hash1).toBe(hash2);
    });
  });
});
