/**
 * ContentSafety 类型与 Provider 接口（A1-W2）。
 *
 * 可插拔设计：业务侧依赖 ContentSafetyProvider 接口，底层适配器可切换：
 *   - PassThroughProvider（A1 默认，不拦截，便于联调）
 *   - TencentCloudProvider（生产默认，A1-W2 后接 D-5）
 *   - AliyunGreenProvider（备选）
 *
 * 命中违规抛 6002（06 错误码表）。
 *
 * 设计依据：A1 §6.7；06 错误码 6002/7005。
 */

export interface ContentSafetyResult {
  safe: boolean;
  /** 命中原因（safe=false 时必填） */
  reason?: string;
  /** 命中的违规类型：politics/porn/abuse/ads/illegal ... */
  category?: string;
  /** 命中的原始片段（脱敏后返回，便于审计） */
  matchedFragment?: string;
}

export interface ContentSafetyProvider {
  /** 同步标识，便于日志/审计 */
  readonly name: string;
  /** 校验文本，返回结果；不抛错（业务侧根据 safe 字段决策） */
  checkText(text: string): Promise<ContentSafetyResult>;
}
