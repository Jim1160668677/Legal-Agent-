/**
 * 案由分类静态数据（v2.3-W1，14-tool-design.md §9.3）。
 *
 * 用途：CauseClassifier 工具按案情描述 BM25 召回 Top-3 案由。
 *
 * 覆盖范围：
 *   - 民事案由 12 项（离婚/民间借贷/买卖合同/房屋租赁/交通事故/劳动争议/物业服务/继承/赡养/抚养/名誉权/相邻关系）
 *   - 刑事罪名 8 项（盗窃/诈骗/故意伤害/故意杀人/抢劫/抢夺/敲诈勒索/交通肇事）
 *   - 商事案由 4 项（股权转让/合伙协议/公司决议/破产清算）
 *   - 行政案由 2 项（行政处罚/行政不作为）
 *
 * 字段对齐 14-tool-design.md §9.2 outputSchema：
 *   - causeCode：案由代码（如 M002）
 *   - causeName：案由名称
 *   - category：分类（civil/criminal/commercial/administrative）
 *   - applicableProcedure：适用程序
 *   - keywords：匹配关键词（用于 BM25 召回）
 *   - lawRefs：关联法条
 *
 * 数据来源：最高人民法院《民事案件案由规定》（法〔2020〕346 号）
 *         +《最高人民法院关于执行〈中华人民共和国刑法〉确定罪名的规定》
 *
 * 设计依据：14-tool-design.md §9.3 数据依赖；§9.4 核心算法。
 */

export type CauseCategory = 'civil' | 'criminal' | 'commercial' | 'administrative';

export type ApplicableProcedure = 'ordinary' | 'summary' | 'small_claims' | 'criminal_procedure';

export interface CauseClassificationEntry {
  /** 案由代码（M 民事 / C 刑事 / B 商事 / A 行政） */
  causeCode: string;
  /** 案由名称 */
  causeName: string;
  /** 分类 */
  category: CauseCategory;
  /** 适用程序 */
  applicableProcedure: ApplicableProcedure;
  /** 匹配关键词（含同义词扩展） */
  keywords: string[];
  /** 关联法条 */
  lawRefs: Array<{ ref: string; title: string }>;
}

/**
 * 案由分类金标集（26 项）。
 *
 * 命名约定：
 *   - M = 民事（民事案件案由规定）
 *   - C = 刑事（刑法罪名规定）
 *   - B = 商事（公司/破产相关）
 *   - A = 行政（行政诉讼案由）
 */
