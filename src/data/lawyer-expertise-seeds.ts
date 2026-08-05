/**
 * seed-lawyer-expertise.ts —— 律师专业知识种子数据脚本（v3.0 新增）。
 *
 * 用途：初始化律师专业知识库的示例数据
 * 运行方式：npx ts-node scripts/seed-lawyer-expertise.ts
 *
 * 种子数据类型：
 *   1. 案例分析类：典型案例的分析方法和思路
 *   2. 论证方法类：法律论证的结构和技巧
 *   3. 实务规则类：实务操作中的经验法则
 *   4. 风险评估类：各类法律风险的判断要点
 *   5. 辩护策略类：不同场景下的辩护策略建议
 */

// 示例数据 - 可根据实际需求扩展
export const lawyerExpertiseSeeds = [
  // ===== 案例分析类 =====
  {
    expertiseId: 'exp_case_001',
    expertiseType: 'case_analysis' as const,
    title: '合同违约责任案例分析框架',
    content:
      '分析合同违约责任案例时，应遵循以下步骤：\n1. 确认合同效力：合同主体资格、意思表示真实、内容合法\n2. 识别违约行为：区分根本违约与一般违约\n3. 计算损失：实际损失+可得利益损失（需举证）\n4. 因果关系：违约行为与损失之间的因果关系\n5. 减损义务：守约方是否采取合理措施减少损失\n6. 违约金调整：约定违约金是否过高/过低',
    scenarioTags: ['contract_review', 'litigation'] as const,
    conditions: {
      factPattern: '合同履行过程中一方违反合同约定',
      legalStandard: '《民法典》第577-585条',
      applicableContext: '合同纠纷诉讼或仲裁',
    },
    argument: {
      premise: '合同双方应依约履行义务',
      reasoning: '违约方违反合同约定，造成守约方损失，应承担违约责任',
      conclusion: '违约方应赔偿守约方损失，包括实际损失和可得利益',
      counterArguments: [
        '不可抗力免责',
        '守约方过错',
        '合同约定的免责条款',
      ],
    },
    examples: [
      {
        caseName: '某建设工程施工合同纠纷案',
        factSummary: '承包人完成工程后，发包人拖欠工程款',
        applicationProcess:
          '1. 确认施工合同有效\n2. 认定发包人拖欠工程款构成违约\n3. 计算欠付工程款及利息损失\n4. 承包人是否尽到催告义务\n5. 发包人是否有权以质量问题抗辩',
        outcome: '法院判决发包人支付工程款及逾期利息',
      },
    ],
    sources: [
      {
        sourceType: 'statute' as const,
        sourceId: 'civil_code_577',
        sourceTitle: '中华人民共和国民法典第577条',
      },
    ],
    relatedLawIds: ['civil_code_577', 'civil_code_584'],
    contributedBy: 'seed_system',
    contributorName: '系统种子数据',
    practiceAreas: ['合同纠纷', '建设工程'],
    reliabilityScore: 0.9,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },
  {
    expertiseId: 'exp_case_002',
    expertiseType: 'case_analysis' as const,
    title: '劳动争议案件分析要点',
    content:
      '劳动争议案件分析应关注：\n1. 劳动关系确认：劳动合同、社保记录、工作证等\n2. 争议类型：解除/终止、欠薪、加班费、经济补偿\n3. 时效限制：劳动争议仲裁时效1年\n4. 证据收集：劳动合同、工资单、考勤记录、邮件沟通\n5. 法律适用：《劳动合同法》《劳动争议调解仲裁法》\n6. 程序选择：仲裁前置，对仲裁裁决不服可起诉',
    scenarioTags: ['litigation', 'general'] as const,
    conditions: {
      factPattern: '劳动者与用人单位发生劳动争议',
      legalStandard: '《劳动合同法》《劳动争议调解仲裁法》',
    },
    argument: {
      premise: '劳动者与用人单位存在劳动关系',
      reasoning: '用人单位违反劳动法律法规，侵害劳动者合法权益',
      conclusion: '劳动者有权申请劳动仲裁，要求用人单位承担相应责任',
    },
    sources: [
      {
        sourceType: 'statute' as const,
        sourceId: 'labor_contract_law',
        sourceTitle: '中华人民共和国劳动合同法',
      },
    ],
    practiceAreas: ['劳动争议'],
    reliabilityScore: 0.85,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },

  // ===== 论证方法类 =====
  {
    expertiseId: 'exp_arg_001',
    expertiseType: 'argumentation_method' as const,
    title: '三段论法律论证方法',
    content:
      '三段论法律论证是法律推理的基本结构：\n1. 大前提（法律规范）：查找适用的法律条文\n2. 小前提（案件事实）：确定案件事实是否符合法律规范的构成要件\n3. 结论（法律适用）：基于大小前提得出法律结论\n\n适用要点：\n- 大前提的准确性：需确保找到正确的法律规范\n- 小前提的真实性：需确保案件事实有充分证据支持\n- 逻辑的严密性：推理过程需无逻辑漏洞',
    scenarioTags: ['case_analysis', 'litigation'] as const,
    conditions: {
      factPattern: '需要从法律规范推导出结论',
      legalStandard: '法律适用的基本方法论',
    },
    argument: {
      premise: '法律规范规定了构成要件和法律后果',
      reasoning: '案件事实符合法律规范的构成要件',
      conclusion: '应当适用该法律规范，产生相应的法律后果',
    },
    practiceAreas: ['法律方法论'],
    reliabilityScore: 0.95,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },
  {
    expertiseId: 'exp_arg_002',
    expertiseType: 'argumentation_method' as const,
    title: '类比推理在法律中的应用',
    content:
      '类比推理适用于法律漏洞填补：\n1. 识别类似案件：找到与待处理案件相似的先例\n2. 比较异同：分析两个案件的相同点和不同点\n3. 法律评价：判断相同点在法律上的重要性\n4. 结论：如相同点更重要，则适用先例的处理方式\n\n注意事项：\n- 英美法系常用，大陆法系需谨慎\n- 不得突破法律的明确规定\n- 需进行充分的论证和说理论证',
    scenarioTags: ['case_analysis', 'general'] as const,
    conditions: {
      factPattern: '法律无明确规定，存在类似先例',
      legalStandard: '法律方法论中的类比推理',
    },
    practiceAreas: ['法律方法论'],
    reliabilityScore: 0.75,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },

  // ===== 实务规则类 =====
  {
    expertiseId: 'exp_rule_001',
    expertiseType: 'practical_rule' as const,
    title: '合同审查实务检查清单',
    content:
      '合同审查应逐项检查：\n\n一、主体资格\n- 企业营业执照、法人身份\n- 特殊资质（如建筑资质、经营许可）\n- 授权委托手续\n\n二、合同条款\n- 标的：名称、规格、数量、质量标准\n- 价款：金额、支付方式、支付时间\n- 履行：履行时间、履行地点、履行方式\n- 违约：违约情形、违约金计算、损失赔偿\n- 争议解决：管辖法院、仲裁机构\n\n三、风险提示\n- 免责条款是否合理\n- 不可抗力条款\n- 保密条款\n- 知识产权归属',
    scenarioTags: ['contract_review'] as const,
    conditions: {
      factPattern: '需要审查合同文本',
      legalStandard: '合同审查实务规范',
    },
    practiceAreas: ['合同审查'],
    reliabilityScore: 0.9,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },
  {
    expertiseId: 'exp_rule_002',
    expertiseType: 'practical_rule' as const,
    title: '民事诉讼时效实务要点',
    content:
      '民事诉讼时效实务要点：\n1. 普通诉讼时效：3年（自知道或应当知道权利受损之日起）\n2. 最长诉讼时效：20年（自权利受损之日起）\n3. 起算点：知道权利受损+知道义务人\n4. 时效中断：起诉、请求、义务人同意履行\n5. 时效中止：不可抗力、其他障碍\n6. 超过时效：丧失胜诉权（实体权利不消灭）\n\n实务建议：\n- 建立时效追踪机制\n- 提前发函中断时效\n- 留存时效中断证据',
    scenarioTags: ['litigation', 'general'] as const,
    conditions: {
      factPattern: '债权可能面临时效届满',
      legalStandard: '《民法典》第188-199条',
    },
    relatedLawIds: ['civil_code_188'],
    practiceAreas: ['民事诉讼', '债权债务'],
    reliabilityScore: 0.85,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },

  // ===== 风险评估类 =====
  {
    expertiseId: 'exp_risk_001',
    expertiseType: 'risk_assessment' as const,
    title: '合同风险评估框架',
    content:
      '合同风险评估应覆盖：\n\n1. 法律风险\n- 合同效力风险：主体资格、意思表示、内容合法性\n- 条款风险：霸王条款、模糊条款、缺失条款\n- 履行风险：履行能力、履行时间、履行方式\n\n2. 商业风险\n- 对方信用风险：资信状况、履约记录\n- 市场风险：价格波动、政策变化\n- 竞争风险：替代性、技术生命周期\n\n3. 操作风险\n- 签署流程风险：授权、签署权限\n- 履约流程风险：交付、验收、付款\n- 证据留存风险：沟通记录、履行凭证\n\n评估等级：\n- 低风险：常规合同，条款完善\n- 中风险：涉及重要条款需关注\n- 高风险：存在重大缺陷需修改',
    scenarioTags: ['contract_review', 'legal_risk_assessment'] as const,
    conditions: {
      factPattern: '需要评估合同整体风险',
      legalStandard: '合同风险管理实务',
    },
    practiceAreas: ['合同审查', '风险控制'],
    reliabilityScore: 0.88,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },
  {
    expertiseId: 'exp_risk_002',
    expertiseType: 'risk_assessment' as const,
    title: '企业合规风险判断要点',
    content:
      '企业合规风险判断应关注：\n1. 行业监管要求：监管部门、监管法规\n2. 内部制度完善：规章制度、审批流程\n3. 关键人员行为：高管、合规负责人\n4. 第三方风险：供应商、客户、合作伙伴\n5. 数据与信息安全：个人信息、商业秘密\n6. 反商业贿赂：礼品、招待、佣金\n\n风险等级：\n- 一级（重大）：可能导致刑事追责、重大行政处罚\n- 二级（较大）：可能导致一般行政处罚、声誉损失\n- 三级（一般）：可能导致内部处分、轻微损失',
    scenarioTags: ['legal_risk_assessment', 'general'] as const,
    conditions: {
      factPattern: '企业面临合规检查或调查',
      legalStandard: '企业合规管理体系要求',
    },
    practiceAreas: ['企业合规', '风险管理'],
    reliabilityScore: 0.82,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },

  // ===== 辩护策略类 =====
  {
    expertiseId: 'exp_def_001',
    expertiseType: 'defense_strategy' as const,
    title: '合同纠纷常用抗辩策略',
    content:
      '合同纠纷中可采用的抗辩策略：\n\n1. 效力抗辩\n- 合同主体不适格\n- 意思表示不真实（欺诈、胁迫、重大误解）\n- 合同内容违反法律强制性规定\n\n2. 履行抗辩\n- 同时履行抗辩权\n- 先履行抗辩权\n- 不安抗辩权\n\n3. 免责抗辩\n- 不可抗力\n- 情势变更\n- 债权人过错\n\n4. 程序抗辩\n- 诉讼时效届满\n- 管辖异议\n- 仲裁协议存在\n\n策略选择建议：\n- 根据案件事实选择最有力的抗辩\n- 多种抗辩可并行使用\n- 注意抗辩的证据支持',
    scenarioTags: ['litigation', 'contract_review'] as const,
    conditions: {
      factPattern: '合同纠纷中作为被告方',
      legalStandard: '《民法典》合同编抗辩权',
    },
    relatedLawIds: ['civil_code_525', 'civil_code_526', 'civil_code_527'],
    practiceAreas: ['合同纠纷', '民事诉讼'],
    reliabilityScore: 0.87,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },
  {
    expertiseId: 'exp_def_002',
    expertiseType: 'defense_strategy' as const,
    title: '劳动争议应对策略（用人单位视角）',
    content:
      '用人单位处理劳动争议的策略：\n\n1. 预防策略\n- 完善劳动合同签订\n- 规范规章制度制定\n- 建立员工档案管理\n\n2. 应对策略\n- 核实争议事实\n- 收集相关证据\n- 评估法律风险\n- 制定应对方案\n\n3. 常见争议应对\n- 违法解除：准备解除理由和证据\n- 欠薪争议：核实计算标准\n- 加班费：明确工时制度\n- 经济补偿：确认适用情形\n\n4. 调解策略\n- 评估和解可能性\n- 制定和解方案\n- 控制和解成本',
    scenarioTags: ['litigation', 'general'] as const,
    conditions: {
      factPattern: '用人单位面临劳动争议',
      legalStandard: '《劳动合同法》相关规定',
    },
    practiceAreas: ['劳动争议', '人力资源'],
    reliabilityScore: 0.8,
    usageCount: 0,
    reviewStatus: 'approved' as const,
  },
];

/**
 * 种子数据元信息
 */
export const seedMetadata = {
  version: 'v3.0.0',
  createdAt: new Date(),
  description: '律师专业知识初始种子数据',
  categories: {
    case_analysis: 2,
    argumentation_method: 2,
    practical_rule: 2,
    risk_assessment: 2,
    defense_strategy: 2,
  },
  totalCount: 10,
};
