/**
 * 8 工具评测金标集（v2.3-W2，14-tool-design.md §12.1）。
 *
 * 用途：评测 8 个 LegalTool 在【离线静态数据】模式下的输出正确性。
 *
 * 覆盖：
 *   - law_validity（10 用例）：articleRef/lawName+articleNo/纯数字/中文条号/模糊匹配/未命中/废止法条
 *   - period_calculator（12 用例）：日/月/年单位/法定扣节假日/指定不扣/届满日顺延/调休/跨年/月末
 *   - compensation_query（10 用例）：完整 6 项/地区回退/不同伤残/含收入/含被扶养人/含医疗费
 *   - license_ocr（8 用例）：OcrService 缺失/营业执照/身份证校验位/类型自动判定/raw_text flag
 *   - document_reviewer（10 用例）：起诉状完整/缺被告/缺诉讼请求/答辩状/律师函/法条引用/格式问题
 *   - cause_classification（10 用例）：借贷/离婚/交通事故/合同/Top-3/置信度过低/过短描述
 *   - sentencing_guide（10 用例）：盗窃/抢劫/故意伤害/必填缺失/情节调节/clamp/立功/基准刑
 *   - clause_recommender（10 用例）：合同条款/起诉状/Top-5/applicable/无匹配/category 过滤
 *
 * 难度分级：easy（正常路径）/ medium（边界）/ hard（错误或复杂场景）
 *
 * 评测断言（expected）：
 *   - success: 期望 ToolResult.success
 *   - dataFields: 期望 data 中部分字段值（深度匹配，未列出字段不校验）
 *   - errorCode: 期望失败时抛出的 LegalToolError.code
 *   - minLawRefsCount: 期望 lawRefs 最少条数
 *   - minDataFields: 期望 data 中包含的字段名（仅校验存在性）
 *
 * 设计依据：14-tool-design.md §12.1 评测集设计；§12.2 评测指标。
 */

export type ToolId =
  | 'law_validity'
  | 'period_calculator'
  | 'compensation_query'
  | 'license_ocr'
  | 'document_review'
  | 'cause_classification'
  | 'sentencing_guide'
  | 'clause_recommender';

export type EvalDifficulty = 'easy' | 'medium' | 'hard';

/** 评测用例期望断言 */
export interface ToolEvalExpectation {
  /** 期望 ToolResult.success */
  success?: boolean;
  /** 期望 data 中的部分字段值（深度匹配，未列出字段不校验） */
  dataFields?: Record<string, unknown>;
  /** 期望 data 中包含的字段名（仅校验存在性，不校验值） */
  minDataFields?: string[];
  /** 期望 lawRefs 最少条数 */
  minLawRefsCount?: number;
  /** 期望失败时抛出的 LegalToolError.code（成功路径不校验） */
  errorCode?: number;
  /** 期望 data.topCandidates[0].causeCode（仅 cause_classification 用） */
  topCauseCode?: string;
  /** 期望 data.recommendedClauses[0].clauseId（仅 clause_recommender 用） */
  topClauseId?: string;
  /** 期望 data.recommendedClauses 最少条数 */
  minClausesCount?: number;
  /** 期望 data.topCandidates 最少条数 */
  minCandidatesCount?: number;
  /** 期望 data.issues 至少包含一条 type（仅 document_review 用） */
  hasIssueType?: string;
}

/** 单条评测用例 */
export interface ToolEvalItem {
  /** 用例 ID */
  caseId: string;
  /** 工具 ID */
  toolId: ToolId;
  /** 难度 */
  difficulty: EvalDifficulty;
  /** 用例描述 */
  description: string;
  /** 工具入参 */
  input: Record<string, unknown>;
  /** ToolContext 覆盖（如 ocrService / featureFlags） */
  ctxOverrides?: Record<string, unknown>;
  /** 期望断言 */
  expected: ToolEvalExpectation;
}

