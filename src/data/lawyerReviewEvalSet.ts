/**
 * 律师审核评测金标集（v2.3 阶段十，17 §2-§6 验收）。
 *
 * 覆盖律师审核五合一闭环 6 大维度：
 *   1. sampling：抽样策略（高风险 100% / 用户标记 100% / 普通 5%）
 *   2. state_machine：状态机流转合法性（pending→claimed→reviewing→submitted→reflowed）
 *   3. auto_score：自动评分算法（citationSuccessRate / reasoningCompleteness / disclaimerCoverage）
 *   4. lawyer_score：律师评分聚合（四维平均 + 等级判定）
 *   5. compliance：合规风险三路评分（ContentSafety / 律师标记 / 引用失败率）
 *   6. reflow：标注回流（4 目标触发条件 + 去重）
 *
 * 设计原则：
 *   - 每条用例含 id / category / difficulty / input / expected
 *   - input 为最小可执行输入，不依赖 DB
 *   - expected 为可机器判定的标量或结构
 *
 * 验收标准（17 §十）：
 *   - sampling 准确率 ≥ 0.95
 *   - state_machine 准确率 ≥ 0.95
 *   - auto_score 误差 ≤ 0.05（保留两位小数）
 *   - lawyer_score 误差 ≤ 0.05
 *   - compliance 准确率 ≥ 0.95
 *   - reflow 目标命中准确率 ≥ 0.90
 */
import type { IntentType } from '../types/intent';

// ===== 1. 抽样策略用例（17 §2.3）=====

export interface SamplingEvalItem {
  id: string;
  category: 'sampling';
  difficulty: 'easy' | 'medium' | 'hard';
  input: {
    msgId: string;
    userId: string;
    intent: IntentType;
    userFlagged: boolean;
    /** 控制 Math.random 返回值（仅 normal 用例生效） */
    randomValue?: number;
  };
  expected: {
    sampled: boolean;
    riskLevel: 'high' | 'normal' | 'user_flagged';
  };
}

// ===== 2. 状态机用例（17 §2.2）=====

export interface StateMachineEvalItem {
  id: string;
  category: 'state_machine';
  difficulty: 'easy' | 'medium' | 'hard';
  input: {
    /** 初始状态（评测前预置） */
    initialState: 'pending' | 'claimed' | 'reviewing' | 'submitted' | 'reflowed';
    /** 预置领取人（claimed/reviewing 时） */
    initialClaimedBy?: string;
    /** 执行动作 */
    action: 'claim' | 'start' | 'submit' | 'give_up' | 'mark_reflowed';
    /** 动作入参 */
    lawyerId?: string;
    annotations?: {
      scores: { accuracy: number; completeness: number; compliance: number; usefulness: number };
      riskFlag?: 'none' | 'low' | 'high';
      reviewedBy?: string;
    };
    reflowTargets?: string[];
  };
  expected: {
    /** 期望流转后的状态；error 表示期望抛错 */
    resultState?: 'pending' | 'claimed' | 'reviewing' | 'submitted' | 'reflowed';
    /** 期望抛错的错误码（resultState 未设时生效） */
    errorCode?: number;
  };
}

// ===== 3. 自动评分类用例（17 §3.2）=====

export interface AutoScoreEvalItem {
  id: string;
  category: 'auto_score';
  difficulty: 'easy' | 'medium' | 'hard';
  input: {
    answer: string;
    trace: {
      citedLaws: Array<{ ref: string; verified: boolean }>;
      reasoningChainId?: string;
    };
    hasDisclaimer?: boolean;
  };
  expected: {
    autoScore: number;
    citationSuccessRate: number;
    reasoningCompleteness: number;
    disclaimerCoverage: number;
  };
}

// ===== 4. 律师评分类用例（17 §3.3 + §3.4）=====

export interface LawyerScoreEvalItem {
  id: string;
  category: 'lawyer_score';
  difficulty: 'easy' | 'medium' | 'hard';
  input: {
    scores: { accuracy: number; completeness: number; compliance: number; usefulness: number };
  };
  expected: {
    lawyerScore: number;
    grade: 'excellent' | 'medium' | 'poor';
  };
}

// ===== 5. 合规扫描类用例（17 §5.2 + §5.3）=====

