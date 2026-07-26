/**
 * EntityExtractorService 单元测试（v2.3-W4，07 §8.1）。
 *
 * 覆盖四层实体抽取：
 *   - L1 正则层：日期/金额/身份证/电话/法条/合同
 *   - L2 词典层：当事人角色 + 案由 + 通用法律术语
 *   - L3 LLM NER：LLM 可用 / 不可用 / JSON 解析失败 / 调用异常
 *   - L4 上下文消解：代词 → 上一轮 person/org 实体
 *   - 去重：相同 type+value+span 保留高优先级
 *   - 持久化：DB 写入失败降级 / 跨轮加载
 *
 * 设计依据：07 §8.1 第 1-7 步。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityExtractorService } from '../../src/modules/legal/nlu/entity-extractor.service';
import type { Entity } from '../../src/modules/legal/nlu/nlu.types';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

/** 构造 mock LlmService，generate 返回指定 JSON */
function makeLlm(jsonResponse: string, model = 'agnes-2.0-flash') {
  return {
    generate: vi.fn().mockResolvedValue({
      content: jsonResponse,
      model,
      finishReason: 'stop',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      raw: {},
    }),
    stream: vi.fn(),
    validateLawRefs: vi.fn(),
  };
}

describe('v2.3-W4 EntityExtractorService（四层实体抽取）', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('L1 正则层', () => {
    it('抽取日期、金额、身份证、电话、法条引用、合同', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const text =
        '张三于2023年5月10日借款50000元，身份证号11010119900307723X，电话13800138000，依据民法典第143条，签订借款合同。';
      const result = await svc.extract(text);

      const types = result.entities.map((e) => e.type);
      expect(types).toContain('date');
      expect(types).toContain('amount');
      expect(types).toContain('idcard');
      expect(types).toContain('phone');
      expect(types).toContain('law_ref');
      expect(types).toContain('contract');

      const date = result.entities.find((e) => e.type === 'date');
      expect(date?.value).toBe('2023年5月10日');
      expect(date?.source).toBe('regex');

      const idcard = result.entities.find((e) => e.type === 'idcard');
      expect(idcard?.value).toBe('11010119900307723X');

      const amount = result.entities.find((e) => e.type === 'amount');
      expect(amount?.value).toBe('50000元');
    });

    it('金额支持"万元"单位', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('赔偿10万元，违约金5万元');
      const amounts = result.entities.filter((e) => e.type === 'amount');
      expect(amounts.length).toBe(2);
      expect(amounts.map((a) => a.value).sort()).toEqual(['10万元', '5万元']);
    });

    it('法条引用支持中文数字', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('依据第一百四十三条');
      const lawRef = result.entities.find((e) => e.type === 'law_ref');
      expect(lawRef?.value).toBe('第一百四十三条');
    });
  });

  describe('L2 词典层', () => {
    it('抽取当事人角色', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('原告张三起诉被告李四，第三人王五出庭');
      const persons = result.entities.filter((e) => e.type === 'person' && e.source === 'dict');
      const values = persons.map((p) => p.value);
      // 不依赖顺序的断言（sort 默认按 Unicode，"三" < "被"）
      expect(values).toEqual(expect.arrayContaining(['原告', '被告', '第三人']));
      expect(values.length).toBe(3);
    });

    it('抽取案由（case_cause 类型，优先于 legal_term）', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('本案为租赁合同纠纷');
      const cause = result.entities.find((e) => e.type === 'case_cause');
      expect(cause?.value).toBe('租赁合同纠纷');
      expect(cause?.source).toBe('dict');
    });

    it('抽取通用法律术语', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('涉及诉讼时效与不可抗力');
      const terms = result.entities.filter((e) => e.type === 'legal_term');
      const values = terms.map((t) => t.value).sort();
      expect(values).toContain('诉讼时效');
      expect(values).toContain('不可抗力');
    });

    it('同一术语多次出现均保留（不同 span）', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('原告起诉原告');
      const persons = result.entities.filter((e) => e.value === '原告');
      expect(persons.length).toBe(2);
      expect(persons[0].span).not.toEqual(persons[1].span);
    });
  });

  describe('L3 LLM NER 层', () => {
    it('LLM 不可用时降级返回 L1+L2，degradedCode=8010', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('原告张三起诉被告李四，涉及诉讼时效');

      expect(result.degradedCode).toBe(8010);
      expect(result.warnings.some((w) => w.includes('LLM NER 降级'))).toBe(true);
      // 仍返回 L1+L2 实体
      expect(result.entities.length).toBeGreaterThan(0);
      const sources = new Set(result.entities.map((e) => e.source));
      expect(sources.has('regex') || sources.has('dict')).toBe(true);
      expect(sources.has('llm')).toBe(false);
    });

    it('LLM 返回有效 JSON：合并 person/org 实体', async () => {
      const llm = makeLlm(
        JSON.stringify([
          { type: 'person', value: '张三', span: [0, 2], confidence: 0.95 },
          { type: 'org', value: '腾讯公司', span: [10, 14], confidence: 0.9 },
        ]),
      );
      const svc = new EntityExtractorService(llm as never, undefined, logger as never);
      const result = await svc.extract('张三在腾讯公司工作');

      const persons = result.entities.filter((e) => e.type === 'person' && e.source === 'llm');
      const orgs = result.entities.filter((e) => e.type === 'org' && e.source === 'llm');
      expect(persons.length).toBe(1);
      expect(persons[0].value).toBe('张三');
      expect(orgs.length).toBe(1);
      expect(orgs[0].value).toBe('腾讯公司');
      expect(result.degradedCode).toBeUndefined();
      expect(result.tokensIn).toBe(50);
      expect(result.tokensOut).toBe(30);
    });

    it('LLM 返回非法 JSON：降级返回 L1+L2，degradedCode=8010', async () => {
      const llm = makeLlm('这不是JSON');
      const svc = new EntityExtractorService(llm as never, undefined, logger as never);
      const result = await svc.extract('原告起诉被告');

      expect(result.degradedCode).toBe(8010);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('LLM 返回 span 与实际位置不符：自动重新定位', async () => {
      const llm = makeLlm(
        JSON.stringify([{ type: 'person', value: '张三', span: [99, 101], confidence: 0.9 }]),
      );
      const svc = new EntityExtractorService(llm as never, undefined, logger as never);
      const result = await svc.extract('原告张三起诉');

      const person = result.entities.find((e) => e.value === '张三' && e.source === 'llm');
      expect(person).toBeDefined();
      expect(person?.span[0]).toBe(2); // "原告" 后的 "张三" 起始位置
      expect(person?.span[1]).toBe(4);
    });

    it('LLM 抛异常：降级返回 L1+L2 + warnings', async () => {
      const llm = {
        generate: vi.fn().mockRejectedValue(new Error('LLM 服务不可用')),
        stream: vi.fn(),
        validateLawRefs: vi.fn(),
      };
      const svc = new EntityExtractorService(llm as never, undefined, logger as never);
      const result = await svc.extract('原告起诉被告');

      expect(result.degradedCode).toBe(8010);
      expect(result.warnings.some((w) => w.includes('LLM NER 异常'))).toBe(true);
    });

    it('LLM 返回的 type 不在白名单：忽略', async () => {
      const llm = makeLlm(
        JSON.stringify([
          { type: 'invalid_type', value: 'foo', span: [0, 3], confidence: 0.9 },
          { type: 'person', value: '张三', span: [0, 2], confidence: 0.9 },
        ]),
      );
      const svc = new EntityExtractorService(llm as never, undefined, logger as never);
      const result = await svc.extract('张三');

      const invalid = result.entities.filter((e) => e.value === 'foo');
      expect(invalid.length).toBe(0);
    });
  });

  describe('L4 上下文消解层', () => {
    it('代词"他" → 上一轮 person 实体（source=coref）', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const lastTurnEntities: Entity[] = [
        {
          type: 'person',
          value: '张三',
          span: [0, 2],
          confidence: 0.9,
          source: 'llm',
        },
      ];
      const result = await svc.extract('他是原告', {
        sessionId: 's1',
        userId: 'u1',
        msgId: 'm1',
        lastTurnEntities,
      });

      const coref = result.entities.find((e) => e.source === 'coref');
      expect(coref).toBeDefined();
      expect(coref?.value).toBe('张三');
      expect(coref?.type).toBe('person');
    });

    it('无 lastTurnEntities 时不进行消解', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const result = await svc.extract('他是原告');

      const coref = result.entities.filter((e) => e.source === 'coref');
      expect(coref.length).toBe(0);
    });
  });

  describe('去重', () => {
    it('同 type+value+span 保留 source 优先级高的（llm > dict > regex）', async () => {
      const llm = makeLlm(
        JSON.stringify([{ type: 'person', value: '原告', span: [0, 2], confidence: 0.95 }]),
      );
      const svc = new EntityExtractorService(llm as never, undefined, logger as never);
      const result = await svc.extract('原告起诉');

      // dict 与 llm 都抽取了"原告"，应只保留 llm（优先级更高）
      const plaintiffs = result.entities.filter((e) => e.value === '原告');
      expect(plaintiffs.length).toBe(1);
      expect(plaintiffs[0].source).toBe('llm');
    });
  });

  describe('持久化（@Optional Model）', () => {
    it('注入 Model 时异步写入 entity_extraction 集合', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const model = { updateOne } as never;
      const svc = new EntityExtractorService(undefined, model, logger as never);
      await svc.extract('原告起诉被告', {
        sessionId: 's1',
        userId: 'u1',
        msgId: 'msg-001',
      });

      // 等待异步持久化
      await new Promise((r) => setImmediate(r));
      expect(updateOne).toHaveBeenCalledTimes(1);
      const call = updateOne.mock.calls[0];
      expect(call[0]).toEqual({ msgId: 'msg-001' });
      expect(call[1].$set.userId).toBe('u1');
      expect(call[1].$set.entities.length).toBeGreaterThan(0);
      expect(call[2]).toEqual({ upsert: true });
    });

    it('updateOne 抛异常：不影响主流程', async () => {
      const updateOne = vi.fn().mockRejectedValue(new Error('DB 不可用'));
      const model = { updateOne } as never;
      const svc = new EntityExtractorService(undefined, model, logger as never);
      const result = await svc.extract('原告起诉被告', {
        userId: 'u1',
        msgId: 'msg-002',
      });

      await new Promise((r) => setImmediate(r));
      expect(result.entities.length).toBeGreaterThan(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('EntityExtraction 持久化失败'),
        expect.anything(),
      );
    });

    it('loadLastTurn 按 userId 查最近一条记录', async () => {
      const lean = () => ({
        exec: () =>
          Promise.resolve({
            msgId: 'm-old',
            userId: 'u1',
            entities: [
              { type: 'person', value: '张三', span: [0, 2], confidence: 0.9, source: 'llm' },
            ],
            extractedAt: new Date(),
          }),
      });
      const findOne = vi.fn().mockReturnValue({ lean, sort: () => ({ lean }) });
      // sort + lean + exec 链式
      const model = {
        findOne: vi.fn().mockReturnValue({
          sort: () => ({ lean }),
        }),
      } as never;
      const svc = new EntityExtractorService(undefined, model, logger as never);
      const entities = await svc.loadLastTurn('u1');

      expect(entities.length).toBe(1);
      expect(entities[0].value).toBe('张三');
      expect(findOne).not.toHaveBeenCalled(); // 用的是 model.findOne
    });

    it('loadLastTurn 无 Model 时返回空数组', async () => {
      const svc = new EntityExtractorService(undefined, undefined, logger as never);
      const entities = await svc.loadLastTurn('u1');
      expect(entities).toEqual([]);
    });
  });
});
