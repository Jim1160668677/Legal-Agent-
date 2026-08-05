/**
 * AppLoggerService 单元测试（A1-W2 结构化日志）。
 *
 * 覆盖：
 *   - 各 level 调用底层 pino，合并 RequestContext 字段（traceId/userId/func/intent/route）
 *   - 显式 meta 优先于 RequestContext 字段
 *   - 无 RequestContext 时字段为 undefined（不抛错）
 *   - log() 委托 info()
 *   - NestLoggerService 接口签名满足
 *
 * 设计依据：A1 §6.4 Logger；02 §8.1 日志字段。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppLoggerService } from '../../src/modules/platform/logger/logger.service';
import { requestContext } from '../../src/common/context/request-context';

function makePino() {
  return {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

describe('AppLoggerService（结构化 JSON 日志，A1-W2）', () => {
  let pino: ReturnType<typeof makePino>;
  let logger: AppLoggerService;

  beforeEach(() => {
    pino = makePino();
    logger = new AppLoggerService(pino as never);
  });

  it('info：合并 RequestContext 字段到 meta', () => {
    requestContext.run(
      { traceId: 'tr-1', userId: 'u-1', func: 'chat', intent: 'qa', route: 'llm', startedAt: 1 },
      () => {
        logger.info('hello');
      },
    );

    const [meta, msg] = pino.info.mock.calls[0];
    expect(msg).toBe('hello');
    expect(meta).toMatchObject({ traceId: 'tr-1', userId: 'u-1', func: 'chat', intent: 'qa', route: 'llm' });
  });

  it('显式 meta 覆盖 RequestContext 字段', () => {
    requestContext.run(
      { traceId: 'tr-1', userId: 'ctx-user', startedAt: 1 },
      () => {
        logger.info('msg', { userId: 'explicit-user', func: 'myfunc' });
      },
    );

    const [meta] = pino.info.mock.calls[0];
    expect(meta).toMatchObject({ userId: 'explicit-user', func: 'myfunc' });
    expect(meta.traceId).toBe('tr-1');
  });

  it('无 RequestContext → 不抛错，字段为 undefined', () => {
    // 不进入 run()，确认空上下路径安全
    logger.info('no-ctx');
    const [meta, msg] = pino.info.mock.calls[0];
    expect(msg).toBe('no-ctx');
    expect(meta.traceId).toBeUndefined();
    expect(meta.userId).toBeUndefined();
  });

  it('全部 level 转发到对应 pino 方法', () => {
    logger.fatal('f');
    logger.error('e');
    logger.warn('w');
    logger.debug('d');
    logger.trace('t');

    expect(pino.fatal).toHaveBeenCalledTimes(1);
    expect(pino.error).toHaveBeenCalledTimes(1);
    expect(pino.warn).toHaveBeenCalledTimes(1);
    expect(pino.debug).toHaveBeenCalledTimes(1);
    expect(pino.trace).toHaveBeenCalledTimes(1);
  });

  it('log() 委托 info()（NestLoggerService 接口）', () => {
    logger.log('via-log', { route: 'x' });
    expect(pino.info).toHaveBeenCalledTimes(1);
    const [meta, msg] = pino.info.mock.calls[0];
    expect(msg).toBe('via-log');
    expect(meta.route).toBe('x');
  });

  it('自定义 meta 透传（durationMs/llmCalled/cacheHit 等）', () => {
    logger.warn('slow', { durationMs: 123, llmCalled: true, cacheHit: false });
    const [meta] = pino.warn.mock.calls[0];
    expect(meta).toMatchObject({ durationMs: 123, llmCalled: true, cacheHit: false });
  });
});