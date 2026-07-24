/**
 * AuditLogService 单元测试（A1-W2）。
 *
 * 验收点（A1 §6.3）：
 *   - write 异步非阻塞（setImmediate），立即返回
 *   - writeSync 同步写入
 *   - traceId/userId 从 RequestContext 自动取
 *   - 写入失败仅记 logger，不抛错
 *
 * 设计依据：A1 §6.3。
 *
 * 实现注：手动 new AuditLogService(model, logger) 绕过 NestJS DI，
 *       避免 AppLoggerService 链式依赖 PinoLogger 的测试复杂性。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogService } from '../../src/modules/platform/audit/audit-log.service';
import { requestContext } from '../../src/common/context/request-context';

describe('AuditLogService', () => {
  let svc: AuditLogService;
  let model: { create: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    model = { create: vi.fn() };
    logger = { error: vi.fn(), info: vi.fn() };
    // 手动构造，绕过 NestJS DI
    svc = new AuditLogService(model as never, logger as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('write 立即返回（不等 DB），DB 在 setImmediate 后写入', async () => {
    model.create.mockResolvedValue({});
    const start = Date.now();
    svc.write('chat_send', { msg: 'hi' });
    const elapsed = Date.now() - start;
    // 主流程 < 5ms（A1 §6.3 验收）
    expect(elapsed).toBeLessThan(5);

    // 等 setImmediate 完成
    await new Promise((r) => setImmediate(r));
    expect(model.create).toHaveBeenCalledTimes(1);
    const doc = model.create.mock.calls[0][0];
    expect(doc.event).toBe('chat_send');
    expect(doc.detail).toEqual({ msg: 'hi' });
  });

  it('write 从 RequestContext 自动取 traceId/userId', async () => {
    model.create.mockResolvedValue({});
    await new Promise<void>((resolve) => {
      requestContext.run({ traceId: 'trace-xyz', userId: 'u1', startedAt: 0 }, async () => {
        svc.write('llm_call', { tokens: 100 });
        await new Promise((r) => setImmediate(r));
        const doc = model.create.mock.calls[0][0];
        expect(doc.traceId).toBe('trace-xyz');
        expect(doc.userId).toBe('u1');
        resolve();
      });
    });
  });

  it('write 写入失败不抛错，仅记 logger.error', async () => {
    model.create.mockRejectedValue(new Error('db down'));
    svc.write('degradation', { reason: 'llm timeout' });
    await new Promise((r) => setImmediate(r));
    // 让 catch 块的微任务执行
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.error).toHaveBeenCalled();
  });

  it('writeSync 同步等待写入', async () => {
    model.create.mockResolvedValue({});
    await svc.writeSync('compliance_blocked', { stage: 'input' }, { result: 'blocked' });
    expect(model.create).toHaveBeenCalledTimes(1);
    const doc = model.create.mock.calls[0][0];
    expect(doc.result).toBe('blocked');
  });

  it('writeSync 写入失败抛错（同步语义）', async () => {
    model.create.mockRejectedValue(new Error('db down'));
    await expect(svc.writeSync('user_login', {})).rejects.toThrow('db down');
  });

  it('write opts 覆盖 RequestContext 字段', async () => {
    model.create.mockResolvedValue({});
    await new Promise<void>((resolve) => {
      requestContext.run({ traceId: 'ctx-trace', userId: 'ctx-user', startedAt: 0 }, async () => {
        svc.write(
          'admin_operation',
          {},
          {
            traceId: 'override-trace',
            userId: 'override-user',
          },
        );
        await new Promise((r) => setImmediate(r));
        const doc = model.create.mock.calls[0][0];
        expect(doc.traceId).toBe('override-trace');
        expect(doc.userId).toBe('override-user');
        resolve();
      });
    });
  });

  it('expireAt 距 ts 180 天', async () => {
    model.create.mockResolvedValue({});
    svc.write('chat_send', {});
    await new Promise((r) => setImmediate(r));
    const doc = model.create.mock.calls[0][0];
    const diffDays = (doc.expireAt.getTime() - doc.ts.getTime()) / (24 * 3600 * 1000);
    expect(diffDays).toBeGreaterThanOrEqual(179);
    expect(diffDays).toBeLessThanOrEqual(181);
  });
});
