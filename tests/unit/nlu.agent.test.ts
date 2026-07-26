/**
 * NluAgent 单元测试（v2.3-W4，07 §八）。
 *
 * 覆盖：
 *   - AgentCard 字段（agentId=nlu, capabilities, exposure=L-Internal, piiLevel=L3）
 *   - capability 'nlu.extract'：调用 EntityExtractor + CompoundSplitter
 *   - capability 'nlu.clarify' mode=start / mode=answer
 *   - 不支持的 capability → errorCode 7005
 *   - nlu.extract 入参 text 为空 → errorCode 7005
 *   - nlu.clarify answer 模式缺 sessionId → errorCode 7005
 *   - 注册到 AgentRegistry 后 L-Internal 可见性
 *
 * 设计依据：07 §8.1-8.3；A4 §五 5.3。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NluAgent } from '../../src/modules/legal/agents/nlu.agent';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';
import { AGENT_ERROR_CODES } from '../../src/modules/legal/agents/types';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type {
  EntityExtractResult,
  CompoundSplitResult,
  ClarifyResult,
} from '../../src/modules/legal/nlu/nlu.types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-nlu-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 30_000,
    lang: 'zh',
  };
}

function makeInput(capability: string, params: Record<string, unknown> = {}): AgentInvokeInput {
  return {
    capability,
    params,
    piiLevel: 'L3',
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeEntityExtractor() {
  const result: EntityExtractResult = {
    entities: [
      { type: 'person', value: '原告', span: [0, 2], confidence: 0.8, source: 'dict' },
      {
        type: 'case_cause',
        value: '租赁合同纠纷',
        span: [5, 11],
        confidence: 0.85,
        source: 'dict',
      },
    ],
    warnings: [],
    tokensIn: 50,
    tokensOut: 30,
  };
  return {
    extract: vi.fn().mockResolvedValue(result),
    loadLastTurn: vi.fn().mockResolvedValue([]),
  };
}

function makeCompoundSplitter() {
  const result: CompoundSplitResult = {
    subIntents: [
      {
        index: 0,
        subIntent: 'case_analysis',
        subText: '原告起诉被告',
        confidence: 0.9,
        route: 'llm',
        entities: [],
        dependsOn: [],
      },
    ],
    executionOrder: [0],
    isCompound: true,
    warnings: [],
  };
  return {
    split: vi.fn().mockResolvedValue(result),
  };
}

function makeClarificationManager() {
  const startResult: ClarifyResult = {
    clarification: {
      question: '请问本案的案由是什么？',
      options: [
        {
          label: '租赁合同纠纷',
          value: '租赁合同纠纷',
          fill: { slot: 'causeOfAction', value: '租赁合同纠纷' },
        },
      ],
      allowFreeText: true,
      missingSlot: 'causeOfAction',
    },
    sessionId: 'clr-test-001',
    state: 'asking',
    turns: 0,
  };
  const answerResult: ClarifyResult = {
    clarification: null,
    sessionId: 'clr-test-001',
    state: 'answered',
    turns: 1,
  };
  return {
    startClarify: vi.fn().mockResolvedValue(startResult),
    answerClarify: vi.fn().mockResolvedValue(answerResult),
    findActiveSession: vi.fn().mockResolvedValue(null),
    getFilledSlots: vi.fn().mockReturnValue({ causeOfAction: '租赁合同纠纷' }),
  };
}

describe('v2.3-W4 NluAgent（接入 NluModule 三服务）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;
  let entityExtractor: ReturnType<typeof makeEntityExtractor>;
  let compoundSplitter: ReturnType<typeof makeCompoundSplitter>;
  let clarificationManager: ReturnType<typeof makeClarificationManager>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
    entityExtractor = makeEntityExtractor();
    compoundSplitter = makeCompoundSplitter();
    clarificationManager = makeClarificationManager();
  });

  describe('AgentCard', () => {
    it('字段完整：agentId=nlu, 2 capabilities, exposure=L-Internal, piiLevel=L3', () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('nlu');
      expect(agent.card.capabilities).toEqual(['nlu.extract', 'nlu.clarify']);
      expect(agent.card.exposure).toBe('L-Internal');
      expect(agent.card.piiLevel).toBe('L3');
      expect(agent.card.async).toBe(false);
      expect(agent.card.timeout).toBe(12_000);
      expect(agent.card.version).toBe('1.0.0');
    });

    it('outputSchema 包含 disclaimer + lawRefs + traceId', () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const props = (agent.card.outputSchema as { properties: Record<string, unknown> }).properties;
      expect(props.disclaimer).toBeDefined();
      expect(props.lawRefs).toBeDefined();
      expect(props.traceId).toBeDefined();
    });
  });

  describe('capability nlu.extract', () => {
    it('正常调用：返回 entities + isCompound + subIntents', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('nlu.extract', { text: '原告起诉被告，涉及租赁合同纠纷' }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.entities).toBeDefined();
      expect(result.data.isCompound).toBe(true);
      expect(result.data.subIntents).toBeDefined();
      expect(result.data.traceId).toBe('trace-nlu-001');
      expect(result.disclaimer).toBeDefined();
      expect(result.usage.tokensIn).toBe(50);
      expect(result.usage.tokensOut).toBe(30);
      expect(entityExtractor.extract).toHaveBeenCalledTimes(1);
      expect(compoundSplitter.split).toHaveBeenCalledTimes(1);
    });

    it('入参 text 为空 → ok=false + errorCode 7005', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('nlu.extract', { text: '' }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('text');
    });

    it('入参 text 缺失 → ok=false + errorCode 7005', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('nlu.extract', {}), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
    });

    it('EntityExtractor 抛异常 → ok=false + errorCode 7003', async () => {
      entityExtractor.extract.mockRejectedValueOnce(new Error('LLM 不可用'));
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('nlu.extract', { text: '原告起诉' }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.AGENT_DEGRADED);
      expect(result.errorMessage).toContain('NLU 处理异常');
    });
  });

  describe('capability nlu.clarify', () => {
    it('mode=start：启动澄清流程', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('nlu.clarify', {
          mode: 'start',
          intent: 'case_reasoning',
          entities: [],
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.clarification).toBeDefined();
      expect(result.data.state).toBe('asking');
      expect(result.data.sessionId).toBe('clr-test-001');
      expect(clarificationManager.startClarify).toHaveBeenCalledWith(
        'case_reasoning',
        [],
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('mode=answer：处理用户回复', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('nlu.clarify', {
          mode: 'answer',
          sessionId: 'clr-test-001',
          reply: '租赁合同纠纷',
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.state).toBe('answered');
      expect(clarificationManager.answerClarify).toHaveBeenCalledWith(
        'clr-test-001',
        '租赁合同纠纷',
        expect.anything(),
      );
    });

    it('mode=answer 缺 sessionId → ok=false + errorCode 7005', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('nlu.clarify', {
          mode: 'answer',
          reply: '租赁合同纠纷',
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
    });

    it('默认 mode=start（未传 mode 参数）', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('nlu.clarify', {
          intent: 'case_reasoning',
          entities: [],
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(clarificationManager.startClarify).toHaveBeenCalled();
    });
  });

  describe('不支持 capability', () => {
    it('调用 nlu.unknown → ok=false + errorCode 7005', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('nlu.unknown', {}), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('nlu.unknown');
    });
  });

  describe('NluContext 派生', () => {
    it('params.ctx 提供完整上下文 → 透传给服务', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      await agent.invoke(
        makeInput('nlu.extract', {
          text: '测试',
          ctx: {
            sessionId: 's-custom',
            userId: 'u-custom',
            msgId: 'm-custom',
            lastTurnEntities: [],
          },
        }),
        makeCtx(),
      );

      expect(entityExtractor.extract).toHaveBeenCalledWith(
        '测试',
        expect.objectContaining({
          sessionId: 's-custom',
          userId: 'u-custom',
          msgId: 'm-custom',
        }),
      );
    });

    it('无 params.ctx → 从 AgentContext 派生', async () => {
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      await agent.invoke(makeInput('nlu.extract', { text: '测试' }), makeCtx());

      expect(entityExtractor.extract).toHaveBeenCalledWith(
        '测试',
        expect.objectContaining({
          sessionId: 'trace-nlu-001',
          userId: 'user-1',
        }),
      );
    });
  });

  describe('AgentRegistry 注册与可见性', () => {
    it('注册成功，listCards 默认不可见（L-Internal），includeInternal=true 可见', () => {
      const registry = new AgentRegistry();
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      registry.register(agent);

      expect(registry.size).toBe(1);
      expect(registry.capabilityCount).toBe(2); // nlu.extract + nlu.clarify

      // L-Internal → 默认不可见
      const publicCards = registry.listCards();
      expect(publicCards.length).toBe(0);

      // includeInternal=true → 可见
      const allCards = registry.listCards({ includeInternal: true });
      expect(allCards.length).toBe(1);
      expect(allCards[0].agentId).toBe('nlu');
    });

    it('通过 capability lookup 查到 NluAgent', () => {
      const registry = new AgentRegistry();
      const agent = new NluAgent(
        entityExtractor as never,
        clarificationManager as never,
        compoundSplitter as never,
        undefined,
        audit as never,
        logger as never,
      );
      registry.register(agent);

      const nlu = registry.lookup('nlu.extract');
      expect(nlu.card.agentId).toBe('nlu');

      const nlu2 = registry.lookup('nlu.clarify');
      expect(nlu2.card.agentId).toBe('nlu');
    });
  });
});
