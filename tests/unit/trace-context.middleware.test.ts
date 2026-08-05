/**
 * TraceContextMiddleware 单元测试（A1-W2 全链路 traceId）。
 *
 * 覆盖：
 *   - 优先取客户端 X-Trace-Id 头
 *   - 无头时生成 traceId
 *   - 响应头回写 X-Trace-Id
 *   - next 在 RequestContext（AsyncLocalStorage）内执行
 *
 * 设计依据：A1 §6.4 Logger；02 §8.1 traceId 贯穿。
 */
import { describe, it, expect, vi } from 'vitest';
import { TraceContextMiddleware } from '../../src/common/middleware/trace-context.middleware';
import { requestContext } from '../../src/common/context/request-context';

function makeRes() {
  const setHeader = vi.fn();
  return { setHeader, headersSent: false };
}

describe('TraceContextMiddleware', () => {
  const middleware = new TraceContextMiddleware();

  it('优先取客户端 X-Trace-Id 头并回写响应头', async () => {
    const req = { headers: { 'x-trace-id': 'client-trace-99' } } as never;
    const res = makeRes();
    const next = vi.fn();

    middleware.use(req, res as never, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'client-trace-99');
    expect(next).toHaveBeenCalledOnce();
  });

  it('无头时生成 traceId 且 ALS 上下文内可读', async () => {
    const req = { headers: {} } as never;
    const res = makeRes();

    let ctxInNext: unknown = null;
    const next = () => {
      ctxInNext = requestContext.get();
    };

    middleware.use(req, res as never, next as never);

    expect(res.setHeader.mock.calls[0][0]).toBe('X-Trace-Id');
    const written = res.setHeader.mock.calls[0][1] as string;
    expect(written).toMatch(/^[0-9a-f-]{36}$/i);
    // next 在 run 内执行，getRequestContext 应拿到同一个上下文
    expect(ctxInNext).not.toBeNull();
    expect((ctxInNext as { traceId: string }).traceId).toBe(written);
  });

  it('next 执行完成后 ALS 上下文可被后续请求独立隔离', async () => {
    const reqA = { headers: { 'x-trace-id': 'A' } } as never;
    const reqB = { headers: { 'x-trace-id': 'B' } } as never;
    const resA = makeRes();
    const resB = makeRes();

    const observed: string[] = [];
    const nextA = () => {
      observed.push(requestContext.get()!.traceId);
    };
    const nextB = () => {
      observed.push(requestContext.get()!.traceId);
    };

    middleware.use(reqA, resA as never, nextA as never);
    middleware.use(reqB, resB as never, nextB as never);

    expect(observed).toEqual(['A', 'B']);
    // 上下文外不可读
    expect(requestContext.get()).toBeUndefined();
  });
});