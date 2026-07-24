/**
 * CacheService 单元测试（A1-W2）。
 *
 * 验收点（A1 §6.5）：
 *   - L2 Redis get/set/del/incr（JSON 序列化）
 *   - L3 llm_cache getLlmCache/setLlmCache/invalidateByLawArticle
 *   - 命中计数累加（非阻塞）
 *
 * 设计依据：A1 §6.5。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { CacheService } from '../../src/modules/platform/cache/cache.service';
import { LlmCache } from '../../src/infra/database/schemas/system.schema';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';

describe('CacheService', () => {
  let svc: CacheService;
  let redis: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let llmCacheModel: {
    findOne: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
    findOneAndUpdate: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    redis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      incr: vi.fn(),
      expire: vi.fn(),
    };
    llmCacheModel = {
      findOne: vi.fn(),
      updateOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      deleteMany: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: getModelToken(LlmCache.name), useValue: llmCacheModel },
      ],
    }).compile();
    svc = moduleRef.get(CacheService);
  });

  describe('L2 Redis', () => {
    it('get 命中 JSON 值 → 反序列化', async () => {
      redis.get.mockResolvedValue('{"k":1}');
      expect(await svc.get('k')).toEqual({ k: 1 });
    });
    it('get 命中纯字符串 → 原样返回', async () => {
      redis.get.mockResolvedValue('hello');
      expect(await svc.get('k')).toBe('hello');
    });
    it('get 未命中 → null', async () => {
      redis.get.mockResolvedValue(null);
      expect(await svc.get('k')).toBeNull();
    });
    it('set 序列化对象 + 带 TTL', async () => {
      await svc.set('k', { a: 1 }, 60);
      expect(redis.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 60);
    });
    it('set 字符串不二次序列化', async () => {
      await svc.set('k', 'raw', 60);
      expect(redis.set).toHaveBeenCalledWith('k', 'raw', 'EX', 60);
    });
    it('set TTL<=0 不带 EX', async () => {
      await svc.set('k', 'v', 0);
      expect(redis.set).toHaveBeenCalledWith('k', 'v');
    });
    it('del 删除', async () => {
      await svc.del('k');
      expect(redis.del).toHaveBeenCalledWith('k');
    });
    it('incr 首次返回 1 并设过期', async () => {
      redis.incr.mockResolvedValue(1);
      const v = await svc.incr('counter', 60);
      expect(v).toBe(1);
      expect(redis.expire).toHaveBeenCalledWith('counter', 60);
    });
    it('incr 非首次不重设过期', async () => {
      redis.incr.mockResolvedValue(5);
      await svc.incr('counter', 60);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  describe('L3 llm_cache', () => {
    it('getLlmCache 命中返回 response', async () => {
      llmCacheModel.findOne.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi
            .fn()
            .mockReturnValue({ exec: vi.fn().mockResolvedValue({ response: 'cached-answer' }) }),
        }),
      });
      llmCacheModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
      expect(await svc.getLlmCache('hash123')).toBe('cached-answer');
    });
    it('getLlmCache 未命中返回 null', async () => {
      llmCacheModel.findOne.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
        }),
      });
      expect(await svc.getLlmCache('hash123')).toBeNull();
    });
    it('setLlmCache 调 findOneAndUpdate upsert', async () => {
      llmCacheModel.findOneAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
      await svc.setLlmCache('hash', 'resp', { model: 'agnes-2.0-flash' });
      expect(llmCacheModel.findOneAndUpdate).toHaveBeenCalled();
      const args = llmCacheModel.findOneAndUpdate.mock.calls[0];
      expect(args[0]).toEqual({ promptHash: 'hash' });
      expect(args[2]).toEqual({ upsert: true });
    });
    it('invalidateByLawArticle 空数组返回 0', async () => {
      expect(await svc.invalidateByLawArticle([])).toBe(0);
      expect(llmCacheModel.deleteMany).not.toHaveBeenCalled();
    });
    it('invalidateByLawArticle 命中返回删除数', async () => {
      llmCacheModel.deleteMany.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ deletedCount: 3 }),
      });
      expect(await svc.invalidateByLawArticle(['law-1', 'law-2'])).toBe(3);
      expect(llmCacheModel.deleteMany).toHaveBeenCalledWith({
        affectedLawArticles: { $in: ['law-1', 'law-2'] },
      });
    });
  });
});
