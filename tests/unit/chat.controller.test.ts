/**
 * ChatController 单元测试（A1-W4）。
 *
 * 覆盖三类场景：
 *   - 正常场景：合法输入 → SSE 帧逐帧写入 + res.end
 *   - 边界场景：空 message / 超长 message → BadRequestException
 *   - 异常场景：Orchestrator 抛错 → error 帧 + done 帧
 *
 * 实现注：手动 new ChatController(orchestratorMock)，直接调用 chat(dto, user, res)，
 *       mock Express Response（setHeader/write/end）。requestContext.run 提供 traceId。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ChatController } from '../../src/modules/legal/chat/chat.controller';
import { CHAT_MESSAGE_MAX_LEN } from '../../src/modules/legal/chat/chat.dto';
import { requestContext } from '../../src/common/context/request-context';

/** 构造 mock OrchestratorService：orchestrate 返回给定帧的异步生成器 */
function makeOrchestrator(frames: unknown[], opts?: { fail?: boolean }) {
  return {
    orchestrate: vi.fn().mockImplementation(async function* (): AsyncGenerator {
      if (opts?.fail) throw new Error('orchestrate boom');
      for (const f of frames) yield f;
    }),
  };
}

/** 构造 mock Express Response */
function makeRes() {
  const written: string[] = [];
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((s: string) => {
      written.push(s);
      return true;
    }),
    end: vi.fn(),
    _written: written,
  };
}

const mockUser = { sub: 'u1', role: 'user' };

/** 在 requestContext 内运行，便于 controller 取 traceId */
async function runInCtx<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestContext.run({ traceId: 'trace-1', userId: 'u1', startedAt: 0 }, async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
  });
}

describe('ChatController', () => {
  let res: ReturnType<typeof makeRes>;

  beforeEach(() => {
    res = makeRes();
  });

  describe('正常场景', () => {
    it('合法输入 → SSE 头设置 + 帧逐帧写入 + res.end', async () => {
      const frames = [
        { type: 'chunk', delta: 'hi' },
        { type: 'meta', intent: 'general_qa', route: 'general_qa', source: 'llm', lawRefs: [] },
        { type: 'disclaimer', text: '免责声明' },
        { type: 'done', traceId: 'trace-1' },
      ];
      const controller = new ChatController(makeOrchestrator(frames) as never);
      await runInCtx(() => controller.chat({ message: '你好' }, mockUser as never, res as never));
      // SSE 头
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.flushHeaders).toHaveBeenCalled();
      // 每帧一次 write
      expect(res.write).toHaveBeenCalledTimes(frames.length);
      // 结束
      expect(res.end).toHaveBeenCalled();
      // 帧内容含 data: 前缀
      expect(res._written[0]).toContain('data: ');
    });

    it('sessionId 缺省时用 traceId 派生', async () => {
      const orch = makeOrchestrator([{ type: 'done', traceId: 'trace-1' }]);
      const controller = new ChatController(orch as never);
      await runInCtx(() => controller.chat({ message: '问题' }, mockUser as never, res as never));
      // orchestrate 入参 ctx.sessionId 应为 traceId
      const ctxArg = orch.orchestrate.mock.calls[0][1];
      expect(ctxArg.sessionId).toBe('trace-1');
    });
  });

  describe('边界场景：入参校验', () => {
    it('空 message → BadRequestException(code:1001)', async () => {
      const controller = new ChatController(makeOrchestrator([]) as never);
      await expect(
        runInCtx(() => controller.chat({ message: '' }, mockUser as never, res as never)),
      ).rejects.toThrow(BadRequestException);
      expect(res.write).not.toHaveBeenCalled();
    });

    it('纯空白 message → BadRequestException', async () => {
      const controller = new ChatController(makeOrchestrator([]) as never);
      await expect(
        runInCtx(() => controller.chat({ message: '   ' }, mockUser as never, res as never)),
      ).rejects.toThrow(BadRequestException);
    });

    it('超长 message → BadRequestException(code:1002)', async () => {
      const controller = new ChatController(makeOrchestrator([]) as never);
      const longMsg = 'a'.repeat(CHAT_MESSAGE_MAX_LEN + 1);
      await expect(
        runInCtx(() => controller.chat({ message: longMsg }, mockUser as never, res as never)),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('异常场景：Orchestrator 抛错', () => {
    it('orchestrate 抛错 → error 帧 + done 帧 + res.end，不抛出', async () => {
      const controller = new ChatController(makeOrchestrator([], { fail: true }) as never);
      await runInCtx(() => controller.chat({ message: '问题' }, mockUser as never, res as never));
      // 写入 error + done 两帧
      expect(res.write).toHaveBeenCalledTimes(2);
      expect(res._written[0]).toContain('"type":"error"');
      expect(res._written[1]).toContain('"type":"done"');
      expect(res.end).toHaveBeenCalled();
    });
  });
});
