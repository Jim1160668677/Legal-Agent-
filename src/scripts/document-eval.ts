/**
 * 文书生成离线评测脚本（A3-W4，A3 §九）。
 *
 * 用途：基于 20 个用例（4 类文书 × 5 场景）评测文书生成质量。
 *       从 src/data/documentTemplates.ts 加载模板，无外部依赖（不需 MongoDB/Redis）。
 *
 * 指标（A3 §九验收）：
 *   - 变量填充正确率：渲染后正文包含所有期望字段值（100%）
 *   - 字段缺失校验命中率：必填缺失时 validateVars 返回 issues（100%）
 *   - 导出 docx/pdf 打开成功率：buildDocx/buildPdf 生成合法文件（魔数校验，100%）
 *   - 文书文尾免责声明 100% 附带（generate 返回 disclaimer 非空）
 *
 * 运行：npm run eval:document
 * 输出：reports/document-eval-report.json + 控制台摘要
 * 验收：所有指标 = 100%
 */
import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DocumentGeneratorService } from '../modules/legal/document/document-generator.service';
import { validateVars, renderDsl } from '../modules/legal/document/dsl-renderer';
import { buildDocx, DOCX_MAGIC } from '../infra/export/docx-builder';
import { buildPdf, PDF_MAGIC } from '../infra/export/pdf-builder';
import { DISCLAIMER_TEXT } from '../modules/legal/chat/sse-frames';
import { DOCUMENT_TEMPLATES } from '../data/documentTemplates';

// ===== 评测用例定义 =====

interface DocumentEvalCase {
  /** 用例 ID */
  id: string;
  /** 模板编码 */
  templateCode: string;
  /** 场景描述 */
  scenario: string;
  /** 输入变量（完整合法） */
  vars: Record<string, unknown>;
  /** 期望渲染结果中应包含的字符串片段（变量填充正确率） */
  expectedFragments: string[];
  /** 评测维度：normal=正常 / missing_required=缺失必填 / export=导出 */
  dimension: 'normal' | 'missing_required' | 'export';
  /** 缺失字段（dimension=missing_required 时生效） */
  missingFields?: string[];
}

function makeParty(name: string, idNo = '360101199001011234') {
  return { name, id_no: idNo, address: '南昌市东湖区', phone: '13800138000' };
}