export interface ComplianceEvalItem {
  id: string;
  category: 'compliance';
  difficulty: 'easy' | 'medium' | 'hard';
  input: {
    msgId: string;
    userId: string;
    answer: string;
    citationFailureRate?: number;
    lawyerRiskFlag?: 'none' | 'low' | 'high';
    contentSafetyResult?: { safe: boolean; reason?: string; category?: string };
  };
  expected: {
    level: 'pass' | 'warn' | 'block';
    blocked: boolean;
    /** 期望触发的路径（按 path 字段判定，不关心顺序） */
    triggerPaths: Array<'content_safety' | 'lawyer_flag' | 'citation_failure'>;
  };
}

// ===== 6. 标注回流类用例（17 §6.2）=====

export interface ReflowEvalItem {
  id: string;
  category: 'reflow';
  difficulty: 'easy' | 'medium' | 'hard';
  input: {
    intent: IntentType;
    annotations: {
      scores: { accuracy: number; completeness: number; compliance: number; usefulness: number };
      textAnnotations?: {
        citationErrors?: Array<{ lawRef: string; errorType: string; correction: string }>;
        factCorrections?: Array<{ segment: string; correction: string }>;
        reasoningFlaws?: Array<{ step: string; flaw: string; suggestion: string }>;
        generalComment?: string;
      };
      riskFlag?: 'none' | 'low' | 'high';
      reviewedBy?: string;
    };
    /** 推理链 ID（reasoning_chain 回流目标所需） */
    reasoningChainId?: string;
  };
  expected: {
    /** 期望命中的回流目标集合 */
    hitTargets: Array<'intent_eval_set' | 'reasoning_chain' | 'law_article' | 'feedback'>;
    /** 期望跳过的目标集合 */
    skippedTargets: Array<'intent_eval_set' | 'reasoning_chain' | 'law_article' | 'feedback'>;
  };
}

export type LawyerReviewEvalItem =
  | SamplingEvalItem
  | StateMachineEvalItem
  | AutoScoreEvalItem
  | LawyerScoreEvalItem
  | ComplianceEvalItem
  | ReflowEvalItem;

export const LAWYER_REVIEW_EVAL_VERSION = 1;

// ===== 抽样策略用例（12 条）=====

export const SAMPLING_EVAL_SET: SamplingEvalItem[] = [
  // 高风险意图 100% 入审（4 条）
  {
    id: 's01',
    category: 'sampling',
    difficulty: 'easy',
    input: { msgId: 'm01', userId: 'u01', intent: 'case_reasoning', userFlagged: false },
    expected: { sampled: true, riskLevel: 'high' },
  },
  {
    id: 's02',
    category: 'sampling',
    difficulty: 'easy',
    input: { msgId: 'm02', userId: 'u01', intent: 'document_generate', userFlagged: false },
    expected: { sampled: true, riskLevel: 'high' },
  },
  {
    id: 's03',
    category: 'sampling',
    difficulty: 'medium',
    input: { msgId: 'm03', userId: 'u02', intent: 'case_reasoning', userFlagged: true },
    // userFlagged 优先于高风险
    expected: { sampled: true, riskLevel: 'user_flagged' },
  },
  {
    id: 's04',
    category: 'sampling',
    difficulty: 'medium',
    input: { msgId: 'm04', userId: 'u02', intent: 'document_generate', userFlagged: false },
    expected: { sampled: true, riskLevel: 'high' },
  },
  // 用户标记 100% 入审（2 条）
  {
    id: 's05',
    category: 'sampling',
    difficulty: 'easy',
    input: { msgId: 'm05', userId: 'u03', intent: 'legal_qa', userFlagged: true },
    expected: { sampled: true, riskLevel: 'user_flagged' },
  },
  {
    id: 's06',
    category: 'sampling',
    difficulty: 'easy',
    input: { msgId: 'm06', userId: 'u03', intent: 'general_qa', userFlagged: true },
    expected: { sampled: true, riskLevel: 'user_flagged' },
  },
  // 普通意图 5% 随机（6 条，覆盖随机命中与未命中）
  {
    id: 's07',
    category: 'sampling',
    difficulty: 'medium',
    input: {
      msgId: 'm07',
      userId: 'u04',
      intent: 'legal_qa',
      userFlagged: false,
      randomValue: 0.01,
    },
    expected: { sampled: true, riskLevel: 'normal' },
  },
  {
    id: 's08',
    category: 'sampling',
    difficulty: 'medium',
    input: {
      msgId: 'm08',
      userId: 'u04',
      intent: 'legal_qa',
      userFlagged: false,
      randomValue: 0.04,
    },
    expected: { sampled: true, riskLevel: 'normal' },
  },
  {
    id: 's09',
    category: 'sampling',
    difficulty: 'medium',
    input: {
      msgId: 'm09',
      userId: 'u04',
      intent: 'general_qa',
      userFlagged: false,
      randomValue: 0.06,
    },
    expected: { sampled: false, riskLevel: 'normal' },
  },
  {
    id: 's10',
    category: 'sampling',
    difficulty: 'medium',
    input: {
      msgId: 'm10',
      userId: 'u05',
      intent: 'process_guide',
      userFlagged: false,
      randomValue: 0.5,
    },
    expected: { sampled: false, riskLevel: 'normal' },
  },
  {
    id: 's11',
    category: 'sampling',
    difficulty: 'hard',
    input: {
      msgId: 'm11',
      userId: 'u05',
      intent: 'case_analysis',
      userFlagged: false,
      randomValue: 0.049,
    },
    // case_analysis 非高风险意图，走 normal 抽样
    expected: { sampled: true, riskLevel: 'normal' },
  },
  {
    id: 's12',
    category: 'sampling',
    difficulty: 'hard',
    input: {
      msgId: 'm12',
      userId: 'u05',
      intent: 'material_checklist',
      userFlagged: false,
      randomValue: 0.051,
    },
    expected: { sampled: false, riskLevel: 'normal' },
  },
];

