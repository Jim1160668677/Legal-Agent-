/**
 * 8 工具关键路径集成测试（v2.3-W1，14-tool-design.md §四-§十一）。
 *
 * 覆盖：
 *   1. LawValidityTool：articleRef 解析 + 精确查 + 模糊查 + 未命中 found=false
 *   2. PeriodCalculatorTool：日/月/年单位 + 法定期间节假日扣除 + 指定期间不扣
 *   3. CompensationQueryTool：完整 6 项赔偿 + 地区回退全国 + 无伤残等级
 *   4. CauseClassifierTool：BM25 召回 + Top-3 + 置信度过低抛 8006
 *   5. SentencingGuideTool：档次定位 + 情节调节 + clamp + 必填要素缺失抛 8007
 *   6. ClauseRecommenderTool：BM25 召回 Top-5 + applicable 判定 + 无匹配抛 8009
 *   7. LicenseOcrTool：OcrService 缺失抛 8004 + 类型自动判定
 *   8. DocumentReviewerTool：必填项缺失 + 法条引用 + 格式问题 + summary
 *
 * 设计依据：14-tool-design.md 各工具 §x.4 核心算法；§x.7 评测集与指标。
 */
import { describe, it, expect, vi } from 'vitest';
import { LawValidityTool } from '../../src/services/legal/tools/law-validity.tool';
import { PeriodCalculatorTool } from '../../src/services/legal/tools/period-calculator.tool';
import { CompensationQueryTool } from '../../src/services/legal/tools/compensation-query.tool';
import { CauseClassifierTool } from '../../src/services/legal/tools/cause-classifier.tool';
import { SentencingGuideTool } from '../../src/services/legal/tools/sentencing-guide.tool';
import { ClauseRecommenderTool } from '../../src/services/legal/tools/clause-recommender.tool';
import { LicenseOcrTool } from '../../src/services/legal/tools/license-ocr.tool';
import { DocumentReviewerTool } from '../../src/services/legal/tools/document-reviewer.tool';
import { TOOL_ERROR_CODES, type ToolContext } from '../../src/services/legal/tools/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'user-test',
    traceId: 'trace-tools-001',
    requestId: 'req-001',
    ...overrides,
  };
}

