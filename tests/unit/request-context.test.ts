/**
 * RequestContext 单元测试（A1-W2）。
 *
 * 验收点：
 *   - run/get 在异步链路中正确传递
 *   - 无上下文 getTraceId 不抛错（生成新 UUID）
 *   - amend 在已存在上下文中追加字段
 *   - createRequestContext 优先取 X-Trace-Id 头
 */
import { describe, it, expect } from 'vitest';
import { createRequestContext, requestContext } from '../../src/common/context/request-context';

describe('RequestContext', () => {
  it('run 内 get 返回上下文；run 外返回 undefined', async () => {
    expect(requestContext.get()).toBeUndefined();
    await new Promise<void>((resolve) => {
      requestContext.run({ traceId: 'trace-abc', startedAt: Date.now() }, async () => {
        const ctx = requestContext.get();
        expect(ctx?.traceId).toBe('trace-abc');
        // 异步穿透
        await Promise.resolve();
        expect(requestContext.get()?.traceId).toBe('trace-abc');
        resolve();
      });
    });
  });

  it('嵌套 run 内层覆盖外层', () => {
    requestContext.run({ traceId: 'outer', startedAt: 1 }, () => {
      expect(requestContext.get()?.traceId).toBe('outer');
      requestContext.run({ traceId: 'inner', startedAt: 2 }, () => {
        expect(requestContext.get()?.traceId).toBe('inner');
      });
      expect(requestContext.get()?.traceId).toBe('outer');
    });
  });

  it('getTraceId 无上下文时生成 UUID', () => {
    const id = requestContext.getTraceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('getTraceId 有上下文时返回上下文 traceId', () => {
    requestContext.run({ traceId: 'fixed-id', startedAt: 0 }, () => {
      expect(requestContext.getTraceId()).toBe('fixed-id');
    });
  });

  it('amend 在上下文中追加字段', () => {
    requestContext.run({ traceId: 't1', startedAt: 0 }, () => {
      requestContext.amend({ userId: 'u1', intent: 'legal_qa' });
      expect(requestContext.get()?.userId).toBe('u1');
      expect(requestContext.get()?.intent).toBe('legal_qa');
      expect(requestContext.get()?.traceId).toBe('t1'); // 原字段不变
    });
  });

  it('amend 无上下文时不抛错（静默）', () => {
    expect(() => requestContext.amend({ userId: 'x' })).not.toThrow();
  });

  it('createRequestContext 优先取 X-Trace-Id 头', () => {
    const ctx = createRequestContext({ headers: { 'x-trace-id': 'client-trace' } });
    expect(ctx.traceId).toBe('client-trace');
  });

  it('createRequestContext 缺头时生成 UUID', () => {
    const ctx = createRequestContext({ headers: {} });
    expect(ctx.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