// ===== 状态机用例（12 条）=====

export const STATE_MACHINE_EVAL_SET: StateMachineEvalItem[] = [
  // 合法流转（5 条，覆盖完整生命周期）
  {
    id: 'sm01',
    category: 'state_machine',
    difficulty: 'easy',
    input: {
      initialState: 'pending',
      action: 'claim',
      lawyerId: 'lawyer-A',
    },
    expected: { resultState: 'claimed' },
  },
  {
    id: 'sm02',
    category: 'state_machine',
    difficulty: 'easy',
    input: {
      initialState: 'claimed',
      initialClaimedBy: 'lawyer-A',
      action: 'start',
      lawyerId: 'lawyer-A',
    },
    expected: { resultState: 'reviewing' },
  },
  {
    id: 'sm03',
    category: 'state_machine',
    difficulty: 'easy',
    input: {
      initialState: 'reviewing',
      initialClaimedBy: 'lawyer-A',
      action: 'submit',
      lawyerId: 'lawyer-A',
      annotations: {
        scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
        riskFlag: 'none',
        reviewedBy: 'lawyer-A',
      },
    },
    expected: { resultState: 'submitted' },
  },
  {
    id: 'sm04',
    category: 'state_machine',
    difficulty: 'easy',
    input: {
      initialState: 'submitted',
      action: 'mark_reflowed',
      reflowTargets: ['intent_eval_set', 'feedback'],
    },
    expected: { resultState: 'reflowed' },
  },
  {
    id: 'sm05',
    category: 'state_machine',
    difficulty: 'easy',
    input: {
      initialState: 'reviewing',
      initialClaimedBy: 'lawyer-A',
      action: 'give_up',
      lawyerId: 'lawyer-A',
    },
    expected: { resultState: 'pending' },
  },
  // 非法流转（4 条）
  {
    id: 'sm06',
    category: 'state_machine',
    difficulty: 'medium',
    input: {
      initialState: 'pending',
      action: 'start',
      lawyerId: 'lawyer-A',
    },
    // pending 不能直接 start，必须先 claim
    expected: { errorCode: 8021 },
  },
  {
    id: 'sm07',
    category: 'state_machine',
    difficulty: 'medium',
    input: {
      initialState: 'claimed',
      initialClaimedBy: 'lawyer-A',
      action: 'submit',
      lawyerId: 'lawyer-A',
      annotations: {
        scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
      },
    },
    // claimed 不能直接 submit，必须先 reviewing
    expected: { errorCode: 8021 },
  },
  {
    id: 'sm08',
    category: 'state_machine',
    difficulty: 'hard',
    input: {
      initialState: 'submitted',
      action: 'claim',
      lawyerId: 'lawyer-B',
    },
    // submitted 不能再 claim
    expected: { errorCode: 8021 },
  },
  {
    id: 'sm09',
    category: 'state_machine',
    difficulty: 'hard',
    input: {
      initialState: 'reflowed',
      action: 'submit',
      lawyerId: 'lawyer-A',
      annotations: {
        scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
      },
    },
    // reflowed 是终态
    expected: { errorCode: 8021 },
  },
  // 跨律师抢占（2 条）
  {
    id: 'sm10',
    category: 'state_machine',
    difficulty: 'hard',
    input: {
      initialState: 'claimed',
      initialClaimedBy: 'lawyer-A',
      action: 'start',
      lawyerId: 'lawyer-B',
    },
    // 律师 B 不能开始律师 A 领取的审核（8021 非法流转/越权）
    expected: { errorCode: 8021 },
  },
  {
    id: 'sm11',
    category: 'state_machine',
    difficulty: 'hard',
    input: {
      initialState: 'reviewing',
      initialClaimedBy: 'lawyer-A',
      action: 'give_up',
      lawyerId: 'lawyer-B',
    },
    expected: { errorCode: 8021 },
  },
  // 非法评分（1 条）
  {
    id: 'sm12',
    category: 'state_machine',
    difficulty: 'medium',
    input: {
      initialState: 'reviewing',
      initialClaimedBy: 'lawyer-A',
      action: 'submit',
      lawyerId: 'lawyer-A',
      annotations: {
        scores: { accuracy: 6, completeness: 4, compliance: 5, usefulness: 4 },
      },
    },
    // accuracy=6 超出 1-5 范围（8022 评分维度非法）
    expected: { errorCode: 8022 },
  },
];

