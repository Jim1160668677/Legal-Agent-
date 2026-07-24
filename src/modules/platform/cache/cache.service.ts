/**
 * CacheService —— 统一缓存抽象（A1-W2）。
 *
 * 三层职责：
 *   L2 Redis：通用 KV 缓存（限流计数、会话状态、热点数据），TTL 由调用方指定
 *   L3 llm_cache：LLM 响应持久化缓存（MongoDB 集合，按 promptHash 索引，TTL 7 天）
 *   失效：法条更新时按 affectedLawArticles 批量失效 LLM 缓存
 *
 * 设计依据：A1 §6.5；05 数据模型 llm_cache 集合。
 */
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { LlmCache, type LlmCacheDocument } from '../../../infra/database/schemas/system.schema';

@Injectable()
export class CacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectModel(LlmCache.name) private readonly llmCacheModel: Model<LlmCacheDocument>,
  ) {}

  // ===== L2 Redis =====

  /** 取值；JSON 反序列化；不存在返回 null */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 非 JSON 值原样返回（限流计数等纯字符串场景）
      return raw as unknown as T;
    }
  }

  /** 存值；值序列化为 JSON；ttlSec <= 0 时永久 */
  async set<T>(key: string, val: T, ttlSec: number): Promise<void> {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);
    if (ttlSec > 0) {
      await this.redis.set(key, serialized, 'EX', ttlSec);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  /** 删除单个 key */
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /** 原子自增并返回自增后的值；用于限流计数。无 TTL 时默认 60s */
  async incr(key: string, ttlSec = 60): Promise<number> {
    const v = await this.redis.incr(key);
    // 仅当首次自增（v===1）时设置过期，避免每次重置 TTL
    if (v === 1) {
      await this.redis.expire(key, ttlSec);
    }
    return v;
  }

  // ===== L3 llm_cache 集合 =====

  /**
   * LLM 缓存命中查询。
   * @param promptHash sha256(prompt+model+promptVersion)
   * @returns response 字符串；未命中返回 null
   */
  async getLlmCache(promptHash: string): Promise<string | null> {
    const doc = await this.llmCacheModel
      .findOne({ promptHash })
      .select({ response: 1, hitCount: 1 })
      .lean<{ response: string; hitCount: number }>()
      .exec();
    if (!doc) return null;
    // 异步累加命中计数，不阻塞调用方
    void this.llmCacheModel
      .updateOne({ promptHash }, { $inc: { hitCount: 1 } })
      .exec()
      .catch(() => {
        /* 命中计数失败不影响缓存读取 */
      });
    return doc.response;
  }

  /**
   * 写入 LLM 缓存。
   * @param promptHash 见 getLlmCache
   * @param response LLM 完整响应文本
   * @param meta 关联元数据：model/promptVersion/intent/affectedLawArticles
   */
  async setLlmCache(
    promptHash: string,
    response: string,
    meta: {
      model: string;
      promptVersion?: string;
      intent?: string;
      affectedLawArticles?: string[];
    },
  ): Promise<void> {
    const expireAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 天
    await this.llmCacheModel
      .findOneAndUpdate(
        { promptHash },
        {
          $set: {
            promptHash,
            model: meta.model,
            promptVersion: meta.promptVersion,
            intent: meta.intent,
            response,
            affectedLawArticles: meta.affectedLawArticles ?? [],
            expireAt,
          },
          $setOnInsert: { hitCount: 0 },
        },
        { upsert: true },
      )
      .exec();
  }

  /**
   * 法条更新时批量失效相关 LLM 缓存。
   * @param articleIds 法条 _id 或 contentHash 列表
   */
  async invalidateByLawArticle(articleIds: string[]): Promise<number> {
    if (articleIds.length === 0) return 0;
    const res = await this.llmCacheModel
      .deleteMany({ affectedLawArticles: { $in: articleIds } })
      .exec();
    return res.deletedCount;
  }
}
