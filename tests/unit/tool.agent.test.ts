/**
 * ToolAgent 单元测试（v2.3-W1，14-tool-design.md §一 1.3）。
 *
 * 覆盖：
 *   - AgentCard 字段（agentId=tool, 8 capabilities, exposure=L-Read, piiLevel=L2）
 *   - ToolRegistry 未注入 → 降级桩（NOT_IMPLEMENTED 7005）
 *   - capability → toolId 映射：tool.period_calculator → period_calculator
 *   - 成功路径：dispatch 返回 ToolResult → 转 AgentInvokeOutput（ok=true）
 *   - 失败路径：LegalToolError 8005 → AgentInvokeOutput（ok=false, errorCode）
 *   - 超时路径：8003 → 重新抛出（触发 BaseAgent 降级）
 *   - capability 无法解析 → 7005
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolAgent, TOOL_CAPABILITIES } from '../../src/modules/legal/agents/tool.agent';
import { ToolRegistry } from '../../src/services/legal/tools/registry';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type LegalTool,
  type ToolId,
} from '../../src/services/legal/tools/types';
import { AGENT_ERROR_CODES } from '../../src/modules/legal/agents/types';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-tool-agent-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 30_000,
    lang: 'zh',
  };
}

function makeInput(capability: string, args?: Record<string, unknown>): AgentInvokeInput {
  return {
    capability,
    params: args ? { args } : {},
    piiLevel: 'L1',
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

/** 构造 mock LegalTool，invoke 返回固定成功结果 */
function makeMockTool(toolId: ToolId): LegalTool {
  return {
    toolId,
    name: toolId,
    description: `mock ${toolId}`,
    category: 'general',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    async: false,
    timeout: 1_000,
    cacheable: false,
    toolVersion: '1.0.0',
    invoke: async () => ({
      success: true,
      data: { toolId, result: 'ok' },
      lawRefs: [{ ref: 'mock-ref', title: 'mock', verified: true }],
      disclaimer: 'mock-disclaimer',
    }),
  };
}

describe('v2.3-W1 ToolAgent（14 §一 1.3）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('字段：agentId=tool, 8 capabilities, exposure=L-Read, piiLevel=L2', () => {
      const agent = new ToolAgent(undefined, undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('tool');
      expect(agent.card.capabilities).toHaveLength(8);
      expect(agent.card.capabilities).toEqual([...TOOL_CAPABILITIES]);
      expect(agent.card.exposure).toBe('L-Read');
      expect(agent.card.piiLevel).toBe('L2');
      expect(agent.card.async).toBe(false);
      expect(agent.card.timeout).toBe(10_000);
      expect(agent.card.version).toBe('1.0.0');
    });

    it('capabilities 与设计文档 8 工具对齐', () => {
      const agent = new ToolAgent(undefined, undefined, audit as never, logger as never);
      const expected = [
        'tool.period_calculator',
        'tool.document_review',
        'tool.compensation_query',
        'tool.license_ocr',
        'tool.law_validity',
        'tool.cause_classification',
        'tool.sentencing_guide',
        'tool.clause_recommender',
      ];
      expect(agent.card.capabilities).toEqual(expected);
    });
  });

  describe('降级：ToolRegistry 未注入', () => {
    it('返回 NOT_IMPLEMENTED 7005（保持桩行为）', async () => {
      const agent = new ToolAgent(undefined, undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('tool.period_calculator'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('ToolRegistry');
    });
  });

  describe('成功路径', () => {
    it('tool.period_calculator 调用 → dispatch → ok=true', async () => {
      const registry = new ToolRegistry();
      registry.register(makeMockTool('period_calculator'));
      const agent = new ToolAgent(registry, undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('tool.period_calculator'), makeCtx());
      expect(result.ok).toBe(true);
      expect(result.data.toolId).toBe('period_calculator');
      // mock 工具返回 data={toolId, result:'ok'}，ToolAgent 包成 data.result 对象
      expect(result.data.result).toMatchObject({ toolId: 'period_calculator', result: 'ok' });
      expect(result.lawRefs).toHaveLength(1);
      expect(result.disclaimer).toBe('mock-disclaimer');
      expect(result.verified).toBe(true);
      expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('调用任一 capability 都正确路由', async () => {
      const registry = new ToolRegistry();
      const agent = new ToolAgent(registry, undefined, audit as never, logger as never);
      // 注册全部 8 个 mock tool
      const toolIds: ToolId[] = [
        'period_calculator',
        'document_review',
        'compensation_query',
        'license_ocr',
        'law_validity',
        'cause_classification',
        'sentencing_guide',
        'clause_recommender',
      ];
      for (const id of toolIds) registry.register(makeMockTool(id));

      for (const cap of agent.card.capabilities) {
        const result = await agent.invoke(makeInput(cap), makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data.toolId).toBe(cap.slice(5));
      }
    });
  });

  describe('失败路径：LegalToolError 映射', () => {
    it('8005 LAW_NOT_FOUND → ok=false + errorCode 7005', async () => {
      const registry = new ToolRegistry();
      const tool = makeMockTool('law_validity');
      tool.invoke = async () => {
        throw new LegalToolError(TOOL_ERROR_CODES.LAW_NOT_FOUND, '法条未命中', 'law_validity');
      };
      registry.register(tool);
      const agent = new ToolAgent(registry, undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('tool.law_validity'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('8005');
      expect(result.errorMessage).toContain('法条未命中');
    });

    it('8001 INVALID_INPUT → ok=false', async () => {
      const registry = new ToolRegistry();
      const tool = makeMockTool('period_calculator');
      tool.invoke = async () => {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          '入参非法',
          'period_calculator',
          'x',
        );
      };
      registry.register(tool);
      const agent = new ToolAgent(registry, undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('tool.period_calculator'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain('8001');
    });
  });

  describe('超时路径：8003 重新抛出', () => {
    it('TIMEOUT 错误重新抛出（供 BaseAgent 触发 fallback）', async () => {
      const registry = new ToolRegistry();
      const tool = makeMockTool('period_calculator');
      tool.invoke = async () => {
        throw new LegalToolError(TOOL_ERROR_CODES.TIMEOUT, '工具超时', 'period_calculator');
      };
      registry.register(tool);
      const agent = new ToolAgent(registry, undefined, audit as never, logger as never);
      // BaseAgent 捕获含「超时」的错误后包装为 `Agent tool 超时（...ms）`
      await expect(agent.invoke(makeInput('tool.period_calculator'), makeCtx())).rejects.toThrow(
        '超时',
      );
    });
  });

  describe('capability 无法解析', () => {
    it('capability 非 tool.* 前缀 → 7005', async () => {
      const registry = new ToolRegistry();
      const agent = new ToolAgent(registry, undefined, audit as never, logger as never);
      // 注意：BaseAgent 会用 capability[0] 兜底，这里直接构造一个未知 capability
      const result = await agent.invoke(
        { capability: 'tool.unknown_tool', params: {}, piiLevel: 'L1' },
        makeCtx(),
      );
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('无法解析');
    });
  });
});
