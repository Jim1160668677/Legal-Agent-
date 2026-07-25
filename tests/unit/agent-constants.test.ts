/**
 * Agent 常量单测（A4-W1）。
 *
 * 验证：
 *   - PLAN_BY_INTENT 覆盖 8 个 IntentType（07 §1.1）
 *   - 每个计划的步骤非空、agentIds 非空
 *   - 异步 agent 标记 async=true（document_generate / case_analysis / case_reasoning）
 *   - ASYNC_AGENT_IDS / STUB_AGENT_IDS 集合正确
 *   - A4-N1 修正：tool_invoke 编排计划存在（single 模式 + shortCircuit）
 */
import { describe, it, expect } from 'vitest';
import {
  PLAN_BY_INTENT,
  ASYNC_AGENT_IDS,
  STUB_AGENT_IDS,
  DEFAULT_AGENT_TIMEOUT_MS,
  ASYNC_JOB_TIMEOUT_MS,
  FALLBACK_DISCLAIMER,
} from '../../src/modules/legal/agents/agents.constants';

const ALL_INTENTS = [
  'legal_qa',
  'document_generate',
  'process_guide',
  'case_analysis',
  'case_reasoning',
  'material_checklist',
  'tool_invoke',
  'general_qa',
];

describe('Agent 常量', () => {
  describe('PLAN_BY_INTENT', () => {
    it('覆盖全部 8 个 IntentType', () => {
      for (const intent of ALL_INTENTS) {
        expect(PLAN_BY_INTENT[intent], `intent ${intent} 缺失编排计划`).toBeDefined();
      }
      expect(Object.keys(PLAN_BY_INTENT)).toHaveLength(8);
    });

    it('每个计划步骤非空且 agentIds 非空', () => {
      for (const plan of Object.values(PLAN_BY_INTENT)) {
        expect(plan.steps.length).toBeGreaterThan(0);
        for (const step of plan.steps) {
          expect(step.agentIds.length).toBeGreaterThan(0);
          expect(['single', 'parallel', 'serial']).toContain(step.mode);
        }
      }
    });

    it('异步意图标记 async=true', () => {
      expect(PLAN_BY_INTENT.document_generate.async).toBe(true);
      expect(PLAN_BY_INTENT.case_analysis.async).toBe(true);
      expect(PLAN_BY_INTENT.case_reasoning.async).toBe(true);
    });

    it('同步意图标记 async=false', () => {
      expect(PLAN_BY_INTENT.legal_qa.async).toBe(false);
      expect(PLAN_BY_INTENT.process_guide.async).toBe(false);
      expect(PLAN_BY_INTENT.material_checklist.async).toBe(false);
      expect(PLAN_BY_INTENT.general_qa.async).toBe(false);
      expect(PLAN_BY_INTENT.tool_invoke.async).toBe(false);
    });

    it('A4-N1 修正：tool_invoke 编排计划存在（single + shortCircuit）', () => {
      const plan = PLAN_BY_INTENT.tool_invoke;
      expect(plan).toBeDefined();
      expect(plan.steps[0].mode).toBe('single');
      expect(plan.steps[0].agentIds).toContain('tool');
      expect(plan.steps[0].shortCircuit).toBe(true);
    });

    it('legal_qa 串行短路（law-lookup → legal-qa）', () => {
      const plan = PLAN_BY_INTENT.legal_qa;
      expect(plan.steps[0].mode).toBe('serial');
      expect(plan.steps[0].agentIds).toEqual(['law-lookup', 'legal-qa']);
      expect(plan.steps[0].shortCircuit).toBe(true);
    });

    it('document_generate 并行召回 + 串行生成', () => {
      const plan = PLAN_BY_INTENT.document_generate;
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].mode).toBe('parallel');
      expect(plan.steps[0].agentIds.sort()).toEqual(['law-lookup', 'process-guide']);
      expect(plan.steps[1].mode).toBe('serial');
      expect(plan.steps[1].agentIds).toEqual(['document']);
    });
  });

  describe('ASYNC_AGENT_IDS', () => {
    it('包含 4 个异步 agent', () => {
      expect(ASYNC_AGENT_IDS.size).toBe(4);
      expect(ASYNC_AGENT_IDS.has('document')).toBe(true);
      expect(ASYNC_AGENT_IDS.has('case-analysis')).toBe(true);
      expect(ASYNC_AGENT_IDS.has('reasoning')).toBe(true);
      expect(ASYNC_AGENT_IDS.has('lawyer-review')).toBe(true);
    });
  });

  describe('STUB_AGENT_IDS', () => {
    it('包含 4 个桩 agent（A4-W4 完整实现）', () => {
      expect(STUB_AGENT_IDS.size).toBe(4);
      expect(STUB_AGENT_IDS.has('tool')).toBe(true);
      expect(STUB_AGENT_IDS.has('nlu')).toBe(true);
      expect(STUB_AGENT_IDS.has('reasoning')).toBe(true);
      expect(STUB_AGENT_IDS.has('lawyer-review')).toBe(true);
    });
  });

  describe('超时常量', () => {
    it('DEFAULT_AGENT_TIMEOUT_MS 为 30s', () => {
      expect(DEFAULT_AGENT_TIMEOUT_MS).toBe(30_000);
    });

    it('ASYNC_JOB_TIMEOUT_MS 为 60s（对齐 A3 JobService）', () => {
      expect(ASYNC_JOB_TIMEOUT_MS).toBe(60_000);
    });
  });

  describe('FALLBACK_DISCLAIMER', () => {
    it('非空且包含"不构成法律意见"', () => {
      expect(FALLBACK_DISCLAIMER.length).toBeGreaterThan(0);
      expect(FALLBACK_DISCLAIMER).toContain('不构成法律意见');
    });
  });
});