// ===== 自动评分类用例（10 条）=====

export const AUTO_SCORE_EVAL_SET: AutoScoreEvalItem[] = [
  // 全满分场景
  {
    id: 'as01',
    category: 'auto_score',
    difficulty: 'easy',
    input: {
      answer: '根据民法典，免责声明：本回答仅供参考',
      trace: {
        citedLaws: [
          { ref: '民法典#143', verified: true },
          { ref: '民法典#188', verified: true },
        ],
        reasoningChainId: 'rc_001',
      },
      hasDisclaimer: true,
    },
    // 5 * (0.5*1 + 0.3*1 + 0.2*1) = 5.0
    expected: {
      autoScore: 5.0,
      citationSuccessRate: 1.0,
      reasoningCompleteness: 1.0,
      disclaimerCoverage: 1.0,
    },
  },
  // 全零分场景
  {
    id: 'as02',
    category: 'auto_score',
    difficulty: 'easy',
    input: {
      answer: '不知道',
      trace: {
        citedLaws: [{ ref: 'X', verified: false }],
      },
      hasDisclaimer: false,
    },
    // 5 * (0.5*0 + 0.3*0.6 + 0.2*0) = 0.9
    expected: {
      autoScore: 0.9,
      citationSuccessRate: 0.0,
      reasoningCompleteness: 0.6,
      disclaimerCoverage: 0.0,
    },
  },
  // 部分引用成功
  {
    id: 'as03',
    category: 'auto_score',
    difficulty: 'medium',
    input: {
      answer: '回答',
      trace: {
        citedLaws: [
          { ref: 'A', verified: true },
          { ref: 'B', verified: false },
          { ref: 'C', verified: true },
          { ref: 'D', verified: false },
        ],
      },
      hasDisclaimer: true,
    },
    // citation=0.5, reasoning=0.6, disclaimer=1
    // 5 * (0.5*0.5 + 0.3*0.6 + 0.2*1) = 5 * (0.25+0.18+0.2) = 5*0.63 = 3.15
    expected: {
      autoScore: 3.15,
      citationSuccessRate: 0.5,
      reasoningCompleteness: 0.6,
      disclaimerCoverage: 1.0,
    },
  },
  // 无引用法条
  {
    id: 'as04',
    category: 'auto_score',
    difficulty: 'medium',
    input: {
      answer: '回答',
      trace: { citedLaws: [] },
      hasDisclaimer: true,
    },
    // citation=0, reasoning=0.6, disclaimer=1
    // 5 * (0 + 0.18 + 0.2) = 1.9
    expected: {
      autoScore: 1.9,
      citationSuccessRate: 0.0,
      reasoningCompleteness: 0.6,
      disclaimerCoverage: 1.0,
    },
  },
  // 有推理链但无引用
  {
    id: 'as05',
    category: 'auto_score',
    difficulty: 'medium',
    input: {
      answer: '回答',
      trace: { citedLaws: [], reasoningChainId: 'rc_002' },
      hasDisclaimer: true,
    },
    // citation=0, reasoning=1, disclaimer=1
    // 5 * (0 + 0.3 + 0.2) = 2.5
    expected: {
      autoScore: 2.5,
      citationSuccessRate: 0.0,
      reasoningCompleteness: 1.0,
      disclaimerCoverage: 1.0,
    },
  },
  // 全部引用失败但有推理链与免责
  {
    id: 'as06',
    category: 'auto_score',
    difficulty: 'hard',
    input: {
      answer: '回答',
      trace: {
        citedLaws: [
          { ref: 'A', verified: false },
          { ref: 'B', verified: false },
        ],
        reasoningChainId: 'rc_003',
      },
      hasDisclaimer: true,
    },
    // citation=0, reasoning=1, disclaimer=1
    // 5 * (0 + 0.3 + 0.2) = 2.5
    expected: {
      autoScore: 2.5,
      citationSuccessRate: 0.0,
      reasoningCompleteness: 1.0,
      disclaimerCoverage: 1.0,
    },
  },
  // 全部引用成功但无推理链无免责
  {
    id: 'as07',
    category: 'auto_score',
    difficulty: 'hard',
    input: {
      answer: '回答',
      trace: {
        citedLaws: [{ ref: 'A', verified: true }],
      },
      hasDisclaimer: false,
    },
    // citation=1, reasoning=0.6, disclaimer=0
    // 5 * (0.5 + 0.18 + 0) = 3.4
    expected: {
      autoScore: 3.4,
      citationSuccessRate: 1.0,
      reasoningCompleteness: 0.6,
      disclaimerCoverage: 0.0,
    },
  },
  // 免责声明文本识别（hasDisclaimer 未显式传入）
  {
    id: 'as08',
    category: 'auto_score',
    difficulty: 'hard',
    input: {
      answer: '本回答不构成法律意见，仅供参考',
      trace: {
        citedLaws: [{ ref: 'A', verified: true }],
        reasoningChainId: 'rc_004',
      },
    },
    // citation=1, reasoning=1, disclaimer=1（文本命中关键词）
    // 5 * (0.5 + 0.3 + 0.2) = 5.0
    expected: {
      autoScore: 5.0,
      citationSuccessRate: 1.0,
      reasoningCompleteness: 1.0,
      disclaimerCoverage: 1.0,
    },
  },
  // 1/3 引用成功
  {
    id: 'as09',
    category: 'auto_score',
    difficulty: 'medium',
    input: {
      answer: '回答',
      trace: {
        citedLaws: [
          { ref: 'A', verified: true },
          { ref: 'B', verified: false },
          { ref: 'C', verified: false },
        ],
        reasoningChainId: 'rc_005',
      },
      hasDisclaimer: true,
    },
    // citation=1/3, reasoning=1, disclaimer=1
    // 5 * (0.5/3 + 0.3 + 0.2) = 5 * (0.16667+0.3+0.2) = 5*0.66667 = 3.33
    expected: {
      autoScore: 3.33,
      citationSuccessRate: 0.33,
      reasoningCompleteness: 1.0,
      disclaimerCoverage: 1.0,
    },
  },
  // 全部成功无推理链有免责
  {
    id: 'as10',
    category: 'auto_score',
    difficulty: 'medium',
    input: {
      answer: '回答',
      trace: {
        citedLaws: [
          { ref: 'A', verified: true },
          { ref: 'B', verified: true },
        ],
      },
      hasDisclaimer: true,
    },
    // citation=1, reasoning=0.6, disclaimer=1
    // 5 * (0.5 + 0.18 + 0.2) = 4.4
    expected: {
      autoScore: 4.4,
      citationSuccessRate: 1.0,
      reasoningCompleteness: 0.6,
      disclaimerCoverage: 1.0,
    },
  },
];

