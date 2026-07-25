/**
 * DocumentGeneratorService 单元测试（A3-W2）。
 *
 * 覆盖（A3 §4.4 + §十 验收）：
 *   - 4 模板各跑一次：变量填充正确
 *   - 模板不存在抛 NotFoundException(2001)
 *   - 必填缺失抛 BadRequestException(3001)
 *   - 渲染失败抛 BadRequestException(3002)
 *   - 免责声明尾部注入
 *   - 法条引用提取
 *   - RAG 检索增强（可选，best-effort）
 *   - generateAsync 返回 jobId
 *   - listTemplates / getTemplate / validateVars / render
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  DocumentGeneratorService,
  type DocumentGenerateDto,
} from '../../src/modules/legal/document/document-generator.service';
import { DISCLAIMER_TEXT } from '../../src/modules/legal/chat/sse-frames';

/** 构造合法 vars（覆盖全部 4 模板所需字段） */
function makeParty(name: string) {
  return { name, id_no: '360101199001011234', address: '南昌市东湖区', phone: '13800138000' };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn(async () => undefined) };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRag(results: { title: string; content: string }[] = []) {
  return {
    retrieve: vi.fn(async () =>
      results.map((r, i) => ({
        id: `r${i}`,
        collection: 'law_article',
        title: r.title,
        content: r.content,
        pathScore: 1,
        rrfScore: 0.5,
        paths: ['bm25' as const],
      })),
    ),
  };
}

