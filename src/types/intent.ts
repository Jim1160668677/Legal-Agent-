/**
 * 意图识别共享类型契约（A1-W3）。
 *
 * 权威源：docs/design/07-core-algorithms.md §一（v2.3，8 意图 + 6 路由）。
 * 注：06 §八的 IntentType/RouteTarget 为 v2.0 版（6 意图/4 路由），
 *     07 v2.3 追加 case_reasoning/tool_invoke 意图与 reasoning/tool 路由，本文件以 07 为准。
 *
 * 设计依据：07 §1.1 意图枚举；07 §1.2 打分公式；06 §八 IntentResult 结构。
 */

/** 8 类法律意图（07 §1.1，v2.3） */
export type IntentType =
  | 'legal_qa' // 法律问答（法条/概念解释）
  | 'document_generate' // 文书生成（起诉状/合同/律师函）
  | 'process_guide' // 流程指引（立案/举证/起诉流程）
  | 'case_analysis' // 案件分析（能否胜诉/判多重）
  | 'case_reasoning' // 案件推理（v2.3，IRAC 推理/相似案例）
  | 'material_checklist' // 材料清单（离婚/立案需带材料）
  | 'tool_invoke' // 工具调用（v2.2，期间计算/赔偿/量刑/案由/法条效力）
  | 'general_qa'; // 兜底通用问答

/** 6 类路由目标（07 §1.1，v2.3 追加 tool/reasoning） */
export type RouteTarget =
  | 'rule' // 规则层（法条/FAQ 精确匹配）
  | 'knowledge' // 知识库（结构化流程/材料）
  | 'llm' // LLM 生成
  | 'tool' // 工具 Agent（v2.2）
  | 'reasoning' // 推理 Agent（v2.3）
  | 'general_qa'; // 兜底

/** 意图识别结果（06 §八 IntentResult + 07 §1.2 toolId 扩展） */
export interface IntentResult {
  intent: IntentType;
  /** 置信度 0..1 */
  confidence: number;
  route: RouteTarget;
  /** 是否走了兜底（无任何命中或 LLM 不可用） */
  fallbackUsed: boolean;
  matchedKeywords: string[];
  matchedPatterns: string[];
  /**
   * v2.3：tool_invoke 意图命中时携带工具 ID 提示，
   * 供 OrchestratorAgent 直接调用对应工具（07 §1.2）。
   * 其他意图为 undefined。
   */
  toolId?: string;
  /** 候选意图 top3（置信度 0.5-0.8 区间供 LLM 辅助参考） */
  candidates?: IntentType[];
}

/** 意图定义库条目结构（07 §1.2，对应 data/legalIntents.ts） */
export interface IntentDef {
  intent: IntentType;
  route: RouteTarget;
  /** 关键词及其权重 weight ∈ (0,1] */
  keywords: { word: string; weight: number }[];
  /** 正则模式及其权重 */
  patterns: { regex: string; weight: number }[];
  /** 领域提示（category 强约束过滤用） */
  categoryHints?: string[];
  /**
   * tool_invoke 专用：关键词 → toolId 映射（07 §1.2）。
   * 命中某关键词时推断对应工具 ID。
   */
  toolIdMap?: Record<string, string>;
}

/** 内部打分排名结果 */
export interface IntentRanked {
  intent: IntentType;
  score: number;
  matchedKw: string[];
  matchedPat: string[];
}
