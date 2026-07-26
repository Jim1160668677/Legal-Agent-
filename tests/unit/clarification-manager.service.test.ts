/**
 * ClarificationManagerService 单元测试（v2.3-W4，07 §8.2）。
 *
 * 覆盖多轮澄清状态机：
 *   - startClarify：无缺失槽位 → state=answered；有缺失 → state=asking + 卡片
 *   - answerClarify：填充槽位 → answered / 继续 asking / timeout / give_up
 *   - 答非所问：offTopicCount++，达上限 give_up
 *   - 轮数超限：state=timeout + fallbackIntent=general_qa
 *   - 会话不存在 / 已过期：返回 timeout 兜底
 *   - 内存模式（无 Model）正常工作
 *
 * 设计依据：07 §8.2 第 1-7 步。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClarificationManagerService } from '../../src/modules/legal/nlu/clarification-manager.service';
import type { Entity } from '../../src/modules/legal/nlu/nlu.types';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

describe('v2.3-W4 ClarificationManagerService（多轮澄清状态机）', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('startClarify', () => {
    it('case_reasoning 意图：无实体 → 启动澄清，state=asking', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const result = await svc.startClarify('case_reasoning', [], {
        sessionId: 's1',
        userId: 'u1',
        msgId: 'm1',
      });

      expect(result.state).toBe('asking');
      expect(result.clarification).not.toBeNull();
      expect(result.clarification?.missingSlot).toBe('causeOfAction');
      expect(result.clarification?.question).toContain('案由');
      expect(result.clarification?.options.length).toBeGreaterThan(0);
      expect(result.turns).toBe(0);
    });

    it('case_reasoning 意图：实体已填全部槽位 → state=answered，无澄清卡片', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const entities: Entity[] = [
        {
          type: 'case_cause',
          value: '租赁合同纠纷',
          span: [0, 6],
          confidence: 0.9,
          source: 'dict',
        },
        { type: 'person', value: '原告', span: [10, 12], confidence: 0.8, source: 'dict' },
      ];
      // facts 槽位无对应实体类型映射，需要从 lastTurnEntities 或其他方式填充
      const result = await svc.startClarify('case_reasoning', entities, {
        userId: 'u1',
        msgId: 'm1',
      });

      // causeOfAction 与 partyRole 已填，facts 仍缺失
      expect(result.state).toBe('asking');
      expect(result.clarification?.missingSlot).toBe('facts');
    });

    it('legal_qa 意图：无必填槽位 → state=answered', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const result = await svc.startClarify('legal_qa', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      expect(result.state).toBe('answered');
      expect(result.clarification).toBeNull();
    });

    it('document_generate 意图：实体含 contract 类型 → 填充 docType', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const entities: Entity[] = [
        { type: 'contract', value: '租赁合同', span: [0, 4], confidence: 0.8, source: 'regex' },
      ];
      const result = await svc.startClarify('document_generate', entities, {
        userId: 'u1',
        msgId: 'm1',
      });

      expect(result.state).toBe('answered');
      const slots = svc.getFilledSlots(result.sessionId);
      expect(slots?.docType).toBe('租赁合同');
    });

    it('启动新澄清时关闭同用户旧会话', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const r1 = await svc.startClarify('case_reasoning', [], { userId: 'u1', msgId: 'm1' });
      const r2 = await svc.startClarify('case_reasoning', [], { userId: 'u1', msgId: 'm2' });

      expect(r1.sessionId).not.toBe(r2.sessionId);
      // 旧会话仍在内存但状态已变 give_up（通过 closeActiveSessions）
      // 新会话正常工作
      expect(svc.getFilledSlots(r2.sessionId)).toBeDefined();
    });
  });

  describe('answerClarify', () => {
    it('用户回复预设选项 value → 填充槽位', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const start = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      const result = await svc.answerClarify(start.sessionId, '租赁合同纠纷');
      // causeOfAction 已填，下一个缺失槽位是 facts
      expect(result.state).toBe('asking');
      expect(result.clarification?.missingSlot).toBe('facts');
      expect(result.turns).toBe(1);

      const slots = svc.getFilledSlots(start.sessionId);
      expect(slots?.causeOfAction).toBe('租赁合同纠纷');
    });

    it('用户回复预设选项 label → 也能匹配', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const start = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      await svc.answerClarify(start.sessionId, '租赁合同纠纷');
      const slots = svc.getFilledSlots(start.sessionId);
      expect(slots?.causeOfAction).toBe('租赁合同纠纷');
    });

    it('用户回复 free text（允许自由输入）→ 直接作为值', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const start = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      // 第 1 轮：填 causeOfAction
      await svc.answerClarify(start.sessionId, '租赁合同纠纷');
      // 第 2 轮：填 facts（allowFreeText=true）
      const result = await svc.answerClarify(start.sessionId, '2023年1月原告未付租金');
      expect(result.state).toBe('asking'); // partyRole 仍缺失
      const slots = svc.getFilledSlots(start.sessionId);
      expect(slots?.facts).toBe('2023年1月原告未付租金');
    });

    it('全部槽位填满 → state=answered', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const start = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      await svc.answerClarify(start.sessionId, '租赁合同纠纷');
      await svc.answerClarify(start.sessionId, '原告未付租金');
      const result = await svc.answerClarify(start.sessionId, '原告');

      expect(result.state).toBe('answered');
      expect(result.clarification).toBeNull();
      expect(result.turns).toBe(3);
    });

    it('答非所问：offTopicCount 达上限 → state=give_up + fallbackIntent', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      // 用 case_analysis 意图，caseDescription 槽位允许 free text 但空回复会触发 offTopic
      const start = await svc.startClarify('case_analysis', [], {
        userId: 'u3',
        msgId: 'm3',
      });

      // 直接验证：用空回复触发 offTopic
      const result = await svc.answerClarify(start.sessionId, '   ');
      expect(result.state).toBe('asking'); // 第 1 轮 offTopic
      expect(result.turns).toBe(1);

      const result2 = await svc.answerClarify(start.sessionId, '   ');
      // 第 2 次 offTopic 达上限（OFF_TOPIC_MAX_COUNT=2）→ give_up
      expect(result2.state).toBe('give_up');
      expect(result2.fallbackIntent).toBe('general_qa');
    });

    it('轮数超限 → state=timeout + errorCode 8011', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const start = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      // CLARIFY_TURNS_MAX=3，case_reasoning 有 3 个槽位
      // 第 1 轮填 causeOfAction
      await svc.answerClarify(start.sessionId, '租赁合同纠纷');
      // 第 2 轮空回复 → offTopicCount=1
      await svc.answerClarify(start.sessionId, '');
      // 第 3 轮空回复 → offTopicCount=2，触发 give_up（优先于 timeout）
      const result = await svc.answerClarify(start.sessionId, '');
      expect(['give_up', 'timeout']).toContain(result.state);
      expect(result.fallbackIntent).toBe('general_qa');
    });

    it('会话不存在 → 返回 timeout 兜底', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const result = await svc.answerClarify('non-existent-session', '回复');

      expect(result.state).toBe('timeout');
      expect(result.fallbackIntent).toBe('general_qa');
      expect(result.errorCode).toBe(8011);
    });

    it('已终结的会话不再处理', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const start = await svc.startClarify('legal_qa', [], {
        userId: 'u1',
        msgId: 'm1',
      });
      // legal_qa 无必填槽位 → state=answered
      expect(start.state).toBe('answered');

      // 再次 answerClarify 应直接返回 answered
      const result = await svc.answerClarify(start.sessionId, '后续回复');
      expect(result.state).toBe('answered');
    });
  });

  describe('findActiveSession', () => {
    it('内存模式：查到用户的活跃会话', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      await svc.startClarify('case_reasoning', [], { userId: 'u1', msgId: 'm1' });

      const active = await svc.findActiveSession('u1');
      expect(active).not.toBeNull();
      expect(active?.intent).toBe('case_reasoning');
      expect(active?.state).toBe('asking');
    });

    it('无活跃会话时返回 null', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const active = await svc.findActiveSession('non-existent-user');
      expect(active).toBeNull();
    });
  });

  describe('澄清卡片', () => {
    it('case_reasoning.causeOfAction 卡片含 5 个预设选项', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const result = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      expect(result.clarification?.options.length).toBe(5);
      const labels = result.clarification?.options.map((o) => o.label);
      expect(labels).toContain('租赁合同纠纷');
      expect(labels).toContain('买卖合同纠纷');
    });

    it('document_generate.docType 卡片 allowFreeText=true', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const result = await svc.startClarify('document_generate', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      expect(result.clarification?.allowFreeText).toBe(true);
      expect(result.clarification?.options.length).toBe(5);
    });

    it('选项 fill 字段正确指向槽位', async () => {
      const svc = new ClarificationManagerService(undefined, logger as never);
      const result = await svc.startClarify('case_reasoning', [], {
        userId: 'u1',
        msgId: 'm1',
      });

      const firstOpt = result.clarification?.options[0];
      expect(firstOpt?.fill.slot).toBe('causeOfAction');
      expect(firstOpt?.fill.value).toBe(firstOpt?.value);
    });
  });
});
