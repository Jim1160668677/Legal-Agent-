/**
 * Vision 模块类型定义（v2.4 图像识别多模型主备切换）。
 *
 * 定义图片输入、识别结果、Provider 接口与健康状态类型。
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.1
 */

/** 图片输入（归一化后） */
export interface VisionInput {
  /** URL 或 data:image/...;base64,... */
  image: string;
  /** 识别指令，默认"请识别图片中的所有文字" */
  prompt?: string;
}

/** 识别结果 */
export interface VisionResult {
  /** 模型返回的文本 */
  text: string;
  /** 使用的模型名 */
  model: string;
  /** token 用量 */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 原始响应（调试用） */
  raw?: unknown;
}

/** Provider 调用选项 */
export interface VisionOpts {
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** Provider 接口 */
export interface VisionProvider {
  /** 'zhipu-flash' | 'zhipu-plus' */
  readonly name: string;
  /** 'glm-4v-flash' | 'glm-4v-plus' */
  readonly model: string;
  /** 1=主, 2=备 */
  readonly priority: number;
  recognize(input: VisionInput, opts?: VisionOpts): Promise<VisionResult>;
  healthCheck(): Promise<boolean>;
}

/** Provider 健康状态（Registry 内部维护） */
export interface ProviderHealth {
  healthy: boolean;
  unhealthySince?: number;
  consecutiveFailures: number;
  lastSuccessAt?: number;
}

/** Provider 状态快照（供 GET /v1/vision/health） */
export interface ProviderStatus {
  name: string;
  model: string;
  priority: number;
  healthy: boolean;
}

/** 所有 provider 均失败时抛出 */
export class VisionAllProvidersFailedError extends Error {
  readonly failures: Array<{ provider: string; error: string }>;
  constructor(failures: Array<{ provider: string; error: string }>) {
    super('All vision providers failed');
    this.name = 'VisionAllProvidersFailedError';
    this.failures = failures;
  }
}
