/**
 * ToolRegistry 单元测试（v2.3-W1，14-tool-design.md §2.5）。
 *
 * 覆盖：
 *   - register / get / has / list / size 基础 API
 *   - 重复注册抛 ConflictException
 *   - get 未命中抛 NotFoundException
 *   - dispatch：成功路径 + schema 校验失败 + 工具不存在 + 超时
 *   - LegalToolError 各错误码映射
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ToolRegistry } from '../../src/services/legal/tools/registry';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type LegalTool,
  type ToolContext,
  type ToolId,
} from '../../src/services/legal/tools/types';

function makeCtx(): ToolContext {
  return {
    userId: 'user-test',
    traceId: 'trace-registry-001',
    requestId: 'req-001',
  };
}

/** 构造 mock LegalTool */
function makeMockTool(toolId: ToolId, overrides: Partial<LegalTool> = {}): LegalTool {
  const base: LegalTool = {
    toolId,
    name: toolId,
    description: `mock ${toolId}`,
    category: 'general',
    inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    async: false,
    timeout: 1_000,
    cacheable: false,
    toolVersion: '1.0.0',
    invoke: async () => ({
      success: true,
      data: { ok: true },
      disclaimer: 'mock',
    }),
    ...overrides,
  };
  return base;
}

describe('v2.3-W1 ToolRegistry（14 §2.5）', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register / get / has / list / size', () => {
    it('register 后可通过 get 查到，has 返回 true', () => {
      const tool = makeMockTool('period_calculator');
      registry.register(tool);
      expect(registry.has('period_calculator')).toBe(true);
      expect(registry.get('period_calculator')).toBe(tool);
      expect(registry.size).toBe(1);
    });

    it('重复注册同 toolId 抛 ConflictException', () => {
      registry.register(makeMockTool('period_calculator'));
      expect(() => registry.register(makeMockTool('period_calculator'))).toThrow(ConflictException);
    });

    it('get 未命中抛 NotFoundException', () => {
      expect(() => registry.get('period_calculator' as ToolId)).toThrow(NotFoundException);
    });

    it('list 返回按字母序的 toolId 列表', () => {
      registry.register(makeMockTool('period_calculator'));
      registry.register(makeMockTool('law_validity'));
      registry.register(makeMockTool('clause_recommender'));
      expect(registry.list()).toEqual(['clause_recommender', 'law_validity', 'period_calculator']);
    });
  });

  describe('dispatch：成功路径', () => {
    it('调用 tool.invoke 并返回 ToolResult（含 duration）', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        data: { result: 42 },
        disclaimer: 'mock',
      });
      registry.register(makeMockTool('period_calculator', { invoke }));
      const result = await registry.dispatch('period_calculator', { x: 1 }, makeCtx());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 42 });
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(invoke).toHaveBeenCalledWith({ x: 1 }, expect.anything());
    });

    it('auditLog 写入 tool_invoke（成功）', async () => {
      const auditLog = { write: vi.fn() };
      registry.register(makeMockTool('period_calculator'));
      const ctx = { ...makeCtx(), auditLog };
      await registry.dispatch('period_calculator', { x: 1 }, ctx);
      expect(auditLog.write).toHaveBeenCalledWith(
        'tool_invoke',
        expect.objectContaining({
          toolId: 'period_calculator',
          success: true,
        }),
      );
    });
  });

  describe('dispatch：schema 校验失败', () => {
    it('缺失 required 字段抛 8001 + 审计 tool_invoke_failed', async () => {
      const auditLog = { write: vi.fn() };
      registry.register(makeMockTool('period_calculator'));
      const ctx = { ...makeCtx(), auditLog };
      await expect(registry.dispatch('period_calculator', {}, ctx)).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.INVALID_INPUT,
      });
      expect(auditLog.write).toHaveBeenCalledWith(
        'tool_invoke_failed',
        expect.objectContaining({
          toolId: 'period_calculator',
          errorCode: TOOL_ERROR_CODES.INVALID_INPUT,
        }),
      );
    });

    it('字段类型错误抛 8001', async () => {
      registry.register(makeMockTool('period_calculator'));
      await expect(
        registry.dispatch('period_calculator', { x: 'not-a-number' }, makeCtx()),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.INVALID_INPUT });
    });

    it('skipValidation=true 跳过校验', async () => {
      registry.register(makeMockTool('period_calculator'));
      const result = await registry.dispatch('period_calculator', {}, makeCtx(), {
        skipValidation: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('dispatch：工具不存在', () => {
    it('抛 8002', async () => {
      await expect(
        registry.dispatch('period_calculator', { x: 1 }, makeCtx()),
      ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.TOOL_NOT_FOUND });
    });
  });

  describe('dispatch：工具抛 LegalToolError', () => {
    it('8005 LAW_NOT_FOUND 重新抛出', async () => {
      const invoke = vi
        .fn()
        .mockRejectedValue(
          new LegalToolError(TOOL_ERROR_CODES.LAW_NOT_FOUND, '未命中', 'law_validity'),
        );
      registry.register(makeMockTool('law_validity', { invoke }));
      await expect(registry.dispatch('law_validity', { x: 1 }, makeCtx())).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.LAW_NOT_FOUND,
      });
    });

    it('8003 TIMEOUT 重新抛出（供 ToolAgent 触发降级）', async () => {
      const invoke = vi.fn().mockImplementation(() => {
        return new Promise(() => {
          // 永不 resolve，由 ToolRegistry 超时机制触发
        });
      });
      registry.register(makeMockTool('law_validity', { invoke, timeout: 50 }));
      await expect(registry.dispatch('law_validity', { x: 1 }, makeCtx())).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.TIMEOUT,
      });
    });
  });

  describe('dispatch：未知错误', () => {
    it('非 LegalToolError 重新抛出 + 审计失败', async () => {
      const auditLog = { write: vi.fn() };
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const invoke = vi.fn().mockRejectedValue(new Error('unknown boom'));
      registry.register(makeMockTool('period_calculator', { invoke }));
      const ctx = { ...makeCtx(), auditLog, logger };
      await expect(registry.dispatch('period_calculator', { x: 1 }, ctx)).rejects.toThrow(
        'unknown boom',
      );
      expect(auditLog.write).toHaveBeenCalledWith(
        'tool_invoke_failed',
        expect.objectContaining({ errorMessage: 'unknown boom' }),
      );
    });
  });

  describe('clearForTesting', () => {
    it('清空注册表', () => {
      registry.register(makeMockTool('period_calculator'));
      expect(registry.size).toBe(1);
      registry.clearForTesting();
      expect(registry.size).toBe(0);
    });
  });
});