describe('DocumentGeneratorService', () => {
  let svc: DocumentGeneratorService;

  beforeEach(() => {
    svc = new DocumentGeneratorService(undefined, makeAudit(), makeLogger());
  });

  describe('listTemplates / getTemplate', () => {
    it('listTemplates 返回 4 个 active 模板', () => {
      const list = svc.listTemplates();
      expect(list).toHaveLength(4);
      expect(list.every((t) => t.status === 'active')).toBe(true);
      expect(list.map((t) => t.code).sort()).toEqual([
        'civil_complaint_v1',
        'civil_defense_v1',
        'lawyer_letter_v1',
        'standard_contract_v1',
      ]);
    });

    it('getTemplate 命中已知编码', () => {
      const t = svc.getTemplate('civil_complaint_v1');
      expect(t.type).toBe('civil_complaint');
    });

    it('getTemplate 未知编码抛 NotFoundException(2001)', () => {
      try {
        svc.getTemplate('no_such_template');
        throw new Error('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        const resp = (e as NotFoundException).getResponse() as { code: number };
        expect(resp.code).toBe(2001);
      }
    });
  });

  describe('4 模板渲染', () => {
    it('民事起诉状：变量填充正确', async () => {
      const dto: DocumentGenerateDto = {
        templateCode: 'civil_complaint_v1',
        vars: {
          court_name: '南昌市东湖区人民法院',
          plaintiff: makeParty('张三'),
          defendant: makeParty('李四'),
          claims: ['判令被告偿还借款 10 万元', '判令被告承担诉讼费用'],
          facts: '2025 年 1 月，被告向原告借款 10 万元，约定 2025 年 6 月归还，到期未还。',
          sign_date: '2026-07-25',
        },
      };
      const result = await svc.generate(dto);
      expect(result.renderedText).toContain('南昌市东湖区人民法院');
      expect(result.renderedText).toContain('原告：张三');
      expect(result.renderedText).toContain('被告：李四');
      expect(result.renderedText).toContain('判令被告偿还借款 10 万元');
      expect(result.renderedText).toContain('判令被告承担诉讼费用');
      expect(result.renderedText).toContain('到期未还');
    });

    it('标准合同：变量填充正确', async () => {
      const dto: DocumentGenerateDto = {
        templateCode: 'standard_contract_v1',
        vars: {
          party_a: makeParty('甲方公司'),
          party_b: makeParty('乙方公司'),
          contract_subject: '设备采购',
          terms: ['甲方应在 30 日内交付设备', '乙方应在收货后 7 日内付款'],
          sign_date: '2026-07-25',
        },
      };
      const result = await svc.generate(dto);
      expect(result.renderedText).toContain('甲方：甲方公司');
      expect(result.renderedText).toContain('设备采购');
      expect(result.renderedText).toContain('甲方应在 30 日内交付设备');
    });

    it('律师函：变量填充正确', async () => {
      const dto: DocumentGenerateDto = {
        templateCode: 'lawyer_letter_v1',
        vars: {
          sender_firm: '江西某某律师事务所',
          recipient: '王五',
          matter: '房屋租赁合同纠纷',
          demands: ['立即腾退房屋', '支付拖欠租金'],
          deadline: '2026-08-25',
          sign_date: '2026-07-25',
        },
      };
      const result = await svc.generate(dto);
      expect(result.renderedText).toContain('江西某某律师事务所');
      expect(result.renderedText).toContain('王五：');
      expect(result.renderedText).toContain('房屋租赁合同纠纷');
      expect(result.renderedText).toContain('立即腾退房屋');
      expect(result.renderedText).toContain('2026-08-25');
    });

    it('民事答辩状：变量填充正确', async () => {
      const dto: DocumentGenerateDto = {
        templateCode: 'civil_defense_v1',
        vars: {
          defendant_info: makeParty('赵六'),
          case_no: '(2026)赣0102民初123号',
          defense_points: ['原告诉讼请求已过诉讼时效', '原告主张的金额缺乏证据支持'],
          court_name: '南昌市东湖区人民法院',
          sign_date: '2026-07-25',
        },
      };
      const result = await svc.generate(dto);
      expect(result.renderedText).toContain('答辩人：赵六');
      expect(result.renderedText).toContain('(2026)赣0102民初123号');
      expect(result.renderedText).toContain('原告诉讼请求已过诉讼时效');
    });
  });

  describe('免责声明与法条提取', () => {
    it('结果尾部含 DISCLAIMER_TEXT', async () => {
      const result = await svc.generate({
        templateCode: 'civil_complaint_v1',
        vars: {
          court_name: '法院',
          plaintiff: makeParty('张三'),
          defendant: makeParty('李四'),
          claims: ['请求一'],
          facts: '事实',
          sign_date: '2026-07-25',
        },
      });
      expect(result.renderedText.endsWith(DISCLAIMER_TEXT)).toBe(true);
      expect(result.disclaimer).toBe(DISCLAIMER_TEXT);
    });

    it('从渲染文本提取法条引用', async () => {
      const result = await svc.generate({
        templateCode: 'standard_contract_v1',
        vars: {
          party_a: makeParty('甲'),
          party_b: makeParty('乙'),
          contract_subject: '依据《民法典》第四百六十四条之规定订立',
          terms: ['条款一'],
          sign_date: '2026-07-25',
        },
      });
      expect(result.lawRefs.length).toBeGreaterThan(0);
      expect(result.lawRefs.some((r) => r.ref.includes('民法典第四百六十四条'))).toBe(true);
    });
  });

  describe('校验与错误', () => {
    it('必填缺失抛 BadRequestException(3001) + errors', async () => {
      try {
        await svc.generate({
          templateCode: 'civil_complaint_v1',
          vars: { court_name: '法院' }, // 缺 plaintiff/defendant/claims/facts
        });
        throw new Error('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        const resp = (e as BadRequestException).getResponse() as {
          code: number;
          errors: unknown[];
        };
        expect(resp.code).toBe(3001);
        expect(Array.isArray(resp.errors)).toBe(true);
        expect(resp.errors.length).toBeGreaterThan(0);
      }
    });

    it('模板不存在抛 NotFoundException(2001)', async () => {
      await expect(svc.generate({ templateCode: 'no_such', vars: {} })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('validateVars 返回校验结果（不抛错）', () => {
      const ok = svc.validateVars('civil_complaint_v1', {
        court_name: '法院',
        plaintiff: makeParty('张三'),
        defendant: makeParty('李四'),
        claims: ['请求一'],
        facts: '事实',
        sign_date: '2026-07-25',
      });
      expect(ok.valid).toBe(true);

      const bad = svc.validateVars('civil_complaint_v1', {});
      expect(bad.valid).toBe(false);
      expect(bad.issues.some((i) => i.code === 'required')).toBe(true);
    });

    it('render 直接渲染（不校验/不注入免责）', () => {
      const text = svc.render('lawyer_letter_v1', {
        sender_firm: 'X律所',
        recipient: 'Y',
        matter: 'M',
        demands: ['D1'],
        deadline: '2026-08-25',
        sign_date: '2026-07-25',
      });
      expect(text).toContain('X律所');
      expect(text).not.toContain(DISCLAIMER_TEXT); // render 不注入免责
    });
  });

  describe('RAG 增强（可选）', () => {
    it('enableRag=true 时调用 rag.retrieve 并填充 retrievedLawContext', async () => {
      const rag = makeRag([
        { title: '民法典第一百四十三条', content: '具备下列条件的民事法律行为有效...' },
      ]);
      const svcWithRag = new DocumentGeneratorService(rag, makeAudit(), makeLogger());
      const result = await svcWithRag.generate({
        templateCode: 'civil_complaint_v1',
        vars: {
          court_name: '法院',
          plaintiff: makeParty('张三'),
          defendant: makeParty('李四'),
          claims: ['请求一'],
          facts: '借款纠纷',
          sign_date: '2026-07-25',
        },
        enableRag: true,
      });
      expect(rag.retrieve).toHaveBeenCalled();
      expect(result.retrievedLawContext).toContain('民法典第一百四十三条');
    });

    it('enableRag 默认 false 不调用 rag', async () => {
      const rag = makeRag();
      const svcWithRag = new DocumentGeneratorService(rag, makeAudit(), makeLogger());
      await svcWithRag.generate({
        templateCode: 'civil_complaint_v1',
        vars: {
          court_name: '法院',
          plaintiff: makeParty('张三'),
          defendant: makeParty('李四'),
          claims: ['请求一'],
          facts: '事实',
          sign_date: '2026-07-25',
        },
      });
      expect(rag.retrieve).not.toHaveBeenCalled();
    });

    it('RAG 失败不阻塞文书生成', async () => {
      const rag = makeRag();
      rag.retrieve.mockRejectedValueOnce(new Error('rag down'));
      const svcWithRag = new DocumentGeneratorService(rag, makeAudit(), makeLogger());
      const result = await svcWithRag.generate({
        templateCode: 'civil_complaint_v1',
        vars: {
          court_name: '法院',
          plaintiff: makeParty('张三'),
          defendant: makeParty('李四'),
          claims: ['请求一'],
          facts: '事实',
          sign_date: '2026-07-25',
        },
        enableRag: true,
      });
      expect(result.renderedText).toContain('原告：张三');
      expect(result.retrievedLawContext).toBeUndefined();
    });
  });

  describe('generateAsync', () => {
    it('返回 jobId + pending 状态', async () => {
      const result = await svc.generateAsync({ templateCode: 'civil_complaint_v1', vars: {} });
      expect(result.jobId).toBeTruthy();
      expect(result.status).toBe('pending');
    });
  });
});
