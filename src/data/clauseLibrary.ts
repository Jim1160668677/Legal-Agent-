/**
 * 条款库静态数据（v2.3-W1，14-tool-design.md §11.3）。
 *
 * 用途：ClauseRecommender 工具按文书类型 + 已填变量 BM25 召回 Top-5 推荐条款。
 *
 * 覆盖范围：
 *   - 房屋租赁合同：5 条款（租金支付/押金/维修责任/违约/争议解决）
 *   - 买卖合同：5 条款（质量标准/交付/付款/违约责任/争议解决）
 *   - 借款合同：5 条款（借款金额/利率/还款期限/违约责任/争议解决）
 *
 * 字段对齐 14-tool-design.md §11.2 outputSchema：
 *   - clauseId：条款 ID
 *   - title：条款标题
 *   - content：条款正文（含变量占位符 {{varName}}）
 *   - docType：适用文书类型
 *   - category：条款分类（违约责任/争议解决/保密条款等）
 *   - applicableConditions：适用条件（与 filledVars 兼容性判断用）
 *   - source：standard 标准 / custom 自定义
 *   - version：版本号
 *
 * 数据来源：法务团队依据相关法律法规编写的标准条款。
 *
 * 设计依据：14-tool-design.md §11.3 数据依赖；§11.4 核心算法。
 */

export interface ClauseEntry {
  /** 条款 ID */
  clauseId: string;
  /** 条款标题 */
  title: string;
  /** 条款正文（含变量占位符） */
  content: string;
  /** 适用文书类型 */
  docType: string;
  /** 条款分类 */
  category: string;
  /** 适用条件（键值对，与 filledVars 兼容性判断） */
  applicableConditions?: Record<string, unknown>;
  /** 来源：standard 标准 / custom 自定义 */
  source: 'standard' | 'custom';
  /** 版本号 */
  version: string;
}

/**
 * 标准条款库（15 条款）。
 *
 * 命名约定：CL-{docType缩写}-{seq}
 *   - LR = 房屋租赁（Lease/Rent）
 *   - SL = 买卖（Sale）
 *   - LN = 借款（Loan）
 */
