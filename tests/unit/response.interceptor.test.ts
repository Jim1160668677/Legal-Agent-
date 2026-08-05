/**
 * ResponseInterceptor 单元测试（A1-W1 全局成功响应包装）。
 *
 * 覆盖：
 *   - 成功数据 → { code: 0, message: 'ok', traceId, data }
 *   - X-Trace-Id 响应头注入 + 优先取请求头
 *   - SSE（text/event-stream）→ 不包装直接放行
 *   - headersSent → 跳过包装返回原始数据
 *
 * 设计依据：A5 §七统一响应格式。
 */
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { toArray } from 'rxjs';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

function makeContext(overrides: { headersSent?: boolean; contentType?: string | undefined } = {}) {
  const res = {
    getHeader: vi.fn((name: string) => {
      if (name === 'Content-Type') return overrides.contentType;
      return undefined;
    }),
    header: vi.fn(),
    headersSent: overrides.headersSent ?? false,
  };
  const context = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({
        headers: { 'x-trace-id': 'req-trace-1' },
      }),
    }),
  } as never;
  return { context, res };
}

describe('ResponseInterceptor（统一成功信封）', () => {
  const interceptor = new ResponseInterceptor();

  it('普通响应 → 包装为 { code: 0, message: "ok", traceId, data }', async () => {
    const { context, res } = makeContext();
    const result = await interceptor
      .intercept(context, { handle: () => of({ id: '1', text: 'hello' }) })
      .pipe(toArray())
      .toPromise();

    expect(result).toEqual([
      { code: 0, message: 'ok', traceId: 'req-trace-1', data: { id: '1', text: 'hello' } },
    ]);
    expect(res.header).toHaveBeenCalledWith('X-Trace-Id', 'req-trace-1');
  });

  it('无 X-Trace-Id 请求头 → 生成 traceId', async () => {
    const context = {
      switchToHttp: () => ({
        getResponse: () => makeContext().res,
        getRequest: () => ({ headers: {} }),
      }),
    } as never;
    const result = await interceptor
      .intercept(context, { handle: () => of('data') })
      .pipe(toArray())
      .toPromise();
    expect(result![0].traceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result![0].code).toBe(0);
  });

  it('SSE 响应 → 不包装直接放行原始数据', async () => {
    const { context, res } = makeContext({ contentType: 'text/event-stream' });
    const result = await interceptor
      .intercept(context, { handle: () => of('raw-stream-data') })
      .pipe(toArray())
      .toPromise();

    expect(result).toEqual(['raw-stream-data']);
    expect(res.header).not.toHaveBeenCalled();
  });

  it('handler 已发送响应头 → 跳过包装返回原始数据', async () => {
    const { context, res } = makeContext({ headersSent: true });
    const result = await interceptor
      .intercept(context, { handle: () => of({ already: 'sent' }) })
      .pipe(toArray())
      .toPromise();

    expect(result).toEqual([{ already: 'sent' }]);
    expect(res.header).not.toHaveBeenCalled();
  });
});