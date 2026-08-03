/**
 * ReviewModule 常量（v2.3 阶段十）。
 *
 * 错误码对齐 06-api-spec：
 *   - 8013：合规拦截（ComplianceMonitor block 级，见 review.types COMPLIANCE_ERROR_CODE）
 *   - 8020：审核不存在
 *   - 8021：非法状态流转
 *   - 8022：评分维度非法
 *   - 8023：溯源记录不存在
 *   - 8024：回流目标不存在
 *
 * 设计依据：17 §2-§6；06 错误码。
 */

/** Review 模块业务错误码 */
export const REVIEW_ERROR_CODES = {
  /** 8013：合规拦截（block 级，返回客户端） */
  COMPLIANCE_BLOCKED: 8013,
  /** 8020：审核记录不存在 */
  REVIEW_NOT_FOUND: 8020,
  /** 8021：非法状态流转 */
  INVALID_TRANSITION: 8021,
  /** 8022：评分维度非法（非 1-5 数值） */
  INVALID_SCORE: 8022,
  /** 8023：溯源记录不存在 */
  TRACE_NOT_FOUND: 8023,
  /** 8024：回流目标不存在 */
  REFLOW_TARGET_NOT_FOUND: 8024,
} as const;