export const CAUSE_CLASSIFICATION: CauseClassificationEntry[] = [
  // ===== 民事 =====
  {
    causeCode: 'M001',
    causeName: '离婚纠纷',
    category: 'civil',
    applicableProcedure: 'ordinary',
    keywords: [
      '离婚',
      '婚姻破裂',
      '感情不和',
      '分居',
      '抚养权',
      '夫妻共同财产',
      '协议离婚',
      '诉讼离婚',
      '调解',
    ],
    lawRefs: [
      { ref: '民法典第一千零七十九条', title: '离婚法定情形' },
      { ref: '民法典第一千零八十七条', title: '离婚财产分割' },
    ],
  },
  {
    causeCode: 'M002',
    causeName: '民间借贷纠纷',
    category: 'civil',
    applicableProcedure: 'summary',
    keywords: ['借款', '欠款', '借条', '欠条', '还钱', '利息', '借贷', '欠债', '不还', '拖欠'],
    lawRefs: [
      { ref: '民法典第六百六十七条', title: '借款合同定义' },
      { ref: '民法典第六百七十九条', title: '自然人借款合同' },
    ],
  },
  {
    causeCode: 'M003',
    causeName: '买卖合同纠纷',
    category: 'civil',
    applicableProcedure: 'summary',
    keywords: [
      '买卖',
      '购物',
      '商品',
      '质量',
      '退换货',
      '违约',
      '不发货',
      '假货',
      '欺诈',
      '退一赔三',
    ],
    lawRefs: [
      { ref: '民法典第五百九十五条', title: '买卖合同定义' },
      { ref: '民法典第六百一十条', title: '标的物质量不符' },
    ],
  },
  {
    causeCode: 'M004',
    causeName: '房屋租赁合同纠纷',
    category: 'civil',
    applicableProcedure: 'summary',
    keywords: ['租房', '房东', '租客', '租赁', '租金', '退租', '押金', '房屋', '漏水', '维修'],
    lawRefs: [
      { ref: '民法典第七百零三条', title: '租赁合同定义' },
      { ref: '民法典第七百二十二条', title: '承租人违约' },
    ],
  },
  {
    causeCode: 'M005',
    causeName: '机动车交通事故责任纠纷',
    category: 'civil',
    applicableProcedure: 'ordinary',
    keywords: [
      '交通事故',
      '撞车',
      '事故车',
      '受伤',
      '赔偿',
      '误工费',
      '护理费',
      '伤残',
      '肇事',
      '追尾',
    ],
    lawRefs: [
      { ref: '民法典第一千二百零八条', title: '机动车交通事故责任' },
      { ref: '道路交通安全法第七十六条', title: '交通事故赔偿' },
    ],
  },
  {
    causeCode: 'M006',
    causeName: '劳动争议',
    category: 'civil',
    applicableProcedure: 'ordinary',
    keywords: [
      '劳动',
      '工资',
      '拖欠工资',
      '工伤',
      '解除劳动合同',
      '辞退',
      '加班费',
      '经济补偿',
      '赔偿金',
      '社保',
    ],
    lawRefs: [
      { ref: '劳动合同法第三十八条', title: '劳动者解除合同' },
      { ref: '劳动合同法第四十六条', title: '经济补偿' },
    ],
  },
  {
    causeCode: 'M007',
    causeName: '物业服务合同纠纷',
    category: 'civil',
    applicableProcedure: 'small_claims',
    keywords: ['物业', '物业费', '物业服务', '小区', '公共设施', '保洁', '保安'],
    lawRefs: [{ ref: '民法典第九百四十四条', title: '物业费支付' }],
  },
  {
    causeCode: 'M008',
    causeName: '继承纠纷',
    category: 'civil',
    applicableProcedure: 'ordinary',
    keywords: ['继承', '遗产', '遗嘱', '法定继承', '继承人', '遗赠', '扶养协议', '分割'],
    lawRefs: [
      { ref: '民法典第一千一百二十七条', title: '法定继承人顺序' },
      { ref: '民法典第一千一百三十三条', title: '遗嘱处分' },
    ],
  },
  {
    causeCode: 'M009',
    causeName: '赡养纠纷',
    category: 'civil',
    applicableProcedure: 'summary',
    keywords: ['赡养', '老人', '父母', '赡养费', '扶养', '子女', '不赡养'],
    lawRefs: [{ ref: '民法典第一千零六十七条', title: '父母子女扶养义务' }],
  },
  {
    causeCode: 'M010',
    causeName: '抚养纠纷',
    category: 'civil',
    applicableProcedure: 'summary',
    keywords: ['抚养', '抚养权', '抚养费', '子女', '未成年', '探望', '直接抚养'],
    lawRefs: [
      { ref: '民法典第一千零八十四条', title: '离婚后子女抚养' },
      { ref: '民法典第一千零八十五条', title: '抚养费负担' },
    ],
  },
  {
    causeCode: 'M011',
    causeName: '名誉权纠纷',
    category: 'civil',
    applicableProcedure: 'ordinary',
    keywords: ['名誉', '侮辱', '诽谤', '侵权', '道歉', '精神损害', '网络', '造谣'],
    lawRefs: [
      { ref: '民法典第一千零二十四条', title: '名誉权' },
      { ref: '民法典第一千一百八十三条', title: '精神损害赔偿' },
    ],
  },
  {
    causeCode: 'M012',
    causeName: '相邻关系纠纷',
    category: 'civil',
    applicableProcedure: 'summary',
    keywords: ['相邻', '邻居', '漏水', '噪音', '扰民', '通风', '采光', '通行', '排水'],
    lawRefs: [{ ref: '民法典第二百八十八条', title: '相邻关系原则' }],
  },

  // ===== 刑事 =====
  {
    causeCode: 'C001',
    causeName: '盗窃罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['盗窃', '偷窃', '偷东西', '入室盗窃', '扒窃', '数额较大', '秘密窃取'],
    lawRefs: [{ ref: '刑法第二百六十四条', title: '盗窃罪' }],
  },
  {
    causeCode: 'C002',
    causeName: '诈骗罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['诈骗', '骗取', '电信诈骗', '网络诈骗', '骗钱', '虚构事实', '隐瞒真相'],
    lawRefs: [{ ref: '刑法第二百六十六条', title: '诈骗罪' }],
  },
  {
    causeCode: 'C003',
    causeName: '故意伤害罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['故意伤害', '打人', '轻伤', '重伤', '斗殴', '伤害', '受伤', '动手'],
    lawRefs: [{ ref: '刑法第二百三十四条', title: '故意伤害罪' }],
  },
  {
    causeCode: 'C004',
    causeName: '故意杀人罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['故意杀人', '杀人', '凶杀', '谋害', '致死'],
    lawRefs: [{ ref: '刑法第二百三十二条', title: '故意杀人罪' }],
  },
  {
    causeCode: 'C005',
    causeName: '抢劫罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['抢劫', '持械', '暴力', '胁迫', '劫取', '当场'],
    lawRefs: [{ ref: '刑法第二百六十三条', title: '抢劫罪' }],
  },
  {
    causeCode: 'C006',
    causeName: '抢夺罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['抢夺', '飞车', '夺包', '抢东西'],
    lawRefs: [{ ref: '刑法第二百六十七条', title: '抢夺罪' }],
  },
  {
    causeCode: 'C007',
    causeName: '敲诈勒索罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['敲诈', '勒索', '恐吓', '威胁', '要挟'],
    lawRefs: [{ ref: '刑法第二百七十四条', title: '敲诈勒索罪' }],
  },
  {
    causeCode: 'C008',
    causeName: '交通肇事罪',
    category: 'criminal',
    applicableProcedure: 'criminal_procedure',
    keywords: ['交通肇事', '重大事故', '撞死', '撞伤', '肇事逃逸', '酒驾'],
    lawRefs: [{ ref: '刑法第一百三十三条', title: '交通肇事罪' }],
  },

  // ===== 商事 =====
  {
    causeCode: 'B001',
    causeName: '股权转让纠纷',
    category: 'commercial',
    applicableProcedure: 'ordinary',
    keywords: ['股权转让', '股东', '股权', '出资', '股东会决议', '优先购买权'],
    lawRefs: [{ ref: '公司法第七十一条', title: '股权转让' }],
  },
  {
    causeCode: 'B002',
    causeName: '合伙协议纠纷',
    category: 'commercial',
    applicableProcedure: 'ordinary',
    keywords: ['合伙', '合伙人', '退伙', '散伙', '合伙财产', '合伙债务'],
    lawRefs: [{ ref: '民法典第九百六十七条', title: '合伙合同定义' }],
  },
  {
    causeCode: 'B003',
    causeName: '公司决议纠纷',
    category: 'commercial',
    applicableProcedure: 'ordinary',
    keywords: ['公司决议', '股东会', '董事会', '决议无效', '决议撤销', '召集程序'],
    lawRefs: [{ ref: '公司法第二十二条', title: '公司决议效力' }],
  },
  {
    causeCode: 'B004',
    causeName: '破产清算纠纷',
    category: 'commercial',
    applicableProcedure: 'ordinary',
    keywords: ['破产', '清算', '资不抵债', '债权人', '破产申请', '重整'],
    lawRefs: [{ ref: '企业破产法第二条', title: '破产原因' }],
  },

  // ===== 行政 =====
  {
    causeCode: 'A001',
    causeName: '行政处罚纠纷',
    category: 'administrative',
    applicableProcedure: 'ordinary',
    keywords: ['行政处罚', '罚款', '吊销执照', '责令改正', '行政违法', '复议'],
    lawRefs: [{ ref: '行政处罚法第九条', title: '行政处罚种类' }],
  },
  {
    causeCode: 'A002',
    causeName: '行政不作为纠纷',
    category: 'administrative',
    applicableProcedure: 'ordinary',
    keywords: ['行政不作为', '不履行', '未答复', '拖延', '未处理', '行政机关'],
    lawRefs: [{ ref: '行政诉讼法第十二条', title: '行政诉讼受案范围' }],
  },
];
