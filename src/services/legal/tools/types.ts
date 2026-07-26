/**
 * LegalTool 接口与类型契约（v2.3-W1，14-tool-design.md §二）。
 *
 * 权威源：docs/design/14-tool-design.md §二统一接口与类型。
 *
 * 设计要点：
 *   - 8 个工具统一实现 LegalTool 接口，经 ToolRegistry 注册与发现
 *   - 双模式调用：用户经 TabBar 工具 Tab 直接调用，或经 OrchestratorAgent 编排 ToolAgent 调用
 *   - 工具为纯逻辑模块，数据访问经静态内置数据 + 可选 repository 注入
 *   - 输出强制含 disclaimer + lawRefs（涉法条时）
 *   - 错误码 8001-8009 + 8019（v2.3 追加）
 *
 * 与 v2.1 Agent 的关系：
 *   - 8 工具经 ToolAgent 包装为 LegalAgent，纳入 AgentRegistry
 *   - ToolAgent 持有 8 个 capability（tool.<toolId>），调度时剥离前缀 dispatch 到 ToolRegistry
 *
 * 设计依据：14-tool-design.md §一 1.2 设计原则；§二统一接口；§十三安全合规。
 */
import type { LawRef } from '../../../types/llm';

// ===== ToolId（14 §2.1）=====

/**
 * 8 个法律工具 ID。
 * 与 14-tool-design.md §2.1 ToolId 联合类型一一对应。
 */
export type ToolId =
  | 'period_calculator'
  | 'document_review'
  | 'compensation_query'
  | 'license_ocr'
  | 'law_validity'
  | 'cause_classification'
  | 'sentencing_guide'
  | 'clause_recommender';

/** 工具所属业务分类 */
export type ToolCategory =
  'civil' | 'criminal' | 'commercial' | 'administrative' | 'procedural' | 'general';

/** 工具入参 PII 分级（影响脱敏与日志，对齐 PiiService PiiLevel） */
export type ToolPiiLevel = 'L1' | 'L2' | 'L3' | 'L4';

// ===== JSON Schema 类型（简化版，仅用于工具元数据声明）=====

/**
 * JSON Schema Draft 7 子集（工具入参/出参 schema 声明）。
 * 仅声明工具需要使用的字段，运行时校验由 ToolRegistry.validateInput 完成。
 */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | number)[];
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  default?: unknown;
  nullable?: boolean;
}

// ===== ToolContext（14 §2.2）=====

/**
 * 工具调用上下文。
 *
 * 设计原则：
 *   - 必填字段：userId / traceId / requestId（运行时基础）
 *   - 可选服务：llmService / ocrService / pii（按工具需要注入，缺失时走降级路径）
 *   - 不依赖 NestJS DI 容器：ToolContext 由 ToolAgent 在 invoke 时构造，便于单测
 *
 * 简化说明（与设计文档差异）：
 *   - 设计文档 §2.2 含 repository: ToolRepository 字段，本实现改为各工具持有静态内置数据
 *     （src/data/*.ts），不强制要求 ToolRepository 注入；后续 v2.4 接入 MongoDB 时可扩展
 *   - featureFlags 默认空对象，由调用方按需传入
 */
export interface ToolContext {
  /** 调用方用户 ID（openid） */
  userId: string;
  /** 请求级追踪 ID（贯穿日志/审计） */
  traceId: string;
  /** 幂等键（客户端生成 UUID，用于缓存与去重） */
  requestId: string;
  /** 灰度开关（如 tool.license_ocr.raw_text） */
  featureFlags?: Record<string, boolean>;
  /** LLM 服务（CauseClassifier / ClauseRecommender rerank 用，可选） */
  llmService?: ToolLlmService;
  /** OCR 服务（LicenseOcr 用，可选） */
  ocrService?: ToolOcrService;
  /** PII 服务（脱敏用，可选） */
  pii?: ToolPiiService;
  /** 结构化日志（可选，缺失时静默） */
  logger?: ToolLogger;
  /** 审计日志（可选，缺失时静默） */
  auditLog?: ToolAuditLog;
}