// ===== 律师评分类用例（8 条）=====

export const LAWYER_SCORE_EVAL_SET: LawyerScoreEvalItem[] = [
  // 全 5 分
  {
    id: 'ls01',
    category: 'lawyer_score',
    difficulty: 'easy',
    input: { scores: { accuracy: 5, completeness: 5, compliance: 5, usefulness: 5 } },
    expected: { lawyerScore: 5.0, grade: 'excellent' },
  },
  // 全 1 分
  {
    id: 'ls02',
    category: 'lawyer_score',
    difficulty: 'easy',
    input: { scores: { accuracy: 1, completeness: 1, compliance: 1, usefulness: 1 } },
    expected: { lawyerScore: 1.0, grade: 'poor' },
  },
  // 全 3 分（中等）
  {
    id: 'ls03',
    category: 'lawyer_score',
    difficulty: 'easy',
    input: { scores: { accuracy: 3, completeness: 3, compliance: 3, usefulness: 3 } },
    expected: { lawyerScore: 3.0, grade: 'medium' },
  },
  // 边界：4.0 = 优
  {
    id: 'ls04',
    category: 'lawyer_score',
    difficulty: 'medium',
    input: { scores: { accuracy: 4, completeness: 4, compliance: 4, usefulness: 4 } },
    expected: { lawyerScore: 4.0, grade: 'excellent' },
  },
  // 边界：3.99 = 中
  {
    id: 'ls05',
    category: 'lawyer_score',
    difficulty: 'hard',
    input: { scores: { accuracy: 5, completeness: 4, compliance: 3, usefulness: 4 } },
    // (5+4+3+4)/4 = 4.0
    expected: { lawyerScore: 4.0, grade: 'excellent' },
  },
  // 边界：2.5 = 中
  {
    id: 'ls06',
    category: 'lawyer_score',
    difficulty: 'hard',
    input: { scores: { accuracy: 2, completeness: 3, compliance: 3, usefulness: 2 } },
    // (2+3+3+2)/4 = 2.5
    expected: { lawyerScore: 2.5, grade: 'medium' },
  },
  // 边界：2.49 = 差
  {
    id: 'ls07',
    category: 'lawyer_score',
    difficulty: 'hard',
    input: { scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 } },
    // (2+2+3+2)/4 = 2.25
    expected: { lawyerScore: 2.25, grade: 'poor' },
  },
  // 混合评分
  {
    id: 'ls08',
    category: 'lawyer_score',
    difficulty: 'medium',
    input: { scores: { accuracy: 5, completeness: 4, compliance: 5, usefulness: 3 } },
    // (5+4+5+3)/4 = 4.25
    expected: { lawyerScore: 4.25, grade: 'excellent' },
  },
];

