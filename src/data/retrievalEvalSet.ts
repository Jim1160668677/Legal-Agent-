/**
 * 检索评测金标集（A2-W4）。
 *
 * 50 题人工标注查询，覆盖 31 条种子法条（src/data/lawArticles.ts）。
 * 文档 ID 格式：`${lawName}#${articleNoInt}`（与评测脚本构建 BM25 索引一致）。
 *
 * 分类：
 *   - law_ref（15 题）：法条直接引用查询（"民法典第一百四十三条"）
 *   - keyword（20 题）：关键词/概念查询（"诉讼时效几年"）
 *   - scenario（10 题）：场景描述查询（"对方不履行合同怎么办"）
 *   - multi_result（5 题）：多结果查询（"犯罪" → 多条刑法）
 *
 * 难度：easy / medium / hard
 *
 * 验收标准：Recall@10 ≥ 0.85（A2-W4 交付物）
 */

export interface RetrievalEvalItem {
  id: string;
  query: string;
  expectedDocIds: string[];
  category: 'law_ref' | 'keyword' | 'scenario' | 'multi_result';
  difficulty: 'easy' | 'medium' | 'hard';
}

export const RETRIEVAL_EVAL_VERSION = 1;

export const RETRIEVAL_EVAL_SET: RetrievalEvalItem[] = [
  // ===== law_ref（15 题）：法条直接引用 =====
  {
    id: 'q01',
    query: '民法典第一百四十三条',
    expectedDocIds: ['民法典#143'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q02',
    query: '民法典第143条',
    expectedDocIds: ['民法典#143'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q03',
    query: '刑法第二十条',
    expectedDocIds: ['刑法#20'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q04',
    query: '刑法第232条',
    expectedDocIds: ['刑法#232'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q05',
    query: '民法典第一百八十八条',
    expectedDocIds: ['民法典#188'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q06',
    query: '民事诉讼法第一百一十九条',
    expectedDocIds: ['民事诉讼法#119'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q07',
    query: '劳动合同法第四十七条',
    expectedDocIds: ['劳动合同法#47'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q08',
    query: '民法典第577条',
    expectedDocIds: ['民法典#577'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q09',
    query: '刑法第264条',
    expectedDocIds: ['刑法#264'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q10',
    query: '民法典第一千零七十九条',
    expectedDocIds: ['民法典#1079'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q11',
    query: '行政诉讼法第四十六条',
    expectedDocIds: ['行政诉讼法#46'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q12',
    query: '民法典第1165条',
    expectedDocIds: ['民法典#1165'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q13',
    query: '刑法第十四条',
    expectedDocIds: ['刑法#14'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q14',
    query: '民法典第一百五十三条',
    expectedDocIds: ['民法典#153'],
    category: 'law_ref',
    difficulty: 'easy',
  },
  {
    id: 'q15',
    query: '劳动合同法第三十八条',
    expectedDocIds: ['劳动合同法#38'],
    category: 'law_ref',
    difficulty: 'easy',
  },

  // ===== keyword（20 题）：关键词/概念查询 =====
  {
    id: 'q16',
    query: '诉讼时效是几年',
    expectedDocIds: ['民法典#188'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q17',
    query: '民事法律行为有效的条件',
    expectedDocIds: ['民法典#143'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q18',
    query: '合同违约了怎么办',
    expectedDocIds: ['民法典#577'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q19',
    query: '正当防卫不负刑事责任',
    expectedDocIds: ['刑法#20'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q20',
    query: '故意杀人判多少年',
    expectedDocIds: ['刑法#232'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q21',
    query: '盗窃罪量刑标准',
    expectedDocIds: ['刑法#264'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q22',
    query: '诈骗罪怎么判',
    expectedDocIds: ['刑法#266'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q23',
    query: '离婚财产怎么分割',
    expectedDocIds: ['民法典#1087'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q24',
    query: '法定继承顺序',
    expectedDocIds: ['民法典#1127'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q25',
    query: '人身损害赔偿项目',
    expectedDocIds: ['民法典#1179'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q26',
    query: '经济补偿金怎么算',
    expectedDocIds: ['劳动合同法#47'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q27',
    query: '起诉需要什么条件',
    expectedDocIds: ['民事诉讼法#119'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q28',
    query: '简易程序审理期限',
    expectedDocIds: ['民事诉讼法#164'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q29',
    query: '普通程序审限多久',
    expectedDocIds: ['民事诉讼法#149'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q30',
    query: '故意犯罪的概念',
    expectedDocIds: ['刑法#14'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q31',
    query: '过失犯罪定义',
    expectedDocIds: ['刑法#15'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q32',
    query: '紧急避险责任',
    expectedDocIds: ['刑法#21'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q33',
    query: '侵权责任过错',
    expectedDocIds: ['民法典#1165'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q34',
    query: '书面劳动合同要求',
    expectedDocIds: ['劳动合同法#10'],
    category: 'keyword',
    difficulty: 'medium',
  },
  {
    id: 'q35',
    query: '行政诉讼起诉期限',
    expectedDocIds: ['行政诉讼法#46'],
    category: 'keyword',
    difficulty: 'medium',
  },

  // ===== scenario（10 题）：场景描述查询 =====
  {
    id: 'q36',
    query: '对方不履行合同义务怎么追责',
    expectedDocIds: ['民法典#577'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q37',
    query: '被人打了能要求什么赔偿',
    expectedDocIds: ['民法典#1179'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q38',
    query: '因过错侵害他人民事权益',
    expectedDocIds: ['民法典#1165'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q39',
    query: '劳动者未签劳动合同',
    expectedDocIds: ['劳动合同法#10'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q40',
    query: '用人单位不缴纳社保能解除合同吗',
    expectedDocIds: ['劳动合同法#38'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q41',
    query: '交通肇事逃逸怎么判',
    expectedDocIds: ['刑法#133'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q42',
    query: '夫妻一方要求离婚',
    expectedDocIds: ['民法典#1079'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q43',
    query: '继承遗产顺序',
    expectedDocIds: ['民法典#1127'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q44',
    query: '期间届满遇节假日顺延',
    expectedDocIds: ['民事诉讼法#92'],
    category: 'scenario',
    difficulty: 'hard',
  },
  {
    id: 'q45',
    query: '殴打他人治安处罚',
    expectedDocIds: ['治安管理处罚法#43'],
    category: 'scenario',
    difficulty: 'hard',
  },

  // ===== multi_result（5 题）：多结果查询 =====
  {
    id: 'q46',
    query: '犯罪',
    expectedDocIds: ['刑法#13', '刑法#14', '刑法#15'],
    category: 'multi_result',
    difficulty: 'medium',
  },
  {
    id: 'q47',
    query: '合同',
    expectedDocIds: ['民法典#509', '民法典#577'],
    category: 'multi_result',
    difficulty: 'medium',
  },
  {
    id: 'q48',
    query: '侵权',
    expectedDocIds: ['民法典#1165', '民法典#1179'],
    category: 'multi_result',
    difficulty: 'medium',
  },
  {
    id: 'q49',
    query: '调解',
    expectedDocIds: ['民事诉讼法#122', '民法典#1079'],
    category: 'multi_result',
    difficulty: 'medium',
  },
  {
    id: 'q50',
    query: '解除劳动合同',
    expectedDocIds: ['劳动合同法#38', '劳动合同法#40'],
    category: 'multi_result',
    difficulty: 'medium',
  },
];
