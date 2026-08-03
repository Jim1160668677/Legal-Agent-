/**
 * JobService 单元测试（A3-W4）。
 *
 * 覆盖：
 *   - create：params L4 加密入库 + 返回 jobId
 *   - getStatus：查询 + 解密 params（includeParams=true）
 *   - assertOwner：所有者通过；非所有者抛 2003
 *   - update：更新状态/进度/结果
 *   - runJob：状态机 pending→running→completed；result 填充
 *   - runJob 失败：状态置为 failed + errorMessage
 *   - runJob 幂等：已完成任务直接返回结果
 *   - PiiService 强制注入：未注入时 create 抛错（拒绝明文降级）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { JobService } from '../../src/modules/legal/job/job.service';

function makeModel() {
  return {
    create: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn().mockReturnValue({
      exec: () => Promise.resolve({}),
    }),
    countDocuments: vi.fn(),
  };
}

function makePii() {
  return {
    encrypt: vi.fn((s: string) => `ENC(${s})`),
    decrypt: vi.fn((s: string) => s.replace(/^ENC\((.*)\)$/, '$1')),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('JobService', () => {
  let model: ReturnType<typeof makeModel>;
  let pii: ReturnType<typeof makePii>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: JobService;

  beforeEach(() => {
    model = makeModel();
    pii = makePii();
    logger = makeLogger();
    svc = new JobService(model as never, pii as never, logger as never);
  });

  describe('create', () => {
    it('params L4 加密入库 + 返回 jobId', async () => {
      const result = await svc.create('document_generate', { templateCode: 't1' }, 'u1');

      expect(result.jobId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.status).toBe('pending');
      expect(pii.encrypt).toHaveBeenCalledWith(JSON.stringify({ templateCode: 't1' }));
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          capability: 'document_generate',
          status: 'pending',
        }),
      );
    });

    it('PiiService 未注入时拒绝明文降级（抛错，不静默写入明文）', async () => {
      const devSvc = new JobService(model as never, undefined, logger as never);
      await expect(devSvc.create('document_generate', { a: 1 }, 'u1')).rejects.toThrow();
      // 明文降级路径已移除：不应写入数据库
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('查询成功（不含 params）', async () => {
      const doc = {
        jobId: 'j1',
        capability: 'document_generate',
        status: 'completed',
        progress: 100,
        result: { docId: 'd1' },
        createdAt: new Date(),
        durationMs: 500,
      };
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(doc) }),
      });

      const result = await svc.getStatus('j1');
      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.result).toEqual({ docId: 'd1' });
      expect(result).not.toHaveProperty('params');
    });

    it('includeParams=true 解密 params', async () => {
      const doc = {
        jobId: 'j1',
        capability: 'document_generate',
        status: 'pending',
        progress: 0,
        result: {},
        params: 'ENC({"x":1})',
        createdAt: new Date(),
        durationMs: 0,
      };
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(doc) }),
      });

      const result = await svc.getStatus('j1', true);
      expect(result.params).toEqual({ x: 1 });
    });

    it('不存在抛 NotFoundException(2003)', async () => {
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(svc.getStatus('no-such')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertOwner', () => {
    it('所有者通过', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ userId: 'u1' }) }),
        }),
      });
      await expect(svc.assertOwner('j1', 'u1')).resolves.toBeUndefined();
    });

    it('非所有者抛 NotFoundException(2003)', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ userId: 'u1' }) }),
        }),
      });
      await expect(svc.assertOwner('j1', 'u2')).rejects.toThrow(NotFoundException);
    });

    it('admin 可查任意任务', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ userId: 'u1' }) }),
        }),
      });
      await expect(svc.assertOwner('j1', 'u2', true)).resolves.toBeUndefined();
    });

    it('任务不存在抛 NotFoundException(2003)', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(null) }),
        }),
      });
      await expect(svc.assertOwner('no-such', 'u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('更新状态为 running 设置 startedAt', async () => {
      await svc.update('j1', { status: 'running', progress: 10 });
      expect(model.updateOne).toHaveBeenCalledWith(
        { jobId: 'j1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'running',
            progress: 10,
            startedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('更新状态为 completed 设置 completedAt', async () => {
      await svc.update('j1', { status: 'completed', result: { docId: 'd1' } });
      expect(model.updateOne).toHaveBeenCalledWith(
        { jobId: 'j1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'completed',
            result: { docId: 'd1' },
            completedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('runJob', () => {
    it('成功：状态机 pending→running→completed', async () => {
      const jobDoc = {
        jobId: 'j1',
        capability: 'document_generate',
        status: 'pending',
        params: 'ENC({"x":1})',
        result: {},
        createdAt: new Date(),
        durationMs: 0,
      };
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(jobDoc) }),
      });

      const executor = vi.fn(async () => ({ docId: 'd1' }));
      const result = await svc.runJob('j1', executor);

      expect(executor).toHaveBeenCalledWith({ x: 1 });
      expect(result).toEqual({ docId: 'd1' });
      // updateOne 被调用：running + completed
      expect(model.updateOne).toHaveBeenCalledTimes(2);
      // 最后一次是 completed
      const lastCall = model.updateOne.mock.calls[1];
      expect(lastCall[1].$set.status).toBe('completed');
      expect(lastCall[1].$set.progress).toBe(100);
      expect(lastCall[1].$set.result).toEqual({ docId: 'd1' });
    });

    it('失败：状态置为 failed + errorMessage', async () => {
      const jobDoc = {
        jobId: 'j1',
        capability: 'document_generate',
        status: 'pending',
        params: 'ENC({})',
        result: {},
        createdAt: new Date(),
        durationMs: 0,
      };
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(jobDoc) }),
      });

      const executor = vi.fn(async () => {
        throw new Error('boom');
      });

      await expect(svc.runJob('j1', executor)).rejects.toThrow('boom');

      const lastCall = model.updateOne.mock.calls[model.updateOne.mock.calls.length - 1];
      expect(lastCall[1].$set.status).toBe('failed');
      expect(lastCall[1].$set.errorMessage).toBe('boom');
      expect(logger.error).toHaveBeenCalled();
    });

    it('幂等：已完成任务直接返回结果', async () => {
      const jobDoc = {
        jobId: 'j1',
        capability: 'document_generate',
        status: 'completed',
        params: 'ENC({})',
        result: { docId: 'd1' },
        createdAt: new Date(),
        durationMs: 100,
      };
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(jobDoc) }),
      });

      const executor = vi.fn();
      const result = await svc.runJob('j1', executor);
      expect(result).toEqual({ docId: 'd1' });
      expect(executor).not.toHaveBeenCalled();
    });

    it('任务不存在抛 NotFoundException', async () => {
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(svc.runJob('no-such', vi.fn())).rejects.toThrow(NotFoundException);
    });
  });
});
