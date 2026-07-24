/**
 * 意图定义库（A1-W3）。
 *
 * 权威源：docs/design/07-core-algorithms.md §1.1-1.2（v2.3，8 意图）。
 * 用途：IntentRouter 打分的关键词 + 正则模式来源。
 *
 * 权重约定：
 *   - 强唯一关键词（仅出现在单一意图）：0.8-1.0
 *   - 中等关键词：0.5-0.7
 *   - 弱共享关键词（跨意图出现，靠 idf 拉开差距）：0.3-0.5
 *
 * idf 由 IntentRouter 启动时按 df(kw)=含该词意图数 计算（07 §1.2），
 * 因此跨意图共享词会被自动降权，无需在此手工规避。
 *
 * toolIdMap（tool_invoke 专用）：命中关键词 → 工具 ID，供 OrchestratorAgent 直调（07 §1.2）。
 */
import type { IntentDef } from '../types/intent';

export const INTENT_DEFS: IntentDef[] = [
  // 1. legal_qa —— 法律问答，法条/概念解释，路由 rule/knowledge
  {
    intent: 'legal_qa',
    route: 'rule',
    categoryHints: ['民法', '刑法', '行政法', '程序法'],
    keywords: [
      { word: '诉讼时效', weight: 1.0 },
      { word: '正当防卫', weight: 1.0 },
      { word: '法条', weight: 0.6 },
      { word: '条文', weight: 0.6 },
      { word: '法律规定', weight: 0.7 },
      { word: '法律条文', weight: 0.8 },
      { word: '民法典', weight: 0.6 },
      { word: '刑法', weight: 0.6 },
      { word: '是什么', weight: 0.4 },
      { word: '什么是', weight: 0.4 },
      { word: '什么叫', weight: 0.4 },
      { word: '什么意思', weight: 0.4 },
      { word: '解释一下', weight: 0.4 },
      { word: '是指', weight: 0.4 },
      { word: '怎么理解', weight: 0.4 },
      { word: '不可抗力', weight: 0.6 },
    ],
    patterns: [
      { regex: '《[^》]{1,12}法》', weight: 0.7 },
      { regex: '第[零一二三四五六七八九十百千万0-9]+条.{0,4}规定', weight: 0.8 },
    ],
  },

  // 2. document_generate —— 文书生成，路由 llm
  {
    intent: 'document_generate',
    route: 'llm',
    categoryHints: ['文书', '合同', '诉讼文书'],
    keywords: [
      { word: '起诉状', weight: 1.0 },
      { word: '答辩状', weight: 1.0 },
      { word: '律师函', weight: 1.0 },
      { word: '协议书', weight: 0.9 },
      { word: '遗嘱', weight: 0.9 },
      { word: '委托书', weight: 0.9 },
      { word: '合同模板', weight: 0.9 },
      { word: '合同', weight: 0.6 },
      { word: '协议', weight: 0.5 },
      { word: '模板', weight: 0.7 },
      { word: '起草', weight: 0.8 },
      { word: '帮我写', weight: 0.8 },
      { word: '写一份', weight: 0.7 },
      { word: '生成', weight: 0.5 },
      { word: '代书', weight: 0.8 },
    ],
    patterns: [
      { regex: '(帮我|请|麻烦|能不能|可以).{0,4}(写|起草|生成|代写)', weight: 0.9 },
      { regex: '(起诉状|答辩状|律师函|协议书|遗嘱|委托书|授权书)', weight: 0.9 },
    ],
  },

  // 3. process_guide —— 流程指引，路由 knowledge
  {
    intent: 'process_guide',
    route: 'knowledge',
    categoryHints: ['程序', '流程'],
    keywords: [
      { word: '立案流程', weight: 1.0 },
      { word: '起诉流程', weight: 1.0 },
      { word: '流程', weight: 0.7 },
      { word: '程序', weight: 0.6 },
      { word: '步骤', weight: 0.6 },
      { word: '怎么起诉', weight: 0.9 },
      { word: '怎么立案', weight: 0.9 },
      { word: '怎么举证', weight: 0.8 },
      { word: '怎么办', weight: 0.5 },
      { word: '举证', weight: 0.6 },
      { word: '开庭', weight: 0.6 },
      { word: '审理', weight: 0.5 },
      { word: '一审', weight: 0.5 },
      { word: '二审', weight: 0.5 },
      { word: '上诉', weight: 0.6 },
    ],
    patterns: [
      { regex: '怎么.{0,4}(办|起诉|立案|举证|上诉|打官司)', weight: 0.8 },
      { regex: '(立案|起诉|诉讼|审判|执行).{0,2}(流程|程序|步骤)', weight: 0.8 },
    ],
  },

  // 4. case_analysis —— 案件分析（能否胜诉/判多重），路由 llm
  {
    intent: 'case_analysis',
    route: 'llm',
    categoryHints: ['案件', '诉讼'],
    keywords: [
      { word: '能赢吗', weight: 0.9 },
      { word: '能胜诉吗', weight: 0.9 },
      { word: '胜诉', weight: 0.7 },
      { word: '败诉', weight: 0.7 },
      { word: '这个案子', weight: 0.7 },
      { word: '我的案子', weight: 0.7 },
      { word: '案子', weight: 0.5 },
      { word: '有多大把握', weight: 0.9 },
      { word: '有把握', weight: 0.7 },
      { word: '胜算', weight: 0.8 },
      { word: '能告赢', weight: 0.8 },
      { word: '能告倒', weight: 0.7 },
    ],
    patterns: [{ regex: '(能|可以|有没有).{0,4}(赢|胜诉|把握|胜算)', weight: 0.9 }],
  },

  // 5. case_reasoning —— 案件推理（v2.3，IRAC/相似案例），路由 reasoning
  {
    intent: 'case_reasoning',
    route: 'reasoning',
    categoryHints: ['推理', '类案'],
    keywords: [
      { word: '相似案例', weight: 1.0 },
      { word: '类似案例', weight: 1.0 },
      { word: '类案', weight: 0.9 },
      { word: '同类案件', weight: 0.9 },
      { word: '判例', weight: 0.8 },
      { word: '案例', weight: 0.5 },
      { word: '怎么辩护', weight: 0.8 },
      { word: '辩护策略', weight: 0.9 },
      { word: '法律推理', weight: 0.9 },
      { word: '案件分析', weight: 0.7 },
      { word: '怎么定罪', weight: 0.8 },
      // 词干补充：覆盖"分析案件"/"辩护要点"/"案件推理"/"类似情况"/"裁判要旨"等变体
      // case_analysis 用"案子"而非"案件"，故"案件"词干无跨意图冲突
      { word: '辩护', weight: 0.5 },
      { word: '推理', weight: 0.6 },
      { word: '类似', weight: 0.5 },
      { word: '同类', weight: 0.5 },
      { word: '裁判', weight: 0.5 },
      { word: '案件', weight: 0.4 },
    ],
    patterns: [
      { regex: '(相似|类似|同类).{0,2}(案例|案件|判例)', weight: 1.0 },
      { regex: '怎么.{0,4}辩护', weight: 0.8 },
    ],
  },

  // 6. material_checklist —— 材料清单，路由 knowledge
  {
    intent: 'material_checklist',
    route: 'knowledge',
    categoryHints: ['材料', '清单'],
    keywords: [
      { word: '需要什么材料', weight: 1.0 },
      { word: '要带什么', weight: 0.9 },
      { word: '要带啥', weight: 0.9 },
      { word: '准备什么', weight: 0.8 },
      { word: '材料清单', weight: 1.0 },
      { word: '材料', weight: 0.7 },
      { word: '清单', weight: 0.7 },
      { word: '证件', weight: 0.6 },
      { word: '证明材料', weight: 0.7 },
      { word: '起诉需要', weight: 0.8 },
      { word: '立案需要', weight: 0.8 },
      { word: '离婚需要', weight: 0.8 },
    ],
    patterns: [
      {
        regex: '(需要|要带|准备|得带).{0,4}(什么|哪些|啥).{0,4}(材料|证件|证明|东西)',
        weight: 1.0,
      },
      { regex: '(离婚|立案|起诉|诉讼).{0,4}需要.{0,4}(什么|哪些)', weight: 0.8 },
    ],
  },

  // 7. tool_invoke —— 工具调用（v2.2），路由 tool
  {
    intent: 'tool_invoke',
    route: 'tool',
    categoryHints: ['工具', '计算'],
    keywords: [
      { word: '期间计算', weight: 1.0 },
      { word: '期限', weight: 0.7 },
      { word: '赔偿标准', weight: 1.0 },
      { word: '赔偿金额', weight: 1.0 },
      { word: '赔偿计算', weight: 1.0 },
      { word: '量刑', weight: 1.0 },
      { word: '判几年', weight: 0.7 },
      { word: '案由', weight: 0.9 },
      { word: '法条效力', weight: 1.0 },
      { word: '现行有效', weight: 0.9 },
      { word: '证照识别', weight: 1.0 },
      { word: '营业执照', weight: 0.8 },
      { word: '文书审核', weight: 1.0 },
      { word: '计算', weight: 0.4 },
    ],
    patterns: [
      { regex: '计算.{0,4}(期间|期限|时间)', weight: 0.9 },
      { regex: '审核.{0,4}文书', weight: 0.9 },
      { regex: '赔偿.{0,4}(多少|标准|金额|计算)', weight: 0.9 },
    ],
    toolIdMap: {
      期间计算: 'period_calculator',
      期限: 'period_calculator',
      赔偿标准: 'compensation_query',
      赔偿金额: 'compensation_query',
      赔偿计算: 'compensation_query',
      量刑: 'sentencing_guide',
      判几年: 'sentencing_guide',
      案由: 'cause_classifier',
      法条效力: 'law_validity_query',
      现行有效: 'law_validity_query',
      证照识别: 'ocr_recognizer',
      营业执照: 'ocr_recognizer',
      文书审核: 'document_reviewer',
    },
  },

  // 8. general_qa —— 兜底，无关键词，由置信度 <0.5 或无命中触发
  {
    intent: 'general_qa',
    route: 'general_qa',
    keywords: [],
    patterns: [],
  },
];

/** 工具 ID 枚举（tool_invoke 命中后携带，对齐 14 各工具节） */
export const TOOL_IDS = [
  'period_calculator',
  'compensation_query',
  'sentencing_guide',
  'cause_classifier',
  'law_validity_query',
  'ocr_recognizer',
  'document_reviewer',
] as const;