/** 4 类 × 5 场景 = 20 用例 */
const EVAL_CASES: DocumentEvalCase[] = [
  // ===== 民事起诉状（5 场景） =====
  {
    id: 'complaint-1',
    templateCode: 'civil_complaint_v1',
    scenario: '标准借贷纠纷',
    dimension: 'normal',
    vars: {
      court_name: '南昌市东湖区人民法院',
      plaintiff: makeParty('张三'),
      defendant: makeParty('李四'),
      claims: ['判令被告偿还借款 10 万元', '判令被告承担诉讼费用'],
      facts: '2025 年 1 月，被告向原告借款 10 万元，约定 2025 年 6 月归还，到期未还。',
      sign_date: '2026-07-25',
    },
    expectedFragments: [
      '南昌市东湖区人民法院',
      '张三',
      '李四',
      '判令被告偿还借款 10 万元',
      '事实与理由',
    ],
  },
  {
    id: 'complaint-2',
    templateCode: 'civil_complaint_v1',
    scenario: '买卖合同纠纷',
    dimension: 'normal',
    vars: {
      court_name: '北京市海淀区人民法院',
      plaintiff: makeParty('王五'),
      defendant: makeParty('赵六'),
      claims: ['判令被告支付货款 5 万元及违约金'],
      facts: '原告向被告供应建材，被告收货后未支付货款。',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['北京市海淀区人民法院', '王五', '赵六', '支付货款 5 万元'],
  },
  {
    id: 'complaint-3',
    templateCode: 'civil_complaint_v1',
    scenario: '缺失原告信息',
    dimension: 'missing_required',
    missingFields: ['plaintiff'],
    vars: {
      court_name: '南昌市东湖区人民法院',
      defendant: makeParty('李四'),
      claims: ['判令被告偿还借款'],
      facts: '借款未还',
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'complaint-4',
    templateCode: 'civil_complaint_v1',
    scenario: '缺失诉讼请求',
    dimension: 'missing_required',
    missingFields: ['claims'],
    vars: {
      court_name: '南昌市东湖区人民法院',
      plaintiff: makeParty('张三'),
      defendant: makeParty('李四'),
      facts: '借款未还',
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'complaint-5',
    templateCode: 'civil_complaint_v1',
    scenario: '导出 docx/pdf',
    dimension: 'export',
    vars: {
      court_name: '南昌市东湖区人民法院',
      plaintiff: makeParty('张三'),
      defendant: makeParty('李四'),
      claims: ['判令被告偿还借款'],
      facts: '借款未还',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['南昌市东湖区人民法院', '张三'],
  },

  // ===== 标准合同（5 场景） =====
  {
    id: 'contract-1',
    templateCode: 'standard_contract_v1',
    scenario: '标准购销合同',
    dimension: 'normal',
    vars: {
      party_a: makeParty('甲方公司'),
      party_b: makeParty('乙方公司'),
      contract_subject: '一批办公设备采购',
      terms: ['甲方按时交付设备', '乙方按时支付货款', '违约金按合同总价 5% 计算'],
      sign_date: '2026-07-25',
    },
    expectedFragments: ['甲方公司', '乙方公司', '办公设备采购', '违约金按合同总价'],
  },
  {
    id: 'contract-2',
    templateCode: 'standard_contract_v1',
    scenario: '服务合同',
    dimension: 'normal',
    vars: {
      party_a: makeParty('委托方'),
      party_b: makeParty('受托方'),
      contract_subject: 'IT 运维服务',
      terms: ['服务期限 1 年', '服务费 12 万元/年'],
      sign_date: '2026-07-25',
    },
    expectedFragments: ['委托方', '受托方', 'IT 运维服务', '12 万元/年'],
  },
  {
    id: 'contract-3',
    templateCode: 'standard_contract_v1',
    scenario: '缺失合同标的',
    dimension: 'missing_required',
    missingFields: ['contract_subject'],
    vars: {
      party_a: makeParty('甲方'),
      party_b: makeParty('乙方'),
      terms: ['条款1'],
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'contract-4',
    templateCode: 'standard_contract_v1',
    scenario: '缺失条款',
    dimension: 'missing_required',
    missingFields: ['terms'],
    vars: {
      party_a: makeParty('甲方'),
      party_b: makeParty('乙方'),
      contract_subject: '标的',
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'contract-5',
    templateCode: 'standard_contract_v1',
    scenario: '导出 docx/pdf',
    dimension: 'export',
    vars: {
      party_a: makeParty('甲方'),
      party_b: makeParty('乙方'),
      contract_subject: '标的',
      terms: ['条款1'],
      sign_date: '2026-07-25',
    },
    expectedFragments: ['甲方', '乙方'],
  },

  // ===== 律师函（5 场景） =====
  {
    id: 'letter-1',
    templateCode: 'lawyer_letter_v1',
    scenario: '催款律师函',
    dimension: 'normal',
    vars: {
      sender_firm: '南昌某某律师事务所',
      recipient: '某公司',
      matter: '欠款 50 万元未偿还',
      demands: ['立即偿还欠款 50 万元', '支付逾期利息'],
      deadline: '2026-08-25',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['南昌某某律师事务所', '某公司', '欠款 50 万元', '立即偿还欠款'],
  },
  {
    id: 'letter-2',
    templateCode: 'lawyer_letter_v1',
    scenario: '侵权警告函',
    dimension: 'normal',
    vars: {
      sender_firm: '北京某某律师事务所',
      recipient: '侵权方',
      matter: '商标侵权',
      demands: ['立即停止侵权行为', '赔偿损失'],
      deadline: '2026-08-25',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['北京某某律师事务所', '侵权方', '商标侵权', '立即停止侵权行为'],
  },
  {
    id: 'letter-3',
    templateCode: 'lawyer_letter_v1',
    scenario: '缺失发函律所',
    dimension: 'missing_required',
    missingFields: ['sender_firm'],
    vars: {
      recipient: '某公司',
      matter: '事由',
      demands: ['要求'],
      deadline: '2026-08-25',
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'letter-4',
    templateCode: 'lawyer_letter_v1',
    scenario: '缺失履行期限',
    dimension: 'missing_required',
    missingFields: ['deadline'],
    vars: {
      sender_firm: '律所',
      recipient: '某公司',
      matter: '事由',
      demands: ['要求'],
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'letter-5',
    templateCode: 'lawyer_letter_v1',
    scenario: '导出 docx/pdf',
    dimension: 'export',
    vars: {
      sender_firm: '律所',
      recipient: '某公司',
      matter: '事由',
      demands: ['要求'],
      deadline: '2026-08-25',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['律所', '某公司'],
  },

  // ===== 民事答辩状（5 场景） =====
  {
    id: 'defense-1',
    templateCode: 'civil_defense_v1',
    scenario: '标准答辩',
    dimension: 'normal',
    vars: {
      defendant_info: makeParty('答辩人王五'),
      case_no: '(2026)赣 0102 民初 123 号',
      defense_points: ['原告诉讼请求无事实依据', '原告主张已过诉讼时效'],
      court_name: '南昌市东湖区人民法院',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['答辩人王五', '(2026)赣 0102 民初 123 号', '原告诉讼请求无事实依据'],
  },
  {
    id: 'defense-2',
    templateCode: 'civil_defense_v1',
    scenario: '合同纠纷答辩',
    dimension: 'normal',
    vars: {
      defendant_info: makeParty('答辩人赵六'),
      case_no: '(2026)京 0108 民初 456 号',
      defense_points: ['合同已履行完毕', '原告主张缺乏证据支持'],
      court_name: '北京市海淀区人民法院',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['答辩人赵六', '(2026)京 0108 民初 456 号', '合同已履行完毕'],
  },
  {
    id: 'defense-3',
    templateCode: 'civil_defense_v1',
    scenario: '缺失案号',
    dimension: 'missing_required',
    missingFields: ['case_no'],
    vars: {
      defendant_info: makeParty('答辩人'),
      defense_points: ['答辩要点'],
      court_name: '南昌市东湖区人民法院',
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'defense-4',
    templateCode: 'civil_defense_v1',
    scenario: '缺失答辩要点',
    dimension: 'missing_required',
    missingFields: ['defense_points'],
    vars: {
      defendant_info: makeParty('答辩人'),
      case_no: '案号',
      court_name: '南昌市东湖区人民法院',
      sign_date: '2026-07-25',
    },
    expectedFragments: [],
  },
  {
    id: 'defense-5',
    templateCode: 'civil_defense_v1',
    scenario: '导出 docx/pdf',
    dimension: 'export',
    vars: {
      defendant_info: makeParty('答辩人'),
      case_no: '(2026)赣 0102 民初 123 号',
      defense_points: ['答辩要点'],
      court_name: '南昌市东湖区人民法院',
      sign_date: '2026-07-25',
    },
    expectedFragments: ['答辩人', '赣 0102'],
  },
];

// ===== 评测逻辑 =====

interface CaseResult {
  id: string;
  templateCode: string;
  scenario: string;
  dimension: string;
  passed: boolean;
  /** 变量填充正确率：所有 expectedFragments 命中 */
  varFillCorrect: boolean;
  /** 字段缺失校验：missing_required 用例必须报 issues */
  validationHit: boolean;
  /** 导出成功：export 用例生成合法 docx/pdf */
  exportSuccess: boolean;
  /** 免责声明附带 */
  disclaimerAttached: boolean;
  errorMessage?: string;
  missingFragments?: string[];
}

interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  /** 变量填充正确率（normal + export 用例） */
  varFillRate: number;
  /** 字段缺失校验命中率（missing_required 用例） */
  validationHitRate: number;
  /** 导出成功率（export 用例） */
  exportSuccessRate: number;
  /** 免责声明附带率（normal + export 用例） */
  disclaimerRate: number;
  results: CaseResult[];
  generatedAt: string;
}

async function main() {
  console.log('=== 文书生成离线评测（A3-W4） ===');
  console.log(`用例总数：${EVAL_CASES.length}（4 模板 × 5 场景）\n`);

  const generator = new DocumentGeneratorService();
  const results: CaseResult[] = [];

  for (const evalCase of EVAL_CASES) {
    const result = await evaluateCase(generator, evalCase);
    results.push(result);
    const status = result.passed ? '✓' : '✗';
    console.log(
      `${status} ${evalCase.id} [${evalCase.dimension}] ${evalCase.scenario}` +
        (result.passed ? '' : ` — ${result.errorMessage}`),
    );
  }

  // 计算汇总指标
  const normalAndExport = results.filter((r) => r.dimension !== 'missing_required');
  const missingRequired = results.filter((r) => r.dimension === 'missing_required');
  const exportCases = results.filter((r) => r.dimension === 'export');

  const varFillRate =
    normalAndExport.filter((r) => r.varFillCorrect).length / normalAndExport.length;
  const validationHitRate =
    missingRequired.filter((r) => r.validationHit).length / missingRequired.length;
  const exportSuccessRate = exportCases.filter((r) => r.exportSuccess).length / exportCases.length;
  const disclaimerRate =
    normalAndExport.filter((r) => r.disclaimerAttached).length / normalAndExport.length;

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  const report: EvalReport = {
    total: results.length,
    passed,
    failed,
    varFillRate,
    validationHitRate,
    exportSuccessRate,
    disclaimerRate,
    results,
    generatedAt: new Date().toISOString(),
  };

  // 写入报告
  const reportPath = resolve(process.cwd(), 'reports/document-eval-report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== 评测汇总 ===');
  console.log(`通过: ${passed}/${results.length}`);
  console.log(`变量填充正确率: ${(varFillRate * 100).toFixed(1)}%（阈值 100%）`);
  console.log(`字段缺失校验命中率: ${(validationHitRate * 100).toFixed(1)}%（阈值 100%）`);
  console.log(`导出成功率: ${(exportSuccessRate * 100).toFixed(1)}%（阈值 100%）`);
  console.log(`免责声明附带率: ${(disclaimerRate * 100).toFixed(1)}%（阈值 100%）`);
  console.log(`\n报告已写入: ${reportPath}`);

  // 验收：所有指标 = 100%
  const allPassed =
    varFillRate === 1 && validationHitRate === 1 && exportSuccessRate === 1 && disclaimerRate === 1;
  if (allPassed) {
    console.log('\n✅ 评测通过（A3 §九验收全部达标）');
    process.exit(0);
  } else {
    console.log('\n❌ 评测未通过（部分指标未达 100%）');
    process.exit(1);
  }
}

async function evaluateCase(
  generator: DocumentGeneratorService,
  evalCase: DocumentEvalCase,
): Promise<CaseResult> {
  const tmpl = DOCUMENT_TEMPLATES.find((t) => t.code === evalCase.templateCode);
  if (!tmpl) {
    return {
      id: evalCase.id,
      templateCode: evalCase.templateCode,
      scenario: evalCase.scenario,
      dimension: evalCase.dimension,
      passed: false,
      varFillCorrect: false,
      validationHit: false,
      exportSuccess: false,
      disclaimerAttached: false,
      errorMessage: `模板不存在: ${evalCase.templateCode}`,
    };
  }

  // 1. 校验变量
  const validation = validateVars(tmpl.vars, evalCase.vars);

  if (evalCase.dimension === 'missing_required') {
    // 缺失必填用例：期望 validation 报 issues 且涉及 missingFields
    const validationHit = !validation.valid && validation.issues.length > 0;
    const missingFieldsHit = (evalCase.missingFields ?? []).every((field) =>
      validation.issues.some((i) => i.field.startsWith(field) && i.code === 'required'),
    );
    return {
      id: evalCase.id,
      templateCode: evalCase.templateCode,
      scenario: evalCase.scenario,
      dimension: evalCase.dimension,
      passed: validationHit && missingFieldsHit,
      varFillCorrect: true, // 不适用
      validationHit: validationHit && missingFieldsHit,
      exportSuccess: true, // 不适用
      disclaimerAttached: true, // 不适用
      errorMessage:
        validationHit && missingFieldsHit
          ? undefined
          : `期望校验失败但实际 valid=${validation.valid}, issues=${JSON.stringify(validation.issues)}`,
    };
  }

  // 2. normal / export 用例：执行 generate
  try {
    const generated = await generator.generate({
      templateCode: evalCase.templateCode,
      vars: evalCase.vars,
    });

    // 变量填充正确率：所有 expectedFragments 必须出现在 renderedText
    const missingFragments = evalCase.expectedFragments.filter(
      (f) => !generated.renderedText.includes(f),
    );
    const varFillCorrect = missingFragments.length === 0;

    // 免责声明附带
    const disclaimerAttached =
      generated.renderedText.includes(DISCLAIMER_TEXT) && generated.disclaimer === DISCLAIMER_TEXT;

    // 导出（仅 export 用例）
    let exportSuccess = true;
    if (evalCase.dimension === 'export') {
      const docxBuffer = buildDocx(generated.renderedText);
      const pdfBuffer = buildPdf(generated.renderedText);
      const docxValid = docxBuffer.subarray(0, 4).equals(DOCX_MAGIC);
      const pdfValid = pdfBuffer.subarray(0, 4).equals(PDF_MAGIC) && pdfBuffer.length > 50;
      exportSuccess = docxValid && pdfValid;
      void renderDsl; // 引用以保留 import
    }

    const passed = varFillCorrect && disclaimerAttached && exportSuccess;
    return {
      id: evalCase.id,
      templateCode: evalCase.templateCode,
      scenario: evalCase.scenario,
      dimension: evalCase.dimension,
      passed,
      varFillCorrect,
      validationHit: true, // normal/export 用例期望 valid
      exportSuccess,
      disclaimerAttached,
      errorMessage: passed
        ? undefined
        : `varFill=${varFillCorrect} disclaimer=${disclaimerAttached} export=${exportSuccess}`,
      missingFragments: missingFragments.length > 0 ? missingFragments : undefined,
    };
  } catch (err) {
    return {
      id: evalCase.id,
      templateCode: evalCase.templateCode,
      scenario: evalCase.scenario,
      dimension: evalCase.dimension,
      passed: false,
      varFillCorrect: false,
      validationHit: false,
      exportSuccess: false,
      disclaimerAttached: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

main().catch((err) => {
  console.error('评测脚本异常:', err);
  process.exit(2);
});