// ===== 合规扫描类用例（10 条）=====

export const COMPLIANCE_EVAL_SET: ComplianceEvalItem[] = [
  // 全 pass
  {
    id: 'c01',
    category: 'compliance',
    difficulty: 'easy',
    input: {
      msgId: 'cm01',
      userId: 'u01',
      answer: '正常回答',
      citationFailureRate: 0.1,
      lawyerRiskFlag: 'none',
    },
    expected: { level: 'pass', blocked: false, triggerPaths: [] },
  },
  // ContentSafety 命中 → block
  {
    id: 'c02',
    category: 'compliance',
    difficulty: 'easy',
    input: {
      msgId: 'cm02',
      userId: 'u01',
      answer: '违规内容',
      contentSafetyResult: { safe: false, reason: '命中违法词' },
    },
    expected: {
      level: 'block',
      blocked: true,
      triggerPaths: ['content_safety'],
    },
  },
  // 律师 high → block
  {
    id: 'c03',
    category: 'compliance',
    difficulty: 'easy',
    input: {
      msgId: 'cm03',
      userId: 'u01',
      answer: '',
      lawyerRiskFlag: 'high',
      citationFailureRate: 0,
    },
    expected: {
      level: 'block',
      blocked: true,
      triggerPaths: ['lawyer_flag'],
    },
  },
  // 引用失败率 > 60% → block
  {
    id: 'c04',
    category: 'compliance',
    difficulty: 'medium',
    input: {
      msgId: 'cm04',
      userId: 'u01',
      answer: '',
      citationFailureRate: 0.7,
      lawyerRiskFlag: 'none',
    },
    expected: {
      level: 'block',
      blocked: true,
      triggerPaths: ['citation_failure'],
    },
  },
  // 引用失败率 30%-60% → warn
  {
    id: 'c05',
    category: 'compliance',
    difficulty: 'medium',
    input: {
      msgId: 'cm05',
      userId: 'u01',
      answer: '',
      citationFailureRate: 0.45,
      lawyerRiskFlag: 'none',
    },
    expected: {
      level: 'warn',
      blocked: false,
      triggerPaths: ['citation_failure'],
    },
  },
  // 引用失败率 < 30% → pass
  {
    id: 'c06',
    category: 'compliance',
    difficulty: 'medium',
    input: {
      msgId: 'cm06',
      userId: 'u01',
      answer: '',
      citationFailureRate: 0.2,
      lawyerRiskFlag: 'none',
    },
    expected: { level: 'pass', blocked: false, triggerPaths: [] },
  },
  // 边界：30% 不触发（> 30% 才 warn）
  {
    id: 'c07',
    category: 'compliance',
    difficulty: 'hard',
    input: {
      msgId: 'cm07',
      userId: 'u01',
      answer: '',
      citationFailureRate: 0.3,
      lawyerRiskFlag: 'none',
    },
    expected: { level: 'pass', blocked: false, triggerPaths: [] },
  },
  // 边界：60% 不触发 block（> 60% 才 block，但 60% 触发 warn）
  {
    id: 'c08',
    category: 'compliance',
    difficulty: 'hard',
    input: {
      msgId: 'cm08',
      userId: 'u01',
      answer: '',
      citationFailureRate: 0.6,
      lawyerRiskFlag: 'none',
    },
    expected: {
      level: 'warn',
      blocked: false,
      triggerPaths: ['citation_failure'],
    },
  },
  // 多触发：ContentSafety + 律师 high
  {
    id: 'c09',
    category: 'compliance',
    difficulty: 'hard',
    input: {
      msgId: 'cm09',
      userId: 'u01',
      answer: '违规',
      contentSafetyResult: { safe: false, reason: '违法词' },
      lawyerRiskFlag: 'high',
      citationFailureRate: 0.8,
    },
    expected: {
      level: 'block',
      blocked: true,
      triggerPaths: ['content_safety', 'lawyer_flag', 'citation_failure'],
    },
  },
  // 律师 low 不触发 block
  {
    id: 'c10',
    category: 'compliance',
    difficulty: 'medium',
    input: {
      msgId: 'cm10',
      userId: 'u01',
      answer: '',
      lawyerRiskFlag: 'low',
      citationFailureRate: 0.1,
    },
    expected: { level: 'pass', blocked: false, triggerPaths: [] },
  },
];

