/**
 * KnowledgeBaseService 单元测试（A2-W1）。
 *
 * 覆盖三类场景：
 *   - 正常场景：queryByType / queryByKeyword / getById
 *   - 边界场景：空关键词 / 空 id / subCategory 过滤 / 未知 type 归一化
 *   - 异常场景：DB 查询失败降级返回空
 *
 * 实现注：手动 new KnowledgeBaseService(model, logger) 绕过 NestJS DI，
 *       mock Mongoose 链式调用（find().lean().exec() / findById().lean().exec()）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeBaseService } from '../../src/modules/legal/knowledge/knowledge-base.service';
import type { LegalKnowledgeLean } from '../../src/modules/legal/knowledge/knowledge.types';

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

/** 构造 mock knowledgeModel（链式 find/findById → lean → exec） */
function makeKnowledgeModel(
  docs: LegalKnowledgeLean[] = [],
  doc: LegalKnowledgeLean | null = null,
) {
  const execMany = vi.fn().mockResolvedValue(docs);
  const leanMany = vi.fn().mockReturnValue({ exec: execMany });
  const execOne = vi.fn().mockResolvedValue(doc);
  const leanOne = vi.fn().mockReturnValue({ exec: execOne });
  return {
    find: vi.fn().mockReturnValue({ lean: leanMany }),
    findById: vi.fn().mockReturnValue({ lean: leanOne }),
    _execMany: execMany,
    _execOne: execOne,
  };
}

const sampleDoc: LegalKnowledgeLean = {
  _id: '1',
  type: 'process',
  category: '民事',
  subCategory: '一审',
  title: '民事诉讼一审流程',
  content: '民事诉讼流程包括立案受理、开庭审理等阶段。',
  structured: {
    steps: [{ stage: '立案受理', description: '法院七日内决定是否立案', duration: '7日内' }],
  },
  lawRefs: ['民事诉讼法第一百二十六条'],
  tags: ['民事诉讼', '流程', '立案'],
};

describe('KnowledgeBaseService', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('正常场景：queryByType', () => {
    it('按 type+category 查询，返回 KnowledgeResult（lawRefs 转为 LawRef[]，score=1.0）', async () => {
      const model = makeKnowledgeModel([sampleDoc]);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByType('process', '民事');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('民事诉讼一审流程');
      expect(results[0].type).toBe('process');
      expect(results[0].score).toBe(1.0);
      expect(results[0].lawRefs).toEqual([{ ref: '民事诉讼法第一百二十六条', verified: false }]);
      expect(model.find).toHaveBeenCalledWith({ type: 'process', category: '民事' });
    });

    it('带 subCategory 时 filter 含 subCategory', async () => {
      const model = makeKnowledgeModel([sampleDoc]);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      await svc.queryByType('process', '民事', '一审');
      expect(model.find).toHaveBeenCalledWith({
        type: 'process',
        category: '民事',
        subCategory: '一审',
      });
    });

    it('未知 type 归一化为 faq', async () => {
      const doc: LegalKnowledgeLean = { ...sampleDoc, type: 'unknown_type' };
      const model = makeKnowledgeModel([doc]);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByType('unknown_type', '民事');
      expect(results[0].type).toBe('faq');
    });
  });

  describe('正常场景：queryByKeyword', () => {
    it('title 命中评分 1.0，content 命中评分 0.3，按分数降序', async () => {
      const titleHit: LegalKnowledgeLean = {
        ...sampleDoc,
        _id: '1',
        title: '民事诉讼流程',
        tags: [],
      };
      const contentHit: LegalKnowledgeLean = {
        ...sampleDoc,
        _id: '2',
        title: '其他知识',
        content: '涉及民事诉讼相关内容',
        tags: [],
      };
      const model = makeKnowledgeModel([contentHit, titleHit]);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByKeyword('民事诉讼');
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('民事诉讼流程');
      expect(results[0].score).toBe(1.0);
      expect(results[1].score).toBe(0.3);
    });

    it('tags 命中评分 0.6', async () => {
      const tagHit: LegalKnowledgeLean = {
        ...sampleDoc,
        _id: '3',
        title: '诉讼指南',
        content: '一般指南内容',
        tags: ['民事诉讼'],
      };
      const model = makeKnowledgeModel([tagHit]);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByKeyword('民事诉讼');
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.6);
    });

    it('limit 截断结果数', async () => {
      const docs: LegalKnowledgeLean[] = Array.from({ length: 5 }, (_, i) => ({
        ...sampleDoc,
        _id: String(i),
        title: `民事诉讼流程${i}`,
      }));
      const model = makeKnowledgeModel(docs);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByKeyword('民事诉讼', { limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('正常场景：getById', () => {
    it('存在时返回单条 KnowledgeResult', async () => {
      const model = makeKnowledgeModel([], sampleDoc);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const result = await svc.getById('1');
      expect(result).not.toBeNull();
      expect(result!.title).toBe('民事诉讼一审流程');
      expect(result!.score).toBe(1.0);
    });

    it('不存在时返回 null', async () => {
      const model = makeKnowledgeModel([], null);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const result = await svc.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('边界场景', () => {
    it('queryByKeyword 空关键词返回空数组', async () => {
      const model = makeKnowledgeModel([sampleDoc]);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByKeyword('   ');
      expect(results).toEqual([]);
      expect(model.find).not.toHaveBeenCalled();
    });

    it('getById 空 id 返回 null', async () => {
      const model = makeKnowledgeModel([], sampleDoc);
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const result = await svc.getById('');
      expect(result).toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('异常场景：DB 查询失败降级', () => {
    it('queryByType 异常返回空数组并记日志', async () => {
      const execMany = vi.fn().mockRejectedValue(new Error('DB connection lost'));
      const leanMany = vi.fn().mockReturnValue({ exec: execMany });
      const model = { find: vi.fn().mockReturnValue({ lean: leanMany }) };
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByType('process', '民事');
      expect(results).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('queryByKeyword 异常返回空数组', async () => {
      const execMany = vi.fn().mockRejectedValue(new Error('DB error'));
      const leanMany = vi.fn().mockReturnValue({ exec: execMany });
      const model = { find: vi.fn().mockReturnValue({ lean: leanMany }) };
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const results = await svc.queryByKeyword('民事诉讼');
      expect(results).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('getById 异常返回 null', async () => {
      const execOne = vi.fn().mockRejectedValue(new Error('DB error'));
      const leanOne = vi.fn().mockReturnValue({ exec: execOne });
      const model = { findById: vi.fn().mockReturnValue({ lean: leanOne }) };
      const svc = new KnowledgeBaseService(model as never, logger as never);
      const result = await svc.getById('1');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
