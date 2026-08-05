/**
 * llm-errors 单元测试（A3-W1 熔断降级错误）。
 *
 * 覆盖：
 *   - LlmDegradedError：code=5003、status=503、breakerState 默认 'open'
 *   - 自定义 breakerState 'half-open'
 *   - isLlmDegradedError 类型守卫
 *
 * 设计依据：A3 §3.3；06-api-spec.md 错误码 5003。
 */
import { describe, it, expect } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import {
  LLM_DEGRADED_ERROR_CODE,
  LlmDegradedError,
  isLlmDegradedError,
} from '../../src/modules/legal/llm/llm-errors';

describe('LlmDegradedError', () => {
  it('默认构造 → code=5003, status=503, breakerState=open', () => {
    const err = new LlmDegradedError();
    expect(err.code).toBe(LLM_DEGRADED_ERROR_CODE);
    expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(err.breakerState).toBe('open');
    expect(err.message).toBe('LLM service degraded (circuit breaker open)');
  });

  it('自定义 breakerState="half-open"', () => {
    const err = new LlmDegradedError('custom', 'half-open');
    expect(err.breakerState).toBe('half-open');
    expect(err.message).toBe('custom');
  });

  it('getResponse 暴露业务错误码与 breakerState', () => {
    const err = new LlmDegradedError();
    const resp = err.getResponse() as { code: number; breakerState: string };
    expect(resp.code).toBe(5003);
    expect(resp.breakerState).toBe('open');
  });
});

describe('isLlmDegradedError', () => {
  it('实例 → true；普通错误 → false', () => {
    expect(isLlmDegradedError(new LlmDegradedError())).toBe(true);
    expect(isLlmDegradedError(new Error('x'))).toBe(false);
    expect(isLlmDegradedError('str')).toBe(false);
    expect(isLlmDegradedError(undefined)).toBe(false);
  });
});