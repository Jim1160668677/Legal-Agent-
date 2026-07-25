/**
 * Prompt 模板数据源（A3-W1，A3 §3.1）。
 *
 * MVP 阶段：代码内存储；后续迁移至 prompt_template 集合或 document_template 集合。
 *
 * 版本管理：新版本灰度发布（FeatureFlag 控制流量百分比）；旧版本保留供回滚。
 * 渲染：{{variable}} 占位符替换 + 缺失变量校验（PromptRegistry.render）。
 *
 * 设计依据：A3 §3.1；07 §五 Prompt 工程规范。
 */

/** Prompt 模板状态 */
export type PromptTemplateStatus = 'active' | 'deprecated';

/** Prompt 模板定义 */
export interface PromptTemplate {
  /** 模板 ID，如 'legal_qa_v1'、'document_generate_v1' */
  templateId: string;
  /** 版本号（同 templateId 可多版本灰度） */
  version: number;
  /** 系统提示词（角色/约束/输出规范） */
  systemPrompt: string;
  /** 用户提示词模板（含 {{variable}} 占位符） */
  userPromptTemplate: string;
  /** 声明所需变量（render 时校验缺失） */
  variables: string[];
  /** 模板状态：active 默认返回；deprecated 仅显式指定 version 时返回 */
  status: PromptTemplateStatus;
}

/** legal_qa_v1 system prompt（对齐 OrchestratorService.LLM_SYSTEM_PROMPT，07 §五） */
const LEGAL_QA_SYSTEM_PROMPT =
  '你是法律智能助手，提供法律信息参考，不构成法律意见。' +
  '回答需准确、客观，引用法条请标注法律名称与条号。';

/** Prompt 模板种子集 */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    templateId: 'legal_qa_v1',
    version: 1,
    systemPrompt: LEGAL_QA_SYSTEM_PROMPT,
    userPromptTemplate:
      '{{user_question}}\n\n' +
      '{{#if retrieved_context}}\n相关法条/案例参考：\n{{retrieved_context}}\n{{/if}}\n' +
      '{{#if user_preferences}}\n用户偏好：{{user_preferences}}\n{{/if}}',
    variables: ['user_question', 'retrieved_context', 'user_preferences'],
    status: 'active',
  },
  {
    templateId: 'document_generate_v1',
    version: 1,
    systemPrompt:
      '你是法律文书起草助手，根据用户提供的变量和模板生成规范的法律文书。' +
      '文书须结构清晰、引用法条准确，文尾强制附加免责声明。' +
      '不构成法律意见，建议用户交执业律师审核。',
    userPromptTemplate:
      '请根据以下信息生成{{doc_type}}：\n\n' +
      '模板变量：\n{{vars_json}}\n\n' +
      '事实与理由：\n{{facts}}\n\n' +
      '{{#if retrieved_law_refs}}\n相关法条参考：\n{{retrieved_law_refs}}\n{{/if}}',
    variables: ['doc_type', 'vars_json', 'facts', 'retrieved_law_refs'],
    status: 'active',
  },
];