describe('v2.3-W1 8 工具关键路径集成测试', () => {
  describe('1. LawValidityTool（法条效力查询）', () => {
    const tool = new LawValidityTool();

    it('articleRef 解析 + 精确查（民法典第143条）', async () => {
      const result = await tool.invoke({ articleRef: '民法典第143条' }, makeCtx());
      expect(result.success).toBe(true);
      expect(result.data?.found).toBe(true);
      expect(result.data?.lawName).toBe('民法典');
      expect(result.data?.articleNo).toBe('第一百四十三条');
      expect(result.data?.status).toBe('effective');
      expect(result.data?.statusBadge).toBe('effective_green');
      expect(result.lawRefs).toHaveLength(1);
    });

    it('lawName + articleNo（数字格式）', async () => {
      const result = await tool.invoke({ lawName: '民法典', articleNo: '143' }, makeCtx());
      expect(result.data?.found).toBe(true);
    });

    it('未命中返回 found=false（不抛 8005）', async () => {
      const result = await tool.invoke({ lawName: '不存在的法律', articleNo: '9999' }, makeCtx());
      expect(result.success).toBe(true);
      expect(result.data?.found).toBe(false);
    });

    it('articleRef 格式非法抛 8001', async () => {
      await expect(tool.invoke({ articleRef: '乱七八糟' }, makeCtx())).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.INVALID_INPUT,
      });
    });

    it('元数据：toolId / category / piiLevel / cacheable', () => {
      expect(tool.toolId).toBe('law_validity');
      expect(tool.category).toBe('general');
      expect(tool.piiLevel).toBe('L1');
      expect(tool.cacheable).toBe(true);
      expect(tool.cacheTtl).toBe(7 * 24 * 3_600);
    });
  });

  describe('2. PeriodCalculatorTool（期间计算器）', () => {
    const tool = new PeriodCalculatorTool();

    it('指定期间 + 日单位（不扣节假日）', async () => {
      const result = await tool.invoke(
        {
          startDate: '2026-07-01',
          periodType: 'designated',
          duration: 15,
          unit: 'day',
        },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.deadline).toBe('2026-07-16');
      expect(result.data?.actualDays).toBe(15);
      expect(result.data?.holidayDeductions).toHaveLength(0);
    });

    it('法定期间 + 日单位（扣周末）', async () => {
      // 2026-07-01 是周三，+ 15 法定日（扣周末）
      const result = await tool.invoke(
        {
          startDate: '2026-07-01',
          periodType: 'statutory',
          duration: 15,
          unit: 'day',
          deductHolidays: true,
        },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      // 15 法定日扣除周末后应大于 15 自然日
      expect(result.data?.actualDays).toBeGreaterThan(15);
      expect(result.data?.holidayDeductions!.length).toBeGreaterThan(0);
    });

    it('月单位（保留日）', async () => {
      const result = await tool.invoke(
        {
          startDate: '2026-01-15',
          periodType: 'designated',
          duration: 1,
          unit: 'month',
        },
        makeCtx(),
      );
      expect(result.data?.deadline).toBe('2026-02-15');
    });

    it('年单位（处理闰年）', async () => {
      // 2024-02-29（闰年）+ 1 年 → 2025-02-28
      const result = await tool.invoke(
        {
          startDate: '2024-02-29',
          periodType: 'designated',
          duration: 1,
          unit: 'year',
        },
        makeCtx(),
      );
      expect(result.data?.deadline).toBe('2025-02-28');
    });

    it('startDate 格式非法抛 8001', async () => {
      await expect(
        tool.invoke(
          { startDate: 'not-a-date', periodType: 'statutory', duration: 10, unit: 'day' },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.INVALID_INPUT });
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('period_calculator');
      expect(tool.category).toBe('procedural');
      expect(tool.piiLevel).toBe('L1');
    });
  });

  describe('3. CompensationQueryTool（赔偿标准查询）', () => {
    const tool = new CompensationQueryTool();

    it('完整 6 项赔偿（北京 + 伤残 8 级 + 收入 + 被扶养人 + 医疗费）', async () => {
      const result = await tool.invoke(
        {
          causeOfAction: '机动车交通事故责任纠纷',
          region: '北京',
          disabilityLevel: 8,
          income: { monthlySalary: 10000, annualBonus: 30000 },
          dependents: 1,
          medicalFee: 50000,
        },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThanOrEqual(5);
      expect(result.data?.totalAmount).toBeGreaterThan(0);
      // 应包含：医疗费/误工费/护理费/残疾赔偿金/被扶养人生活费/精神损害抚慰金
      const names = result.data?.items.map((i: { name: string }) => i.name);
      expect(names).toContain('医疗费');
      expect(names).toContain('误工费');
      expect(names).toContain('护理费');
      expect(names).toContain('残疾赔偿金');
      expect(names).toContain('被扶养人生活费');
      expect(names).toContain('精神损害抚慰金');
      expect(result.data?.calculationTrace).toContain('北京');
    });

    it('地区未覆盖 → 回退全国均值 + warnings', async () => {
      const result = await tool.invoke(
        { causeOfAction: '人身损害', region: '未知省份' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.[0]).toContain('全国均值');
      // 仅护理费（无伤残等级、无收入、无被扶养人、无医疗费）
      expect(result.data?.items.length).toBe(1);
      expect(result.data?.items[0].name).toBe('护理费');
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('compensation_query');
      expect(tool.category).toBe('civil');
      expect(tool.piiLevel).toBe('L2');
    });
  });

  describe('4. CauseClassifierTool（案由分类）', () => {
    const tool = new CauseClassifierTool();

    it('BM25 召回 Top-3（离婚纠纷）', async () => {
      const result = await tool.invoke(
        { caseDescription: '我与丈夫感情不和分居两年，想离婚，孩子抚养权归我' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.topCandidates.length).toBeLessThanOrEqual(3);
      expect(result.data?.topCandidates.length).toBeGreaterThanOrEqual(1);
      expect(result.data?.topCandidates[0].causeName).toContain('离婚');
      expect(result.data?.topCandidates[0].confidence).toBeGreaterThan(0);
    });

    it('交通事故类案由', async () => {
      const result = await tool.invoke(
        { caseDescription: '我开车撞了人，对方受伤住院，赔偿问题谈不拢' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      // 应在 Top-3 中包含交通事故或故意伤害
      const names = result.data?.topCandidates.map((c: { causeName: string }) => c.causeName);
      expect(names?.some((n: string) => n.includes('交通') || n.includes('伤害'))).toBe(true);
    });

    it('无匹配文本抛 8006', async () => {
      await expect(
        tool.invoke({ caseDescription: 'zzzqqqxxx-no-match' }, makeCtx()),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.LOW_CONFIDENCE });
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('cause_classification');
      expect(tool.piiLevel).toBe('L2');
      expect(tool.cacheable).toBe(false);
    });
  });

  describe('5. SentencingGuideTool（量刑指导）', () => {
    const tool = new SentencingGuideTool();

    it('盗窃罪 + 数额巨大 + 自首 → 量刑幅度 + 调节', async () => {
      const result = await tool.invoke(
        {
          charge: '盗窃罪',
          elements: { amount: 10000, surrender: true },
        },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.sentencingRange.min).toBe(36);
      expect(result.data?.sentencingRange.max).toBe(120);
      expect(result.data?.baseSentence).toBe(78); // (36+120)/2
      expect(result.data?.adjustments).toHaveLength(1);
      expect(result.data?.adjustments[0].factor).toBe('surrender');
      expect(result.data?.adjustments[0].percentage).toBe(-25);
      expect(result.data?.finalSentence).toBeLessThanOrEqual(120);
      expect(result.data?.finalSentence).toBeGreaterThanOrEqual(36);
    });

    it('必填要素缺失抛 8007', async () => {
      await expect(
        tool.invoke({ charge: '盗窃罪', elements: {} }, makeCtx()),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS });
    });

    it('罪名未覆盖抛 8007', async () => {
      await expect(
        tool.invoke({ charge: '不存在的罪名', elements: { amount: 1000 } }, makeCtx()),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS });
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('sentencing_guide');
      expect(tool.category).toBe('criminal');
      expect(tool.piiLevel).toBe('L2');
    });
  });

  describe('6. ClauseRecommenderTool（条款推荐）', () => {
    const tool = new ClauseRecommenderTool();

    it('房屋租赁合同 + filledVars → 推荐 Top-5', async () => {
      const result = await tool.invoke(
        {
          docType: '房屋租赁合同',
          filledVars: { rentAmount: 5000, depositAmount: 10000 },
        },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.recommendedClauses.length).toBeLessThanOrEqual(5);
      expect(result.data?.recommendedClauses.length).toBeGreaterThan(0);
      expect(result.data?.recommendedClauses[0].clauseId).toMatch(/^CL-LR-/);
    });

    it('applicable 判定：filledVars 满足 applicableConditions', async () => {
      const result = await tool.invoke(
        {
          docType: '房屋租赁合同',
          filledVars: { rentAmount: 5000, paymentDay: 5 },
        },
        makeCtx(),
      );
      const rentClause = result.data?.recommendedClauses.find(
        (c: { clauseId: string }) => c.clauseId === 'CL-LR-001',
      );
      expect(rentClause?.applicable).toBe(true);
    });

    it('无 filledVars → warnings + 默认顺序', async () => {
      const result = await tool.invoke({ docType: '房屋租赁合同' }, makeCtx());
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
    });

    it('docType 无匹配抛 8009', async () => {
      await expect(tool.invoke({ docType: '不存在的合同类型' }, makeCtx())).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.NO_CLAUSE_MATCH,
      });
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('clause_recommender');
      expect(tool.piiLevel).toBe('L1');
      expect(tool.cacheable).toBe(true);
    });
  });

  describe('7. LicenseOcrTool（证照 OCR 骨架）', () => {
    const tool = new LicenseOcrTool();

    it('OcrService 未注入抛 8004', async () => {
      await expect(tool.invoke({ fileId: 'file-001' }, makeCtx())).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.RECOGNIZE_FAILED,
      });
    });

    it('OcrService 注入 + 类型自动判定（营业执照）', async () => {
      const ocrService = {
        recognize: vi.fn().mockResolvedValue({
          text: '营业执照\n统一社会信用代码：91110000MA01ABC23X\n名称：测试有限公司\n法定代表人：张三\n注册资本：100万元',
          confidence: 0.95,
        }),
      };
      const result = await tool.invoke({ fileId: 'file-001' }, makeCtx({ ocrService }));
      expect(result.success).toBe(true);
      expect(result.data?.licenseType).toBe('business_license');
      expect(result.data?.fields.unifiedSocialCreditCode).toBe('91110000MA01ABC23X');
      expect(result.data?.fields.enterpriseName).toBe('测试有限公司');
      expect(result.data?.confidence).toBe(0.95);
    });

    it('身份证 + 校验位算法', async () => {
      // 校验位正确：前 17 位 11010119900307723 → sum=222 → 222%11=2 → checkCodes[2]='X'
      const ocrService = {
        recognize: vi.fn().mockResolvedValue({
          text: '中华人民共和国居民身份证\n姓名：李四\n性别：男\n民族：汉\n身份证号：11010119900307723X',
          confidence: 0.92,
        }),
      };
      const result = await tool.invoke({ fileId: 'file-002' }, makeCtx({ ocrService }));
      expect(result.data?.licenseType).toBe('id_card');
      expect(result.data?.fields.idNumber).toBe('11010119900307723X');
      expect(result.data?.validation.checksumValid).toBe(true);
    });

    it('raw_text 受 featureFlag 控制', async () => {
      const ocrService = {
        recognize: vi.fn().mockResolvedValue({ text: 'test', confidence: 0.9 }),
      };
      // 默认不返回（显式指定 licenseType 避免 auto 识别失败）
      const r1 = await tool.invoke(
        { fileId: 'f1', licenseType: 'business_license' },
        makeCtx({ ocrService }),
      );
      expect(r1.data?.rawOcrText).toBeUndefined();
      // featureFlag 开启
      const r2 = await tool.invoke(
        { fileId: 'f1', licenseType: 'business_license' },
        makeCtx({ ocrService, featureFlags: { 'tool.license_ocr.raw_text': true } }),
      );
      expect(r2.data?.rawOcrText).toBe('test');
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('license_ocr');
      expect(tool.piiLevel).toBe('L3');
      expect(tool.timeout).toBe(10_000);
    });
  });

  describe('8. DocumentReviewerTool（文书审核）', () => {
    const tool = new DocumentReviewerTool();

    it('必填项缺失检出（起诉状缺被告/诉讼请求/事实和理由）', async () => {
      const text = '民事起诉状\n原告：张三\n此致\nXX人民法院\n2026年01月01日';
      const result = await tool.invoke({ documentText: text, docType: '起诉状' }, makeCtx());
      expect(result.success).toBe(true);
      const missing = result.data?.issues.filter(
        (i: { type: string }) => i.type === 'missing_required',
      );
      expect(missing.length).toBeGreaterThan(0);
      const missingLabels = missing.map((i: { message: string }) => i.message);
      expect(missingLabels.some((m: string) => m.includes('被告'))).toBe(true);
    });

    it('合规起诉状（基本要素齐全）', async () => {
      const text = [
        '民事起诉状',
        '原告：张三，男，身份证号：110101199001011234，住址：北京市朝阳区',
        '被告：李四，男，身份证号：110101199002021235，住址：北京市海淀区',
        '诉讼请求：1. 请求被告偿还借款 10000 元；2. 诉讼费由被告承担。',
        '事实和理由：2025年1月1日，被告向原告借款 10000 元，约定 2025年6月1日还款，但到期未还。',
        '此致',
        '北京市朝阳区人民法院',
        '起诉人：张三（签名）',
        '2026年01月01日',
      ].join('\n');
      const result = await tool.invoke({ documentText: text, docType: '起诉状' }, makeCtx());
      expect(result.success).toBe(true);
      const errors = result.data?.issues.filter(
        (i: { severity: string }) => i.severity === 'error',
      );
      expect(errors.length).toBe(0);
      expect(result.data?.summary.errorCount).toBe(0);
    });

    it('文书超长抛 8001', async () => {
      const longText = 'x'.repeat(50001);
      await expect(
        tool.invoke({ documentText: longText, docType: '其他' }, makeCtx()),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.INVALID_INPUT });
    });

    it('元数据', () => {
      expect(tool.toolId).toBe('document_review');
      expect(tool.piiLevel).toBe('L3');
      expect(tool.timeout).toBe(8_000);
    });
  });
});