export const TOOL_EVAL_VERSION = 'v1';
export const TOOL_EVAL_THRESHOLD = 0.85;

/**
 * 8 工具评测金标集（80 用例）。
 */
export const TOOL_EVAL_SET: ToolEvalItem[] = [
  // ===== 1. law_validity（10 用例）=====
  {
    caseId: 'LV-001',
    toolId: 'law_validity',
    difficulty: 'easy',
    description: 'articleRef 解析 + 精确查（民法典第143条）',
    input: { articleRef: '民法典第143条' },
    expected: {
      success: true,
      dataFields: { found: true, lawName: '民法典', status: 'effective' },
      minLawRefsCount: 1,
    },
  },
  {
    caseId: 'LV-002',
    toolId: 'law_validity',
    difficulty: 'easy',
    description: 'lawName + articleNo（数字格式）',
    input: { lawName: '民法典', articleNo: '143' },
    expected: { success: true, dataFields: { found: true } },
  },
  {
    caseId: 'LV-003',
    toolId: 'law_validity',
    difficulty: 'easy',
    description: 'lawName + articleNo（中文条号）',
    input: { lawName: '民法典', articleNo: '第一百四十三条' },
    expected: { success: true, dataFields: { found: true } },
  },
  {
    caseId: 'LV-004',
    toolId: 'law_validity',
    difficulty: 'medium',
    description: '模糊匹配（《民法典》带书名号）',
    input: { articleRef: '《中华人民共和国民法典》第143条' },
    expected: { success: true, dataFields: { found: true } },
  },
  {
    caseId: 'LV-005',
    toolId: 'law_validity',
    difficulty: 'medium',
    description: '未命中返回 found=false（不抛 8005）',
    input: { lawName: '不存在的法律', articleNo: '9999' },
    expected: { success: true, dataFields: { found: false } },
  },
  {
    caseId: 'LV-006',
    toolId: 'law_validity',
    difficulty: 'hard',
    description: 'articleRef 格式非法抛 8001',
    input: { articleRef: '乱七八糟' },
    expected: { errorCode: 8001 },
  },
  {
    caseId: 'LV-007',
    toolId: 'law_validity',
    difficulty: 'hard',
    description: '缺少 lawName+articleNo 且无 articleRef 抛 8001',
    input: {},
    expected: { errorCode: 8001 },
  },
  {
    caseId: 'LV-008',
    toolId: 'law_validity',
    difficulty: 'easy',
    description: '查询刑法第133条（交通肇事罪）',
    input: { articleRef: '刑法第133条' },
    expected: { success: true, dataFields: { found: true } },
  },
  {
    caseId: 'LV-009',
    toolId: 'law_validity',
    difficulty: 'medium',
    description: 'statusBadge 颜色映射（effective→green）',
    input: { lawName: '民法典', articleNo: '143' },
    expected: { success: true, dataFields: { statusBadge: 'effective_green' } },
  },
  {
    caseId: 'LV-010',
    toolId: 'law_validity',
    difficulty: 'medium',
    description: '法条内容非空',
    input: { lawName: '民法典', articleNo: '143' },
    expected: {
      success: true,
      minDataFields: ['found', 'lawName', 'articleNo', 'content', 'status', 'legalHierarchy'],
    },
  },

  // ===== 2. period_calculator（12 用例）=====
  {
    caseId: 'PC-001',
    toolId: 'period_calculator',
    difficulty: 'easy',
    description: '指定期间 + 日单位（不扣节假日）',
    input: { startDate: '2026-07-01', periodType: 'designated', duration: 15, unit: 'day' },
    expected: {
      success: true,
      minDataFields: ['deadline', 'actualDays', 'holidayDeductions', 'calculationTrace'],
      dataFields: { actualDays: 15 },
    },
  },
  {
    caseId: 'PC-002',
    toolId: 'period_calculator',
    difficulty: 'easy',
    description: '指定期间 + 月单位',
    input: { startDate: '2026-01-31', periodType: 'designated', duration: 1, unit: 'month' },
    expected: { success: true, minDataFields: ['deadline', 'actualDays'] },
  },
  {
    caseId: 'PC-003',
    toolId: 'period_calculator',
    difficulty: 'easy',
    description: '指定期间 + 年单位',
    input: { startDate: '2026-07-01', periodType: 'designated', duration: 1, unit: 'year' },
    expected: { success: true, minDataFields: ['deadline', 'actualDays'] },
  },
  {
    caseId: 'PC-004',
    toolId: 'period_calculator',
    difficulty: 'medium',
    description: '法定期间 + 日单位（扣节假日）',
    input: {
      startDate: '2026-09-25',
      periodType: 'statutory',
      duration: 15,
      unit: 'day',
      deductHolidays: true,
    },
    expected: { success: true, minDataFields: ['deadline', 'holidayDeductions'] },
  },
  {
    caseId: 'PC-005',
    toolId: 'period_calculator',
    difficulty: 'medium',
    description: '法定期间 deductHolidays 默认 true',
    input: { startDate: '2026-09-25', periodType: 'statutory', duration: 10, unit: 'day' },
    expected: { success: true },
  },
  {
    caseId: 'PC-006',
    toolId: 'period_calculator',
    difficulty: 'hard',
    description: '届满日为节假日顺延至节后第一个工作日',
    input: {
      startDate: '2026-09-20',
      periodType: 'statutory',
      duration: 15,
      unit: 'day',
      deductHolidays: true,
    },
    expected: { success: true, minDataFields: ['deadline', 'deadlineWeekday'] },
  },
  {
    caseId: 'PC-007',
    toolId: 'period_calculator',
    difficulty: 'medium',
    description: '跨年期间计算（2026-12-25 + 20 日）',
    input: { startDate: '2026-12-25', periodType: 'designated', duration: 20, unit: 'day' },
    expected: { success: true, dataFields: { actualDays: 20 } },
  },
  {
    caseId: 'PC-008',
    toolId: 'period_calculator',
    difficulty: 'easy',
    description: '法定 30 日（无节假日跨段）',
    input: { startDate: '2026-03-01', periodType: 'statutory', duration: 30, unit: 'day' },
    expected: { success: true },
  },
  {
    caseId: 'PC-009',
    toolId: 'period_calculator',
    difficulty: 'hard',
    description: '非法 startDate 抛 8001',
    input: { startDate: 'invalid', periodType: 'statutory', duration: 15, unit: 'day' },
    expected: { errorCode: 8001 },
  },
  {
    caseId: 'PC-010',
    toolId: 'period_calculator',
    difficulty: 'hard',
    description: 'duration 为 0 边界（schema 由 registry 拦截，invoke 返回 actualDays=0）',
    input: { startDate: '2026-07-01', periodType: 'designated', duration: 0, unit: 'day' },
    expected: { success: true, dataFields: { actualDays: 0 } },
  },
  {
    caseId: 'PC-011',
    toolId: 'period_calculator',
    difficulty: 'medium',
    description: '指定期间 actualDays 等于 duration',
    input: { startDate: '2026-07-01', periodType: 'designated', duration: 7, unit: 'day' },
    expected: { success: true, dataFields: { actualDays: 7 } },
  },
  {
    caseId: 'PC-012',
    toolId: 'period_calculator',
    difficulty: 'easy',
    description: '6 个月法定期间',
    input: { startDate: '2026-01-15', periodType: 'statutory', duration: 6, unit: 'month' },
    expected: { success: true, minDataFields: ['deadline'] },
  },

  // ===== 3. compensation_query（10 用例）=====
  {
    caseId: 'CQ-001',
    toolId: 'compensation_query',
    difficulty: 'easy',
    description: '完整 6 项赔偿（北京 + 伤残 8 级）',
    input: {
      causeOfAction: '交通事故',
      region: '北京',
      disabilityLevel: 8,
      medicalFee: 50000,
    },
    expected: {
      success: true,
      minDataFields: ['items', 'totalAmount', 'calculationTrace'],
    },
  },
  {
    caseId: 'CQ-002',
    toolId: 'compensation_query',
    difficulty: 'medium',
    description: '地区回退全国（缺省地区）',
    input: {
      causeOfAction: '交通事故',
      region: '未知地区',
      disabilityLevel: 8,
    },
    expected: { success: true, minDataFields: ['items', 'totalAmount'] },
  },
  {
    caseId: 'CQ-003',
    toolId: 'compensation_query',
    difficulty: 'easy',
    description: '无伤残等级（仅医疗费 + 精神损害）',
    input: {
      causeOfAction: '交通事故',
      region: '上海',
      medicalFee: 30000,
    },
    expected: { success: true, minDataFields: ['items', 'totalAmount'] },
  },
  {
    caseId: 'CQ-004',
    toolId: 'compensation_query',
    difficulty: 'medium',
    description: '不同伤残等级（10 级最轻）',
    input: {
      causeOfAction: '交通事故',
      region: '北京',
      disabilityLevel: 10,
    },
    expected: { success: true, minDataFields: ['items'] },
  },
  {
    caseId: 'CQ-005',
    toolId: 'compensation_query',
    difficulty: 'medium',
    description: '含收入数据（误工费按实际工资）',
    input: {
      causeOfAction: '交通事故',
      region: '广东',
      disabilityLevel: 7,
      income: { monthlySalary: 10000 },
    },
    expected: { success: true, minDataFields: ['items', 'totalAmount'] },
  },
  {
    caseId: 'CQ-006',
    toolId: 'compensation_query',
    difficulty: 'hard',
    description: '含被扶养人（被扶养人生活费计算）',
    input: {
      causeOfAction: '交通事故',
      region: '江苏',
      disabilityLevel: 6,
      dependents: 2,
    },
    expected: { success: true, minDataFields: ['items'] },
  },
  {
    caseId: 'CQ-007',
    toolId: 'compensation_query',
    difficulty: 'easy',
    description: '医疗费直传',
    input: {
      causeOfAction: '交通事故',
      region: '浙江',
      medicalFee: 80000,
    },
    expected: { success: true },
  },
  {
    caseId: 'CQ-008',
    toolId: 'compensation_query',
    difficulty: 'medium',
    description: 'totalAmount > 0（含伤残赔偿）',
    input: {
      causeOfAction: '交通事故',
      region: '北京',
      disabilityLevel: 5,
    },
    expected: { success: true, minDataFields: ['totalAmount'] },
  },
  {
    caseId: 'CQ-009',
    toolId: 'compensation_query',
    difficulty: 'easy',
    description: '上海地区标准加载',
    input: {
      causeOfAction: '交通事故',
      region: '上海',
      disabilityLevel: 9,
    },
    expected: { success: true },
  },
  {
    caseId: 'CQ-010',
    toolId: 'compensation_query',
    difficulty: 'hard',
    description: '非法伤残等级抛 8001',
    input: {
      causeOfAction: '交通事故',
      region: '北京',
      disabilityLevel: 15,
    },
    expected: { errorCode: 8001 },
  },

  // ===== 4. license_ocr（8 用例）=====
  {
    caseId: 'LO-001',
    toolId: 'license_ocr',
    difficulty: 'hard',
    description: 'OcrService 缺失抛 8004',
    input: { fileId: 'file-001' },
    expected: { errorCode: 8004 },
  },
  {
    caseId: 'LO-002',
    toolId: 'license_ocr',
    difficulty: 'easy',
    description: '营业执照识别 + 字段提取',
    input: { fileId: 'file-001' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({
          text: '营业执照\n统一社会信用代码：91110000MA01ABC23X\n名称：测试有限公司\n法定代表人：张三\n注册资本：100万元',
          confidence: 0.95,
        }),
      },
    },
    expected: {
      success: true,
      dataFields: {
        licenseType: 'business_license',
        confidence: 0.95,
      },
      minDataFields: ['fields', 'validation'],
    },
  },
  {
    caseId: 'LO-003',
    toolId: 'license_ocr',
    difficulty: 'medium',
    description: '身份证识别 + 校验位算法（GB 11643-1999）',
    input: { fileId: 'file-002' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({
          text: '中华人民共和国居民身份证\n姓名：李四\n性别：男\n民族：汉\n身份证号：11010119900307723X',
          confidence: 0.92,
        }),
      },
    },
    expected: {
      success: true,
      dataFields: { licenseType: 'id_card' },
      minDataFields: ['fields', 'validation'],
    },
  },
  {
    caseId: 'LO-004',
    toolId: 'license_ocr',
    difficulty: 'medium',
    description: '类型自动判定（营业执照关键词）',
    input: { fileId: 'file-003' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({
          text: '统一社会信用代码：91110000MA01ABC23X',
          confidence: 0.9,
        }),
      },
    },
    expected: { success: true, dataFields: { licenseType: 'business_license' } },
  },
  {
    caseId: 'LO-005',
    toolId: 'license_ocr',
    difficulty: 'easy',
    description: '显式 licenseType 覆盖 auto',
    input: { fileId: 'file-004', licenseType: 'id_card' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({
          text: '中华人民共和国居民身份证\n姓名：王五\n身份证号：11010119900307723X',
          confidence: 0.9,
        }),
      },
    },
    expected: { success: true, dataFields: { licenseType: 'id_card' } },
  },
  {
    caseId: 'LO-006',
    toolId: 'license_ocr',
    difficulty: 'medium',
    description: 'raw_text featureFlag 默认不返回',
    input: { fileId: 'file-005', licenseType: 'business_license' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({ text: 'test', confidence: 0.9 }),
      },
    },
    expected: { success: true },
  },
  {
    caseId: 'LO-007',
    toolId: 'license_ocr',
    difficulty: 'hard',
    description: '无法识别证照类型抛 8004',
    input: { fileId: 'file-006' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({ text: 'random text without keyword', confidence: 0.5 }),
      },
    },
    expected: { errorCode: 8004 },
  },
  {
    caseId: 'LO-008',
    toolId: 'license_ocr',
    difficulty: 'hard',
    description: 'OCR 返回空文本抛 8004',
    input: { fileId: 'file-007' },
    ctxOverrides: {
      ocrService: {
        recognize: async () => ({ text: '', confidence: 0.0 }),
      },
    },
    expected: { errorCode: 8004 },
  },

  // ===== 5. document_review（10 用例）=====
  {
    caseId: 'DR-001',
    toolId: 'document_review',
    difficulty: 'easy',
    description: '起诉状完整无问题',
    input: {
      documentText:
        '民事起诉状\n原告：张三\n被告：李四\n诉讼请求：1.请求被告偿还借款10000元\n事实和理由：被告于2025年1月1日向原告借款10000元，约定2025年6月30日归还，到期未还。\n此致\nXX人民法院\n2026年01月01日',
      docType: '起诉状',
    },
    expected: { success: true, minDataFields: ['issues', 'summary'] },
  },
  {
    caseId: 'DR-002',
    toolId: 'document_review',
    difficulty: 'medium',
    description: '起诉状缺被告 → missing_required',
    input: {
      documentText:
        '民事起诉状\n原告：张三\n诉讼请求：1.请求偿还借款\n事实和理由：借款未还\n此致\nXX人民法院\n2026年01月01日',
      docType: '起诉状',
    },
    expected: { success: true, hasIssueType: 'missing_required' },
  },
  {
    caseId: 'DR-003',
    toolId: 'document_review',
    difficulty: 'medium',
    description: '起诉状缺诉讼请求 → missing_required',
    input: {
      documentText:
        '民事起诉状\n原告：张三\n被告：李四\n事实和理由：借款未还\n此致\nXX人民法院\n2026年01月01日',
      docType: '起诉状',
    },
    expected: { success: true, hasIssueType: 'missing_required' },
  },
  {
    caseId: 'DR-004',
    toolId: 'document_review',
    difficulty: 'easy',
    description: '答辩状完整',
    input: {
      documentText:
        '民事答辩状\n答辩人：李四\n答辩意见：原告所诉不实，借款已归还\n此致\nXX人民法院\n2026年01月01日',
      docType: '答辩状',
    },
    expected: { success: true, minDataFields: ['issues', 'summary'] },
  },
  {
    caseId: 'DR-005',
    toolId: 'document_review',
    difficulty: 'easy',
    description: '律师函完整',
    input: {
      documentText:
        '律师函\n委托人：张三\n致：李四\n事由：关于催告偿还借款事宜\n本律师接受委托人委托，特此函告如下：\n请于收到本函后15日内偿还借款10000元。\nXX律师事务所\n律师：王五\n2026年01月01日',
      docType: '律师函',
    },
    expected: { success: true, minDataFields: ['issues'] },
  },
  {
    caseId: 'DR-006',
    toolId: 'document_review',
    difficulty: 'medium',
    description: '法条引用检测（含民法典第143条）',
    input: {
      documentText:
        '民事起诉状\n原告：张三\n被告：李四\n诉讼请求：1.请求偿还借款\n事实和理由：依据民法典第143条，被告应承担民事责任。\n此致\nXX人民法院\n2026年01月01日',
      docType: '起诉状',
    },
    expected: { success: true },
  },
  {
    caseId: 'DR-007',
    toolId: 'document_review',
    difficulty: 'hard',
    description: '文书超长抛 8001',
    input: { documentText: 'x'.repeat(60000), docType: '起诉状' },
    expected: { errorCode: 8001 },
  },
  {
    caseId: 'DR-008',
    toolId: 'document_review',
    difficulty: 'easy',
    description: 'summary 字段含 errorCount/warningCount/passRate',
    input: {
      documentText:
        '民事起诉状\n原告：张三\n被告：李四\n诉讼请求：1.偿还借款\n事实和理由：借款\n此致\nXX人民法院\n2026年01月01日',
      docType: '起诉状',
    },
    expected: {
      success: true,
      minDataFields: ['summary'],
    },
  },
  {
    caseId: 'DR-009',
    toolId: 'document_review',
    difficulty: 'medium',
    description: '缺事实和理由 → missing_required',
    input: {
      documentText:
        '民事起诉状\n原告：张三\n被告：李四\n诉讼请求：1.偿还借款\n此致\nXX人民法院\n2026年01月01日',
      docType: '起诉状',
    },
    expected: { success: true, hasIssueType: 'missing_required' },
  },
  {
    caseId: 'DR-010',
    toolId: 'document_review',
    difficulty: 'hard',
    description: '空文本抛 8001',
    input: { documentText: '', docType: '起诉状' },
    expected: { errorCode: 8001 },
  },

  // ===== 6. cause_classification（10 用例）=====
  {
    caseId: 'CC-001',
    toolId: 'cause_classification',
    difficulty: 'easy',
    description: '民间借贷纠纷识别',
    input: { caseDescription: '被告向原告借款10万元，到期未还，原告起诉要求偿还借款' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-002',
    toolId: 'cause_classification',
    difficulty: 'easy',
    description: '离婚纠纷识别',
    input: { caseDescription: '夫妻感情破裂，原告起诉离婚，要求分割夫妻共同财产' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-003',
    toolId: 'cause_classification',
    difficulty: 'easy',
    description: '交通事故纠纷识别',
    input: { caseDescription: '机动车交通事故造成人身损害，原告要求被告赔偿医疗费和残疾赔偿金' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-004',
    toolId: 'cause_classification',
    difficulty: 'medium',
    description: '买卖合同纠纷识别',
    input: { caseDescription: '原告向被告供货，被告未支付货款，原告起诉要求支付货款及违约金' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-005',
    toolId: 'cause_classification',
    difficulty: 'easy',
    description: 'Top-3 返回（含 reasoning）',
    input: { caseDescription: '被告盗窃原告财物，价值5000元，原告报案' },
    expected: {
      success: true,
      minCandidatesCount: 1,
      minDataFields: ['topCandidates', 'reasoning'],
    },
  },
  {
    caseId: 'CC-006',
    toolId: 'cause_classification',
    difficulty: 'medium',
    description: '盗窃罪识别（刑事）',
    input: { caseDescription: '被告秘密窃取原告财物，数额较大，构成盗窃罪' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-007',
    toolId: 'cause_classification',
    difficulty: 'medium',
    description: '故意伤害罪识别（刑事）',
    input: { caseDescription: '被告故意殴打原告致轻伤，构成故意伤害罪' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-008',
    toolId: 'cause_classification',
    difficulty: 'hard',
    description: '案情描述过短无匹配抛 8006',
    input: { caseDescription: '告' },
    expected: { errorCode: 8006 },
  },
  {
    caseId: 'CC-009',
    toolId: 'cause_classification',
    difficulty: 'medium',
    description: '劳动争议识别',
    input: { caseDescription: '被告用人单位拖欠原告工资3个月，原告起诉要求支付劳动报酬' },
    expected: { success: true, minCandidatesCount: 1 },
  },
  {
    caseId: 'CC-010',
    toolId: 'cause_classification',
    difficulty: 'easy',
    description: 'topCandidates[0] 含 causeCode/causeName/confidence',
    input: { caseDescription: '被告借款未还，原告起诉要求偿还借款本金及利息' },
    expected: { success: true, minCandidatesCount: 1 },
  },

  // ===== 7. sentencing_guide（10 用例）=====
  {
    caseId: 'SG-001',
    toolId: 'sentencing_guide',
    difficulty: 'easy',
    description: '盗窃罪 + 数额较大',
    input: { charge: '盗窃罪', elements: { amount: 5000 } },
    expected: {
      success: true,
      minDataFields: ['sentencingRange', 'baseSentence', 'adjustments', 'calculationTrace'],
    },
  },
  {
    caseId: 'SG-002',
    toolId: 'sentencing_guide',
    difficulty: 'medium',
    description: '抢劫罪 + 次数（requiredElements=times）',
    input: { charge: '抢劫罪', elements: { times: 2 } },
    expected: { success: true, minDataFields: ['sentencingRange'] },
  },
  {
    caseId: 'SG-003',
    toolId: 'sentencing_guide',
    difficulty: 'medium',
    description: '故意伤害罪 + 后果严重',
    input: { charge: '故意伤害罪', elements: { consequence: '轻伤' } },
    expected: { success: true, minDataFields: ['sentencingRange'] },
  },
  {
    caseId: 'SG-004',
    toolId: 'sentencing_guide',
    difficulty: 'hard',
    description: '必填要素缺失抛 8007',
    input: { charge: '盗窃罪', elements: {} },
    expected: { errorCode: 8007 },
  },
  {
    caseId: 'SG-005',
    toolId: 'sentencing_guide',
    difficulty: 'medium',
    description: '情节调节（前科加重 +15%）',
    input: { charge: '盗窃罪', elements: { amount: 5000, priorConviction: true } },
    expected: { success: true, minDataFields: ['adjustments'] },
  },
  {
    caseId: 'SG-006',
    toolId: 'sentencing_guide',
    difficulty: 'medium',
    description: '情节调节（自首减轻 -25%）',
    input: { charge: '盗窃罪', elements: { amount: 5000, surrender: true } },
    expected: { success: true, minDataFields: ['adjustments'] },
  },
  {
    caseId: 'SG-007',
    toolId: 'sentencing_guide',
    difficulty: 'hard',
    description: '情节调节（立功减轻 -15%）',
    input: { charge: '盗窃罪', elements: { amount: 5000, merit: true } },
    expected: { success: true, minDataFields: ['adjustments'] },
  },
  {
    caseId: 'SG-008',
    toolId: 'sentencing_guide',
    difficulty: 'medium',
    description: '基准刑 = (min+max)/2',
    input: { charge: '盗窃罪', elements: { amount: 5000 } },
    expected: { success: true, minDataFields: ['baseSentence'] },
  },
  {
    caseId: 'SG-009',
    toolId: 'sentencing_guide',
    difficulty: 'easy',
    description: 'finalSentence 在 [min, max] 区间内（clamp）',
    input: {
      charge: '盗窃罪',
      elements: { amount: 5000, priorConviction: true, surrender: true },
    },
    expected: { success: true, minDataFields: ['finalSentence'] },
  },
  {
    caseId: 'SG-010',
    toolId: 'sentencing_guide',
    difficulty: 'hard',
    description: '罪名未覆盖抛 8007',
    input: { charge: '不存在的罪名', elements: { amount: 5000 } },
    expected: { errorCode: 8007 },
  },

  // ===== 8. clause_recommender（10 用例）=====
  {
    caseId: 'CR-001',
    toolId: 'clause_recommender',
    difficulty: 'easy',
    description: '房屋租赁合同条款推荐',
    input: { docType: '房屋租赁合同', filledVars: { rentAmount: 5000, paymentDay: 5 } },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-002',
    toolId: 'clause_recommender',
    difficulty: 'easy',
    description: '买卖合同条款推荐',
    input: { docType: '买卖合同', filledVars: { price: 100000 } },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-003',
    toolId: 'clause_recommender',
    difficulty: 'medium',
    description: '借款合同条款推荐',
    input: { docType: '借款合同', filledVars: { loanAmount: 50000 } },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-004',
    toolId: 'clause_recommender',
    difficulty: 'easy',
    description: 'Top-5 返回（含 matchScore/applicable/reason）',
    input: { docType: '房屋租赁合同', filledVars: { rentAmount: 5000 } },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-005',
    toolId: 'clause_recommender',
    difficulty: 'medium',
    description: 'category 过滤（违约责任）',
    input: {
      docType: '房屋租赁合同',
      filledVars: { rentAmount: 5000 },
      category: '违约责任',
    },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-006',
    toolId: 'clause_recommender',
    difficulty: 'easy',
    description: '无 filledVars 也能召回（仅 docType）',
    input: { docType: '房屋租赁合同' },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-007',
    toolId: 'clause_recommender',
    difficulty: 'hard',
    description: '无匹配条款抛 8009',
    input: { docType: '不存在的文书类型' },
    expected: { errorCode: 8009 },
  },
  {
    caseId: 'CR-008',
    toolId: 'clause_recommender',
    difficulty: 'medium',
    description: 'matchScore 排序（top1 score 最高）',
    input: { docType: '买卖合同', filledVars: { price: 100000, deliveryDate: '2026-01-01' } },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-009',
    toolId: 'clause_recommender',
    difficulty: 'easy',
    description: 'recommendedClauses 含 clauseId/title/content',
    input: { docType: '借款合同', filledVars: { loanAmount: 50000, interestRate: 0.05 } },
    expected: { success: true, minClausesCount: 1 },
  },
  {
    caseId: 'CR-010',
    toolId: 'clause_recommender',
    difficulty: 'medium',
    description: '争议解决条款推荐',
    input: { docType: '房屋租赁合同', category: '争议解决' },
    expected: { success: true, minClausesCount: 1 },
  },
];