// ===== 标注回流类用例（10 条）=====

export const REFLOW_EVAL_SET: ReflowEvalItem[] = [
  // case_reasoning + reasoningFlaws + generalComment → 命中 eval_set + reasoning_chain + feedback
  {
    id: 'r01',
    category: 'reflow',
    difficulty: 'medium',
    input: {
      intent: 'case_reasoning',
      annotations: {
        scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 },
        textAnnotations: {
          reasoningFlaws: [{ step: 'application', flaw: '要件遗漏', suggestion: '补充要件分析' }],
          generalComment: '推理过程不完整',
        },
        riskFlag: 'high',
        reviewedBy: 'lawyer-A',
      },
      reasoningChainId: 'rc_001',
    },
    expected: {
      hitTargets: ['intent_eval_set', 'reasoning_chain', 'feedback'],
      skippedTargets: ['law_article'],
    },
  },
  // citationErrors → 命中 law_article
  {
    id: 'r02',
    category: 'reflow',
    difficulty: 'easy',
    input: {
      intent: 'legal_qa',
      annotations: {
        scores: { accuracy: 3, completeness: 3, compliance: 3, usefulness: 3 },
        textAnnotations: {
          citationErrors: [
            { lawRef: '民法典#143', errorType: 'wrong_article', correction: '应为第144条' },
          ],
        },
        riskFlag: 'low',
        reviewedBy: 'lawyer-A',
      },
    },
    expected: {
      hitTargets: ['law_article'],
      skippedTargets: ['intent_eval_set', 'reasoning_chain', 'feedback'],
    },
  },
  // generalComment → 命中 feedback
  {
    id: 'r03',
    category: 'reflow',
    difficulty: 'easy',
    input: {
      intent: 'legal_qa',
      annotations: {
        scores: { accuracy: 4, completeness: 4, compliance: 4, usefulness: 4 },
        textAnnotations: { generalComment: '回答准确' },
        riskFlag: 'none',
        reviewedBy: 'lawyer-A',
      },
    },
    expected: {
      hitTargets: ['feedback'],
      skippedTargets: ['intent_eval_set', 'reasoning_chain', 'law_article'],
    },
  },
  // factCorrections → 命中 feedback
  {
    id: 'r04',
    category: 'reflow',
    difficulty: 'medium',
    input: {
      intent: 'legal_qa',
      annotations: {
        scores: { accuracy: 3, completeness: 3, compliance: 3, usefulness: 3 },
        textAnnotations: {
          factCorrections: [{ segment: '原句', correction: '订正' }],
        },
        riskFlag: 'none',
        reviewedBy: 'lawyer-A',
      },
    },
    expected: {
      hitTargets: ['feedback'],
      skippedTargets: ['intent_eval_set', 'reasoning_chain', 'law_article'],
    },
  },
  // case_reasoning + reasoningFlaws 但无 reasoningChainId → 命中 eval_set + feedback，跳过 reasoning_chain
  {
    id: 'r05',
    category: 'reflow',
    difficulty: 'hard',
    input: {
      intent: 'case_reasoning',
      annotations: {
        scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 },
        textAnnotations: {
          reasoningFlaws: [{ step: 'rule', flaw: '法条引用错误', suggestion: '更换法条' }],
          generalComment: '法条引用错误',
        },
        riskFlag: 'high',
        reviewedBy: 'lawyer-A',
      },
      // 无 reasoningChainId
    },
    expected: {
      hitTargets: ['intent_eval_set', 'feedback'],
      skippedTargets: ['reasoning_chain', 'law_article'],
    },
  },
  // 无任何标注 → 全跳过
  {
    id: 'r06',
    category: 'reflow',
    difficulty: 'easy',
    input: {
      intent: 'legal_qa',
      annotations: {
        scores: { accuracy: 5, completeness: 5, compliance: 5, usefulness: 5 },
        riskFlag: 'none',
        reviewedBy: 'lawyer-A',
      },
    },
    expected: {
      hitTargets: [],
      skippedTargets: ['intent_eval_set', 'reasoning_chain', 'law_article', 'feedback'],
    },
  },
  // case_reasoning 但非推理缺陷 → 命中 feedback（若有 comment），跳过 eval_set
  {
    id: 'r07',
    category: 'reflow',
    difficulty: 'hard',
    input: {
      intent: 'case_reasoning',
      annotations: {
        scores: { accuracy: 4, completeness: 4, compliance: 4, usefulness: 4 },
        textAnnotations: { generalComment: '整体良好' },
        riskFlag: 'none',
        reviewedBy: 'lawyer-A',
      },
      reasoningChainId: 'rc_007',
    },
    expected: {
      hitTargets: ['feedback'],
      skippedTargets: ['intent_eval_set', 'reasoning_chain', 'law_article'],
    },
  },
  // 全维度命中（case_reasoning + flaws + errors + comment + chain）
  {
    id: 'r08',
    category: 'reflow',
    difficulty: 'hard',
    input: {
      intent: 'case_reasoning',
      annotations: {
        scores: { accuracy: 1, completeness: 1, compliance: 2, usefulness: 1 },
        textAnnotations: {
          reasoningFlaws: [{ step: 'conclusion', flaw: '结论错误', suggestion: '修正' }],
          citationErrors: [{ lawRef: '刑法#20', errorType: 'invalid', correction: '已失效' }],
          factCorrections: [{ segment: '原句', correction: '订正' }],
          generalComment: '多处错误',
        },
        riskFlag: 'high',
        reviewedBy: 'lawyer-A',
      },
      reasoningChainId: 'rc_008',
    },
    expected: {
      hitTargets: ['intent_eval_set', 'reasoning_chain', 'law_article', 'feedback'],
      skippedTargets: [],
    },
  },
  // document_generate 意图 + reasoningFlaws → 跳过 intent_eval_set（仅 case_reasoning 命中）
  {
    id: 'r09',
    category: 'reflow',
    difficulty: 'hard',
    input: {
      intent: 'document_generate',
      annotations: {
        scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 },
        textAnnotations: {
          reasoningFlaws: [{ step: 'rule', flaw: 'flaw', suggestion: 'sug' }],
        },
        riskFlag: 'low',
        reviewedBy: 'lawyer-A',
      },
      reasoningChainId: 'rc_009',
    },
    expected: {
      hitTargets: ['reasoning_chain'],
      skippedTargets: ['intent_eval_set', 'law_article', 'feedback'],
    },
  },
  // 仅 citationErrors + case_reasoning → 命中 law_article（eval_set 需要 reasoningFlaws）
  {
    id: 'r10',
    category: 'reflow',
    difficulty: 'medium',
    input: {
      intent: 'case_reasoning',
      annotations: {
        scores: { accuracy: 3, completeness: 3, compliance: 3, usefulness: 3 },
        textAnnotations: {
          citationErrors: [{ lawRef: 'A', errorType: 'wrong', correction: 'B' }],
        },
        riskFlag: 'none',
        reviewedBy: 'lawyer-A',
      },
      reasoningChainId: 'rc_010',
    },
    expected: {
      hitTargets: ['law_article'],
      skippedTargets: ['intent_eval_set', 'reasoning_chain', 'feedback'],
    },
  },
];

/** 全量评测集 */
export const LAWYER_REVIEW_EVAL_SET: LawyerReviewEvalItem[] = [
  ...SAMPLING_EVAL_SET,
  ...STATE_MACHINE_EVAL_SET,
  ...AUTO_SCORE_EVAL_SET,
  ...LAWYER_SCORE_EVAL_SET,
  ...COMPLIANCE_EVAL_SET,
  ...REFLOW_EVAL_SET,
];
