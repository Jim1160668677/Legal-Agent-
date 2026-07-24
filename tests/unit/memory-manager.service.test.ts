/**
 * MemoryManagerService 单元测试（A1-W3）。
 *
 * 覆盖三类场景：
 *   - 正常场景：appendDialog / getDialog / getRecentTurns / getRelevantMemories / saveMemory
 *   - 边界场景：空 sessionId / 无上下文 / case 类型延后
 *   - 异常场景：DB 写入失败不阻塞主流程
 *
 * 设计依据：06 §八 MemoryManager；05 dialog_record/user_profile schema。
 *
 * 实现注：手动 new MemoryManagerService(dialogModel, userModel, logger) 绕过 NestJS DI，
 *       mock Mongoose 链式调用（findOne().select().lean().exec()）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManagerService } from '../../src/modules/legal/memory/memory-manager.service';
import { requestContext } from '../../src/common/context/request-context';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    log: vi.fn(),
  };
}

/** 构造 mock dialogModel（链式 findOne/updateOne） */
function makeDialogModel(doc: unknown = null) {
  const exec = vi.fn().mockResolvedValue(doc);
  const lean = vi.fn().mockReturnValue({ exec });
  const select = vi.fn().mockReturnValue({ lean });
  return {
    findOne: vi.fn().mockReturnValue({ select, lean, exec }),
    updateOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({}) }),
    _exec: exec,
    _lean: lean,
    _select: select,
  };
}

function makeUserModel(prefs: Record<string, unknown> | null = null) {
  const exec = vi.fn().mockResolvedValue(prefs ? { legalPreferences: prefs } : null);
  const lean = vi.fn().mockReturnValue({ exec });
  const select = vi.fn().mockReturnValue({ lean });
  return {
    findOne: vi.fn().mockReturnValue({ select, lean, exec }),
    updateOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({}) }),
  };
}

