/**
 * RuleEngineService 单元测试（A1-W3）。
 *
 * 覆盖三类场景：
 *   - 正常场景：法条精确匹配 / 关键词召回 / FAQ 快答
 *   - 边界场景：空输入 / 无命中 / 不存在的条号 / 性能 < 100ms
 *   - 异常场景：非字符串输入
 *
 * 设计依据：06 §八 RuleEngine；07 §2.6 法条引用校验。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleEngineService } from '../../src/modules/legal/rule/rule-engine.service';

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

describe('RuleEngineService', () => {
  let svc: RuleEngineService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    svc = new RuleEngineService(logger as never);
  });

  describe('正常场景：法条精确匹配', () => {
    it('中文条号：民法典第一百四十三条 → 命中 + verified=true', async () => {
      const r = await svc.query('请问民法典第一百四十三条怎么理解');
      expect(r).not.toBeNull();
      expect(r!.source).toBe('law_article');
      expect(r!.lawRefs[0].ref).toContain('民法典');
      expect(r!.lawRefs[0].ref).toContain('第一百四十三条');
      expect(r!.lawRefs[0].verified).toBe(true);
      expect(r!.matchedKey).toBe('民法典#143');
      expect(r!.answer).toContain('民事法律行为有效');
    });

    it('阿拉伯条号：刑法第20条 → 命中', async () => {
      const r = await svc.query('刑法第20条正当防卫怎么认定');
      expect(r).not.toBeNull();
      expect(r!.source).toBe('law_article');
      expect(r!.matchedKey).toBe('刑法#20');
      expect(r!.answer).toContain('正当防卫');
    });

    it('带书名号：《民法典》第188条 → 命中', async () => {
      const r = await svc.query('《民法典》第188条诉讼时效');
      expect(r).not.toBeNull();
      expect(r!.matchedKey).toBe('民法典#188');
      expect(r!.answer).toContain('诉讼时效');
    });

    it('劳动合同法第47条 → 命中经济补偿', async () => {
      const r = await svc.query('劳动合同法第47条经济补偿怎么算');
      expect(r).not.toBeNull();
      expect(r!.matchedKey).toBe('劳动合同法#47');
      expect(r!.answer).toContain('经济补偿');
    });
  });

  describe('正常场景：关键词召回', () => {
    it('无明确引用但含关键词 → 关键词召回', async () => {
      const r = await svc.query('打官司诉讼时效是几年');
      expect(r).not.toBeNull();
      expect(r!.source).toBe('law_article');
      expect(r!.answer).toContain('诉讼时效');
    });

    it('正当防卫关键词 → 命中刑法第20条', async () => {
      const r = await svc.query('什么是正当防卫');
      expect(r).not.toBeNull();
      expect(r!.matchedKey).toBe('刑法#20');
    });
  });

  describe('正常场景：FAQ 快答', () => {
    it('你是谁 → FAQ 命中', async () => {
      const r = await svc.query('你是谁呀');
      expect(r).not.toBeNull();
      expect(r!.source).toBe('faq');
      expect(r!.matchedKey).toBe('问候');
      expect(r!.answer).toContain('法律智能助手');
    });

    it('免责声明 → FAQ 命中', async () => {
      const r = await svc.query('你能代替律师吗');
      expect(r).not.toBeNull();
      expect(r!.source).toBe('faq');
      expect(r!.answer).toContain('不构成法律意见');
    });
  });

  describe('边界场景', () => {
    it('空字符串 → null', async () => {
      expect(await svc.query('')).toBeNull();
    });

    it('纯空白 → null', async () => {
      expect(await svc.query('   ')).toBeNull();
    });

    it('无命中内容 → null', async () => {
      expect(await svc.query('今天天气真好啊')).toBeNull();
    });

    it('法条引用但库中不存在 → 尝试关键词召回，无则 null', async () => {
      // 民法典第999条不在种子集，且无其他关键词命中
      const r = await svc.query('民法典第999条');
      expect(r).toBeNull();
    });

    it('法条精确匹配优先于关键词召回', async () => {
      // 同时含引用和关键词，应走精确匹配
      const r = await svc.query('民法典第一百八十八条诉讼时效');
      expect(r).not.toBeNull();
      expect(r!.source).toBe('law_article');
      expect(r!.matchedKey).toBe('民法典#188');
    });
  });

  describe('异常场景', () => {
    it('非字符串输入 → null', async () => {
      expect(await svc.query(null as unknown as string)).toBeNull();
      expect(await svc.query(undefined as unknown as string)).toBeNull();
    });
  });

  describe('性能：法条查询 < 100ms', () => {
    it('单次精确匹配耗时 < 100ms', async () => {
      const start = Date.now();
      await svc.query('民法典第一百四十三条');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it('批量 100 次查询总耗时 < 1000ms', async () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        await svc.query('民法典第一百四十三条规定了什么');
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
