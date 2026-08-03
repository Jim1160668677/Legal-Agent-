/**
 * 法律智能体多平台统一SDK
 * 基于后端实际API响应格式：{ code: 0, message: 'ok', traceId, data }
 *
 * 支持平台：Web、微信小程序、Android、iOS、HarmonyOS、Taro
 */

// ==================== 后端API响应格式（与实际对齐）====================

/** 统一成功响应信封 */
export interface ApiResponse<T = unknown> {
  code: 0;
  message: 'ok';
  traceId: string;
  data: T;
}

/** 统一错误响应信封 */
export interface ApiErrorResponse {
  code: number;
  message: string;
  traceId: string;
  data: null;
}

/** 是否为错误响应 */
export function isApiError<T>(res: ApiResponse<T> | ApiErrorResponse): res is ApiErrorResponse {
  return 'code' in res && (res as ApiErrorResponse).code !== 0;
}

// ==================== 认证相关 ====================

/** 外部身份提供方 */
export type ExternalProvider = 'phone' | 'wechat' | 'email';

/** JWT Payload */
export interface JwtPayload {
  sub: string;
  role?: string;
  type?: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

/** 登录结果 */
export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  isNewUser: boolean;
}

/** 用户角色 */
export type UserRole = 'user' | 'ops' | 'audit' | 'admin';

// ==================== 聊天相关 ====================

/** SSE 帧类型（流式响应） */
export type ChatFrame =
  | { type: 'chunk'; delta: string }
  | {
      type: 'meta';
      intent: IntentType;
      route: RouteTarget;
      source: 'rule' | 'faq' | 'llm' | 'tool' | 'guide';
      lawRefs: LawRef[];
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      fallbackUsed?: boolean;
    }
  | { type: 'disclaimer'; text: string }
  | { type: 'done'; traceId: string }
  | { type: 'error'; code: number; message: string };

/** 对话轮次 */
export interface DialogTurn {
  role: 'user' | 'assistant';
  content: string;
  intent?: IntentType;
  ts: string;
}

/** 对话上下文 */
export interface DialogContext {
  sessionId: string;
  userId?: string;
  lastIntent?: IntentType;
  pendingDocument?: string | null;
  relatedCaseId?: string | null;
  unresolvedCount: number;
  recentTurns: DialogTurn[];
}

/** 聊天请求DTO */
export interface ChatDto {
  message: string;
  sessionId?: string;
}

// ==================== 意图相关 ====================

/** 8类法律意图 */
export type IntentType =
  | 'legal_qa'
  | 'document_generate'
  | 'process_guide'
  | 'case_analysis'
  | 'case_reasoning'
  | 'material_checklist'
  | 'tool_invoke'
  | 'general_qa';

/** 6类路由目标 */
export type RouteTarget =
  | 'rule'
  | 'knowledge'
  | 'llm'
  | 'tool'
  | 'reasoning'
  | 'general_qa';

/** 意图识别结果 */
export interface IntentResult {
  intent: IntentType;
  confidence: number;
  route: RouteTarget;
  fallbackUsed: boolean;
  matchedKeywords: string[];
  matchedPatterns: string[];
  toolId?: string;
  candidates?: IntentType[];
}

// ==================== 法条相关 ====================

/** 法条引用 */
export interface LawRef {
  ref: string;
  title?: string;
  verified?: boolean;
}

/** 法条引用校验结果 */
export interface LawRefCheckResult {
  verified: LawRef[];
  unverified: LawRef[];
  sanitizedText: string;
}

// ==================== 知识库相关 ====================

/** 知识库结果 */
export interface KnowledgeResult {
  id: string;
  title: string;
  content: string;
  type: string;
  category: string;
  subCategory?: string;
  lawRefs: LawRef[];
  structured?: Record<string, unknown>;
  score: number;
}

/** 知识库分类信息 */
export interface KnowledgeCategoryInfo {
  type: string;
  category: string;
  count: number;
}

/** 知识库列表结果 */
export interface KnowledgeListResult {
  items: KnowledgeResult[];
  total: number;
  page: number;
  pageSize: number;
  categories: KnowledgeCategoryInfo[];
}

// ==================== 文档相关 ====================

/** 文书模板 */
export interface DocumentTemplate {
  code: string;
  title: string;
  description: string;
  category: string;
  vars: Array<{ name: string; required: boolean; type: string; description: string }>;
  body: string;
  status: 'active' | 'deprecated';
}

/** 文书生成请求 */
export interface DocumentGenerateDto {
  templateCode: string;
  vars: Record<string, unknown>;
  enableRag?: boolean;
}

/** 文书生成结果 */
export interface DocumentGenerateResult {
  docId: string;
  templateCode: string;
  templateTitle: string;
  renderedText: string;
  varsFilled: Record<string, unknown>;
  lawRefs: LawRef[];
  retrievedLawContext?: string;
  disclaimer: string;
  exportReady: boolean;
}

/** 文书记录 */
export interface DocumentRecord {
  docId: string;
  userId: string;
  templateCode: string;
  templateTitle: string;
  renderedText: string;
  varsFilled: Record<string, unknown>;
  lawRefs: LawRef[];
  exportFileId?: string;
  exportFormat?: 'docx' | 'pdf';
  createdAt: string;
  updatedAt: string;
}

/** 导出结果 */
export interface ExportResult {
  fileId: string;
  downloadUrl: string;
  format: 'docx' | 'pdf';
  expires: number;
}

// ==================== 任务相关 ====================

/** 任务状态 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 任务状态查询结果 */
export interface JobStatusResult {
  jobId: string;
  capability: string;
  status: JobStatus;
  progress: number;
  result?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
}

// ==================== Agent相关 ====================

/** Agent暴露层级 */
export type AgentExposure = 'L-Read' | 'L-Write-Limited' | 'L-Internal';

/** Agent能力声明 */
export interface AgentCard {
  agentId: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  piiLevel: string;
  exposure: AgentExposure;
  async: boolean;
  timeout: number;
  fallbackAgentId?: string;
}

// ==================== 视觉相关 ====================

/** 视觉识别请求 */
export interface VisionRecognizeDto {
  image: string;
  prompt?: string;
}

/** 视觉识别结果 */
export interface VisionRecognizeResult {
  text: string;
  entities?: Array<{ type: string; value: string }>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

/** Provider健康状态 */
export interface ProviderStatus {
  name: string;
  model: string;
  priority: number;
  healthy: boolean;
  lastError?: string;
  consecutiveFailures: number;
}

// ==================== SDK配置 ====================

/** SDK配置 */
export interface LegalAgentConfig {
  /** 后端API基础URL */
  baseUrl: string;
  /** 请求超时（毫秒） */
  timeout?: number;
  /** 应用版本号 */
  appVersion?: string;
  /** 客户端类型标识 */
  clientType?: 'web' | 'wechat' | 'android' | 'ios' | 'harmonyos' | 'taro';
}