export const CLAUSE_LIBRARY: ClauseEntry[] = [
  // ===== 房屋租赁合同 =====
  {
    clauseId: 'CL-LR-001',
    title: '租金支付条款',
    content:
      '承租人应于每月 {{paymentDay}} 日前向出租人支付当月租金人民币 {{rentAmount}} 元整。租金支付方式为 {{paymentMethod}}。',
    docType: '房屋租赁合同',
    category: '租金支付',
    applicableConditions: { rentAmount: 'number', paymentDay: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LR-002',
    title: '押金条款',
    content:
      '承租人于合同签订时向出租人支付押金人民币 {{depositAmount}} 元整。租赁期满或合同解除后，承租人结清应承担的费用且房屋无损坏的，出租人应在 {{refundDays}} 日内将押金全额无息退还。',
    docType: '房屋租赁合同',
    category: '押金',
    applicableConditions: { depositAmount: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LR-003',
    title: '维修责任条款',
    content:
      '租赁期间，房屋主体结构及固有设施由出租人负责维修；承租人因使用不当造成损坏的，由承租人负责维修或赔偿。承租人发现房屋需要维修时，应在 {{repairNoticeDays}} 日内通知出租人。',
    docType: '房屋租赁合同',
    category: '维修责任',
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LR-004',
    title: '违约责任条款',
    content:
      '承租人逾期支付租金的，每逾期一日按当月租金的 {{lateFeeRate}}% 向出租人支付违约金。逾期超过 {{terminateDays}} 日的，出租人有权解除合同并没收押金。',
    docType: '房屋租赁合同',
    category: '违约责任',
    applicableConditions: { rentAmount: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LR-005',
    title: '争议解决条款',
    content:
      '本合同履行过程中发生争议的，双方应协商解决；协商不成的，任何一方可向房屋所在地人民法院提起诉讼，也可向 {{arbitrationBody}} 申请仲裁。',
    docType: '房屋租赁合同',
    category: '争议解决',
    source: 'standard',
    version: '1.0.0',
  },

  // ===== 买卖合同 =====
  {
    clauseId: 'CL-SL-001',
    title: '质量标准条款',
    content:
      '标的物应符合国家 {{qualityStandard}} 标准及双方约定的质量要求。标的物质量保证期为 {{warrantyMonths}} 个月，自交付之日起计算。',
    docType: '买卖合同',
    category: '质量标准',
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-SL-002',
    title: '交付条款',
    content:
      '出卖人应于 {{deliveryDate}} 前将标的物交付至 {{deliveryLocation}}。交付时标的物毁损、灭失的风险由出卖人转移至买受人。',
    docType: '买卖合同',
    category: '交付',
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-SL-003',
    title: '付款条款',
    content:
      '买受人应于合同签订后 {{paymentDays}} 日内支付全部价款人民币 {{totalPrice}} 元整。分期付款的，按以下方式支付：{{installmentPlan}}。',
    docType: '买卖合同',
    category: '付款',
    applicableConditions: { totalPrice: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-SL-004',
    title: '违约责任条款',
    content:
      '出卖人逾期交付的，每日按标的物价款的 {{lateFeeRate}}% 支付违约金；买受人逾期付款的，每日按应付未付金额的 {{lateFeeRate}}% 支付违约金。逾期超过 {{terminateDays}} 日的，守约方有权解除合同。',
    docType: '买卖合同',
    category: '违约责任',
    applicableConditions: { totalPrice: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-SL-005',
    title: '争议解决条款',
    content:
      '本合同争议双方应协商解决；协商不成的，向 {{arbitrationBody}} 申请仲裁，或向被告住所地人民法院提起诉讼。',
    docType: '买卖合同',
    category: '争议解决',
    source: 'standard',
    version: '1.0.0',
  },

  // ===== 借款合同 =====
  {
    clauseId: 'CL-LN-001',
    title: '借款金额条款',
    content:
      '出借人向借款人提供借款人民币 {{loanAmount}} 元整（大写：{{loanAmountInWords}}），借款用途为 {{loanPurpose}}。',
    docType: '借款合同',
    category: '借款金额',
    applicableConditions: { loanAmount: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LN-002',
    title: '利率条款',
    content:
      '借款利率为年利率 {{annualRate}}%（不超过全国银行间同业拆借中心公布的一年期贷款市场报价利率的四倍）。利息自借款实际发放之日起算。',
    docType: '借款合同',
    category: '利率',
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LN-003',
    title: '还款期限条款',
    content:
      '借款人应于 {{repaymentDate}} 前一次性还本付息。借款人提前还款的，应提前 {{advanceNoticeDays}} 日通知出借人，利息按实际借款天数计算。',
    docType: '借款合同',
    category: '还款期限',
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LN-004',
    title: '违约责任条款',
    content:
      '借款人逾期还款的，自逾期之日起按年利率 {{overdueRate}}% 支付逾期利息，并按借款本金的 {{penaltyRate}}% 支付违约金。',
    docType: '借款合同',
    category: '违约责任',
    applicableConditions: { loanAmount: 'number' },
    source: 'standard',
    version: '1.0.0',
  },
  {
    clauseId: 'CL-LN-005',
    title: '争议解决条款',
    content: '本合同争议由出借人住所地人民法院管辖。双方也可协商向 {{arbitrationBody}} 申请仲裁。',
    docType: '借款合同',
    category: '争议解决',
    source: 'standard',
    version: '1.0.0',
  },
];

/** 按文书类型过滤条款 */
export function filterByDocType(docType: string): ClauseEntry[] {
  // 精确匹配 + 包含匹配
  const exact = CLAUSE_LIBRARY.filter((c) => c.docType === docType);
  if (exact.length > 0) return exact;

  return CLAUSE_LIBRARY.filter((c) => c.docType.includes(docType) || docType.includes(c.docType));
}
