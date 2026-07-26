/**
 * 意图槽位定义与澄清模板（v2.3-W4，07 §8.2）。
 *
 * 定义每意图的必填槽位（requiredSlots）、实体到槽位的映射（ENTITY_TO_SLOT_MAP）、
 * 以及每槽位的澄清模板（INTENT_CLARIFICATION_TEMPLATES）。
 *
 * 注：IntentDef（types/intent.ts）不含 requiredSlots/clarificationTemplates 字段，
 *     为避免侵入式修改现有类型，在 NLU 域内单独定义。
 *
 * 设计依据：07 §8.2 第 1/6.2 步；05 3.25 clarification_session.requiredSlots/filledSlots。
 */
import type { IntentType } from '../../../types/intent';

/** 每意图的必填槽位（07 §8.2 第 1 步） */
export const INTENT_REQUIRED_SLOTS: Record<IntentType, string[]> = {
  legal_qa: [],
  document_generate: ['docType'],
  process_guide: ['scenario'],
  case_analysis: ['caseDescription'],
  case_reasoning: ['causeOfAction', 'facts', 'partyRole'],
  material_checklist: ['scenario'],
  tool_invoke: [],
  general_qa: [],
};

/** 实体类型 → 槽位映射（07 §8.2 mapEntitiesToSlots） */
export const ENTITY_TO_SLOT_MAP: Record<string, string> = {
  case_cause: 'causeOfAction',
  legal_term: 'causeOfAction', // 案由通常是 legal_term
  person: 'partyRole',
  org: 'partyRole',
  contract: 'docType',
  // amount/date/evidence 不直接映射槽位，作为 facts 的一部分
};

/** 每意图每槽位的澄清模板（07 §8.2 第 6.2 步） */
export interface ClarifyTemplate {
  question: string;
  /** 预设选项（label/value），LLM 可在此基础上扩展或覆盖 */
  presetOptions?: Array<{ label: string; value: string }>;
  allowFreeText: boolean;
}

export const INTENT_CLARIFICATION_TEMPLATES: Record<IntentType, Record<string, ClarifyTemplate>> = {
  case_reasoning: {
    causeOfAction: {
      question: '请问本案的案由是什么？',
      presetOptions: [
        { label: '租赁合同纠纷', value: '租赁合同纠纷' },
        { label: '买卖合同纠纷', value: '买卖合同纠纷' },
        { label: '劳动争议', value: '劳动争议' },
        { label: '婚姻家庭纠纷', value: '婚姻家庭纠纷' },
        { label: '侵权责任纠纷', value: '侵权责任纠纷' },
      ],
      allowFreeText: true,
    },
    facts: {
      question: '请简要描述案件事实（时间、地点、经过、争议焦点）',
      allowFreeText: true,
    },
    partyRole: {
      question: '您在本案中的角色是？',
      presetOptions: [
        { label: '原告', value: '原告' },
        { label: '被告', value: '被告' },
        { label: '第三人', value: '第三人' },
        { label: '其他', value: '其他' },
      ],
      allowFreeText: true,
    },
  },
  document_generate: {
    docType: {
      question: '请问需要生成哪种文书？',
      presetOptions: [
        { label: '起诉状', value: '起诉状' },
        { label: '答辩状', value: '答辩状' },
        { label: '律师函', value: '律师函' },
        { label: '合同', value: '合同' },
        { label: '协议书', value: '协议书' },
      ],
      allowFreeText: true,
    },
  },
  process_guide: {
    scenario: {
      question: '请问您需要哪类流程指引？',
      presetOptions: [
        { label: '立案流程', value: '立案' },
        { label: '起诉流程', value: '起诉' },
        { label: '举证流程', value: '举证' },
        { label: '上诉流程', value: '上诉' },
        { label: '执行流程', value: '执行' },
      ],
      allowFreeText: true,
    },
  },
  case_analysis: {
    caseDescription: {
      question: '请描述您的案件情况（涉及人物、事件、争议点）',
      allowFreeText: true,
    },
  },
  material_checklist: {
    scenario: {
      question: '请问您需要哪种事项的材料清单？',
      presetOptions: [
        { label: '离婚', value: '离婚' },
        { label: '立案', value: '立案' },
        { label: '起诉', value: '起诉' },
        { label: '上诉', value: '上诉' },
      ],
      allowFreeText: true,
    },
  },
  legal_qa: {},
  tool_invoke: {},
  general_qa: {},
};

/** 答非所问判定阈值（07 §8.2 第 5.5 步） */
export const OFF_TOPIC_MAX_COUNT = 2;

/** 澄清轮数上限（07 §8.2 第 5.4 步） */
export const CLARIFY_TURNS_MAX = 3;

/** 澄清会话 TTL（秒，对齐 05 3.25） */
export const CLARIFY_SESSION_TTL_SEC = 24 * 3600;