describe('MemoryManagerService', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('正常场景：会话历史读写', () => {
    it('appendDialog：追加消息，调用 updateOne + $push', async () => {
      const dialogModel = makeDialogModel();
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      await svc.appendDialog('sess-1', 'u1', { role: 'user', content: '你好' });
      expect(dialogModel.updateOne).toHaveBeenCalledTimes(1);
      const arg = dialogModel.updateOne.mock.calls[0][1];
      expect(arg.$push).toBeDefined();
      // MongoDB $push 单对象推送：messages 为对象而非数组
      expect(arg.$push.messages.content).toBe('你好');
      expect(arg.$push.messages.role).toBe('user');
    });

    it('getDialog：返回会话文档', async () => {
      const doc = {
        sessionId: 'sess-1',
        messages: [{ role: 'user', content: 'hi', ts: new Date() }],
      };
      const dialogModel = makeDialogModel(doc);
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      const r = await svc.getDialog('sess-1');
      expect(r).not.toBeNull();
      expect(r?.sessionId).toBe('sess-1');
    });

    it('getRecentTurns：返回最近 N 轮', async () => {
      const messages = [
        { role: 'user', content: 'm1', ts: new Date('2026-01-01') },
        { role: 'assistant', content: 'm2', ts: new Date('2026-01-02') },
        { role: 'user', content: 'm3', ts: new Date('2026-01-03') },
      ];
      const dialogModel = makeDialogModel({ sessionId: 's', messages });
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      const turns = await svc.getRecentTurns('s', 2);
      expect(turns).toHaveLength(2);
      expect(turns[0].content).toBe('m2');
      expect(turns[1].content).toBe('m3');
    });

    it('getRecentTurns：空会话返回 []', async () => {
      const dialogModel = makeDialogModel({ sessionId: 's', messages: [] });
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      const turns = await svc.getRecentTurns('s');
      expect(turns).toHaveLength(0);
    });
  });

  describe('正常场景：getRelevantMemories', () => {
    it('召回最近 3 轮 + 用户偏好 + 当前意图', async () => {
      const messages = [{ role: 'user', content: '民法典问题', ts: new Date('2026-01-01') }];
      const dialogModel = makeDialogModel({ sessionId: 'trace-x', messages });
      const userModel = makeUserModel({ focusAreas: ['民事'] });
      const svc = new MemoryManagerService(
        dialogModel as never,
        userModel as never,
        logger as never,
      );

      await new Promise<void>((resolve) => {
        requestContext.run({ traceId: 'trace-x', userId: 'u1', startedAt: 0 }, async () => {
          const memories = await svc.getRelevantMemories('legal_qa');
          // 1 dialog + 1 preference + 1 usage
          expect(memories).toHaveLength(3);
          expect(memories.some((m) => m.type === 'dialog')).toBe(true);
          expect(memories.some((m) => m.type === 'preference')).toBe(true);
          expect(memories.some((m) => m.type === 'usage' && m.key === 'current_intent')).toBe(true);
          resolve();
        });
      });
    });
  });

  describe('正常场景：saveMemory', () => {
    it('preference 类型 → 写 user_profile.legalPreferences', async () => {
      const userModel = makeUserModel();
      const svc = new MemoryManagerService(
        makeDialogModel() as never,
        userModel as never,
        logger as never,
      );
      await new Promise<void>((resolve) => {
        requestContext.run({ traceId: 't', userId: 'u1', startedAt: 0 }, async () => {
          await svc.saveMemory({
            type: 'preference',
            key: 'focusAreas',
            value: ['民事'],
            ts: new Date().toISOString(),
          });
          expect(userModel.updateOne).toHaveBeenCalledTimes(1);
          resolve();
        });
      });
    });

    it('dialog 类型 → 写 dialog_record.context', async () => {
      const dialogModel = makeDialogModel();
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      await new Promise<void>((resolve) => {
        requestContext.run({ traceId: 't', startedAt: 0 }, async () => {
          await svc.saveMemory({
            type: 'dialog',
            key: 'k',
            value: 'v',
            ts: new Date().toISOString(),
          });
          expect(dialogModel.updateOne).toHaveBeenCalledTimes(1);
          resolve();
        });
      });
    });
  });

  describe('边界场景', () => {
    it('appendDialog 空 sessionId → 跳过，不调用 model', async () => {
      const dialogModel = makeDialogModel();
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      await svc.appendDialog('', 'u1', { role: 'user', content: 'x' });
      expect(dialogModel.updateOne).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('getRelevantMemories 无上下文 → 仅返回 usage 记忆', async () => {
      const svc = new MemoryManagerService(
        makeDialogModel() as never,
        makeUserModel() as never,
        logger as never,
      );
      const memories = await svc.getRelevantMemories('general_qa');
      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe('usage');
    });

    it('saveMemory case 类型 → 延后 A2，仅 warn 不抛错', async () => {
      const svc = new MemoryManagerService(
        makeDialogModel() as never,
        makeUserModel() as never,
        logger as never,
      );
      await expect(
        svc.saveMemory({ type: 'case', key: 'k', value: 'v', ts: new Date().toISOString() }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('updateCase / getCaseTimeline / cleanupOldest → 延后 A2 不抛错', async () => {
      const svc = new MemoryManagerService(
        makeDialogModel() as never,
        makeUserModel() as never,
        logger as never,
      );
      await expect(svc.updateCase({})).resolves.toBeUndefined();
      await expect(svc.getCaseTimeline('c1')).resolves.toEqual([]);
      await expect(svc.cleanupOldest(10)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('异常场景：DB 失败不阻塞主流程', () => {
    it('appendDialog updateOne 抛错 → 捕获 + 记 error，不抛', async () => {
      const dialogModel = makeDialogModel();
      dialogModel.updateOne.mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error('db down')),
      });
      const svc = new MemoryManagerService(
        dialogModel as never,
        makeUserModel() as never,
        logger as never,
      );
      await expect(
        svc.appendDialog('s', 'u', { role: 'user', content: 'x' }),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('getRelevantMemories 读会话失败 → 降级跳过 dialog，仍返回 preference + usage', async () => {
      const dialogModel = makeDialogModel();
      dialogModel.findOne.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({ exec: vi.fn().mockRejectedValue(new Error('db down')) }),
        }),
      });
      const userModel = makeUserModel({ focusAreas: ['民事'] });
      const svc = new MemoryManagerService(
        dialogModel as never,
        userModel as never,
        logger as never,
      );
      await new Promise<void>((resolve) => {
        requestContext.run({ traceId: 't', userId: 'u1', startedAt: 0 }, async () => {
          const memories = await svc.getRelevantMemories('legal_qa');
          // dialog 失败降级，preference + usage 仍返回
          expect(memories.some((m) => m.type === 'preference')).toBe(true);
          expect(memories.some((m) => m.type === 'usage')).toBe(true);
          expect(memories.some((m) => m.type === 'dialog')).toBe(false);
          resolve();
        });
      });
    });

    it('saveMemory 写入失败 → 捕获 + 记 error，不抛', async () => {
      const userModel = makeUserModel();
      userModel.updateOne.mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error('db down')),
      });
      const svc = new MemoryManagerService(
        makeDialogModel() as never,
        userModel as never,
        logger as never,
      );
      await new Promise<void>((resolve) => {
        requestContext.run({ traceId: 't', userId: 'u1', startedAt: 0 }, async () => {
          await expect(
            svc.saveMemory({
              type: 'preference',
              key: 'k',
              value: 'v',
              ts: new Date().toISOString(),
            }),
          ).resolves.toBeUndefined();
          expect(logger.error).toHaveBeenCalled();
          resolve();
        });
      });
    });
  });
});
