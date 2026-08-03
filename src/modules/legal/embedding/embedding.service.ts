/**
 * EmbeddingService —— 文本向量化 + 向量缓存（A2-W2，A2 §五）。
 *
 * 职责：
 *   1. embed(text)：单条向量化
 *   2. embedBatch(texts, batchSize)：批量向量化（分批限流，默认 10 条/批）
 *   3. 向量缓存：同文本哈希 → 向量，存 Redis（TTL 30 天），避免重复调用 Provider
 *
 * 可插拔 Provider（EMBEDDING_PROVIDER_TOKEN）：
 *   - MockEmbeddingProvider（默认，开发/测试）
 *   - AgnesEmbeddingProvider（需 EMBEDDING_API_KEY，真实语义）
 *
 * 缓存失败不阻塞（Redis 不可用时降级直连 Provider）。
 *
 * 设计依据：A2 §五；A1 CacheService L2 Redis 抽象。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmbeddingProvider } from './embedding.types';
import { EMBEDDING_PROVIDER_TOKEN } from './embedding.types';
import { CacheService } from '../../platform/cache/cache.service';
import { AppLoggerService } from '../../platform/logger/logger.service';

/** 向量缓存默认 TTL：30 天（A2 §五） */
const DEFAULT_CACHE_TTL_SEC = 30 * 24 * 3600;

@Injectable()
export class EmbeddingService {
  /** 向量缓存 TTL（秒），原为构造函数参数但 NestJS DI 会尝试注入 Number 类型，改为类字段初始化 */
  private readonly cacheTtlSec: number = DEFAULT_CACHE_TTL_SEC;

  constructor(
    @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly provider: EmbeddingProvider,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /** 单条向量化 */
  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  /** 批量向量化（分批，默认 10 条/批，对齐 A2 §五限流） */
  async embedBatch(texts: string[], batchSize = 10): Promise<number[][]> {
    if (texts.length === 0) return [];
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vecs = await this.embedBatchWithCache(batch);
      results.push(...vecs);
    }
    return results;
  }

  /** Provider 名称与维度（供外部校验向量索引定义） */
  get dimension(): number {
    return this.provider.dimension;
  }

  // ===== 内部：带缓存的批量向量化 =====

  private async embedBatchWithCache(texts: string[]): Promise<number[][]> {
    // 1. 查缓存（Redis 不可用时全 miss）
    const cached = await this.lookupCache(texts);

    // 2. 收集未命中文本
    const missIndices: number[] = [];
    const missTexts: string[] = [];
    cached.forEach((c, i) => {
      if (c === null) {
        missIndices.push(i);
        missTexts.push(texts[i]);
      }
    });

    // 3. 调 Provider 获取未命中向量
    let newVecs: number[][] = [];
    if (missTexts.length > 0) {
      try {
        newVecs = await this.provider.embed(missTexts);
      } catch (err) {
        this.logger?.error('embedBatch Provider 调用失败', {
          count: missTexts.length,
          provider: this.provider.name,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      // 4. 写缓存（失败不阻塞）
      this.writeCache(missTexts, newVecs);
    }

    // 5. 合并结果（保持入参顺序）
    const result: number[][] = new Array(texts.length);
    let missPtr = 0;
    for (let i = 0; i < texts.length; i++) {
      if (cached[i] !== null) {
        result[i] = cached[i] as number[];
      } else {
        result[i] = newVecs[missPtr++];
      }
    }
    return result;
  }

  /** 批量查缓存；Redis 不可用或未注入时返回全 null */
  private async lookupCache(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.cache) return texts.map(() => null);
    return Promise.all(
      texts.map(async (t) => {
        try {
          return await this.cache!.get<number[]>(this.cacheKey(t));
        } catch {
          return null;
        }
      }),
    );
  }

  /** 批量写缓存（fire-and-forget，失败不阻塞） */
  private writeCache(texts: string[], vecs: number[][]): void {
    if (!this.cache) return;
    for (let i = 0; i < texts.length; i++) {
      const key = this.cacheKey(texts[i]);
      this.cache.set(key, vecs[i], this.cacheTtlSec).catch((err) => {
        this.logger?.warn('向量缓存写入失败，降级跳过', {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /** 缓存键：embed:sha256(text) */
  private cacheKey(text: string): string {
    return `embed:${createHash('sha256').update(text).digest('hex')}`;
  }
}