/** 工具用 LLM 服务接口（最小契约，仅 complete） */
export interface ToolLlmService {
  complete(prompt: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

/** 工具用 OCR 服务接口（LicenseOcr 用） */
export interface ToolOcrService {
  recognize(fileId: string): Promise<{ text: string; confidence: number }>;
}

/** 工具用 PII 服务接口（脱敏用） */
export interface ToolPiiService {
  detectAndMask(text: string): string;
}

/** 工具用 Logger 接口 */
export interface ToolLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

/** 工具用 AuditLog 接口 */
export interface ToolAuditLog {
  write(event: string, detail: Record<string, unknown>): void;
}

// ===== ToolResult（14 §2.3）=====

/**
 * 工具调用结果。
 *
 * 强制约束：
 *   - disclaimer 非空（工具特有免责，14 §十三 13.3）
 *   - 涉法条时 lawRefs 必填
 *   - success=false 时通过抛 LegalToolError 表达，本接口仅承载成功结果
 *   - degraded=true 表示降级路径（如 LLM 失败转规则）
 */
export interface ToolResult<T = unknown> {
  /** 是否成功（成功 = 业务逻辑执行完成，不代表结果 100% 准确） */
  success: boolean;
  /** 工具输出数据 */
  data?: T;
  /** 法条引用列表（涉法条时必填） */
  lawRefs?: LawRef[];
  /** 非阻断性警告（不影响 success） */
  warnings?: string[];
  /** 工具特有免责声明（强制必填） */
  disclaimer: string;
  /** 执行耗时（ms，由 ToolRegistry.dispatch 填充） */
  duration?: number;
  /** 是否命中缓存 */
  fromCache?: boolean;
  /** 是否降级路径 */
  degraded?: boolean;
}

// ===== LegalToolError（14 §2.4）=====

/** 工具错误码（14 §2.4 + 06-api-spec） */
export const TOOL_ERROR_CODES = {
  /** 8001：入参非法（schema 校验失败 / 字段缺失 / 格式错误） */
  INVALID_INPUT: 8001,
  /** 8002：工具不存在（ToolRegistry.get 未命中） */
  TOOL_NOT_FOUND: 8002,
  /** 8003：工具调用超时 */
  TIMEOUT: 8003,
  /** 8004：OCR / 外部服务识别失败 */
  RECOGNIZE_FAILED: 8004,
  /** 8005：法条未命中（law_article 集合无匹配） */
  LAW_NOT_FOUND: 8005,
  /** 8006：案由置信度过低 */
  LOW_CONFIDENCE: 8006,
  /** 8007：量刑情节要素不足 */
  INSUFFICIENT_ELEMENTS: 8007,
  /** 8008：文书审核内部错误 */
  REVIEW_INTERNAL_ERROR: 8008,
  /** 8009：条款推荐无匹配 */
  NO_CLAUSE_MATCH: 8009,
  /** 8019：法条适用判定要件不足（v2.3 追加，推理域） */
  INSUFFICIENT_LAW_APPLY: 8019,
} as const;

/** 工具错误码联合类型 */
export type ToolErrorCode = 8001 | 8002 | 8003 | 8004 | 8005 | 8006 | 8007 | 8008 | 8009 | 8019;

/**
 * 工具调用错误。
 *
 * 设计：通过抛错表达失败，ToolRegistry.dispatch 捕获后：
 *   - 8001 / 8004 / 8005 / 8006 / 8007 / 8009 → ToolResult.success=false + errorCode
 *   - 8003 → 重新抛出（由 ToolAgent 触发 fallbackAgentId 降级）
 *   - 8002 → 理论不可达（registry.get 之前已校验）
 */
export class LegalToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly toolId: ToolId,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'LegalToolError';
  }

  /** 转为可序列化对象（用于审计与日志） */
  toDetail(): { code: ToolErrorCode; message: string; toolId: ToolId; field?: string } {
    return {
      code: this.code,
      message: this.message,
      toolId: this.toolId,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

// ===== LegalTool 接口（14 §2.1）=====

/**
 * 法律工具统一契约。
 *
 * 实现要求：
 *   - readonly 元数据字段（toolId / name / description / category / inputSchema / outputSchema / piiLevel / async / timeout / cacheable / cacheTtl）
 *   - invoke 方法：执行工具逻辑，返回 ToolResult 或抛 LegalToolError
 *   - 不依赖 NestJS DI：工具为纯逻辑类，可独立 new 实例化
 *
 * 元数据来源：14-tool-design.md §4.8 / §5.8 / §6.8 / §7.8 / §8.8 / §9.8 / §10.8 / §11.8
 */
export interface LegalTool<TInput = unknown, TOutput = unknown> {
  /** 工具 ID（全局唯一） */
  readonly toolId: ToolId;
  /** 展示名（中文） */
  readonly name: string;
  /** 描述 */
  readonly description: string;
  /** 业务分类 */
  readonly category: ToolCategory;
  /** 入参 JSON Schema（Draft 7） */
  readonly inputSchema: JsonSchema;
  /** 出参 JSON Schema */
  readonly outputSchema: JsonSchema;
  /** 输入 PII 分级 */
  readonly piiLevel: ToolPiiLevel;
  /** 是否长任务（文书审核可能异步） */
  readonly async: boolean;
  /** 超时（ms） */
  readonly timeout: number;
  /** 是否可缓存 */
  readonly cacheable: boolean;
  /** 缓存 TTL（秒），cacheable=true 时必填 */
  readonly cacheTtl?: number;
  /** 工具语义化版本（缓存失效用） */
  readonly toolVersion: string;
  /**
   * 调用工具。
   * @param input 入参（须符合 inputSchema）
   * @param ctx 调用上下文
   * @returns 工具结果（成功）或抛 LegalToolError（失败）
   */
  invoke(input: TInput, ctx: ToolContext): Promise<ToolResult<TOutput>>;
}
