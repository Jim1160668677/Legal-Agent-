/**
 * LLM 降级错误（A3-W1，A3 §3.3）。
 *
 * 熔断器 open 状态时抛出，对齐 06-api-spec.md 错误码 5003。
 * OrchestratorService 捕获后走降级链（规则→知识库→人工引导）。
 *
 * 注：独立于 legacy 层 errors.ts（src/services/legal/llm/errors.ts），
 *     避免污染 legacy 层 105 测试。两者通过 HTTP 错误码对齐。
 */
import { HttpException, HttpStatus } from '@nestjs/common';

/** 熔断降级错误码（对齐 06-api-spec.md） */
export const LLM_DEGRADED_ERROR_CODE = 5003;

export class LlmDegradedError extends HttpException {
  /** 业务错误码 */
  readonly code: number;
  /** 熔断器状态 */
  readonly breakerState: 'open' | 'half-open';

  constructor(
    message = 'LLM service degraded (circuit breaker open)',
    breakerState: 'open' | 'half-open' = 'open',
  ) {
    super({ code: LLM_DEGRADED_ERROR_CODE, message, breakerState }, HttpStatus.SERVICE_UNAVAILABLE);
    this.code = LLM_DEGRADED_ERROR_CODE;
    this.breakerState = breakerState;
  }
}

/** 类型守卫：判断错误是否为 LlmDegradedError */
export function isLlmDegradedError(err: unknown): err is LlmDegradedError {
  return err instanceof LlmDegradedError;
}
