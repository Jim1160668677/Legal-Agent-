/**
 * 法律文书模板库（A3-W2，A3 §六）。
 *
 * 4 个模板（对齐 A3 §六文书类型）：
 *   - civil_complaint_v1   民事起诉状
 *   - standard_contract_v1 标准合同
 *   - lawyer_letter_v1     律师函
 *   - civil_defense_v1     民事答辩状
 *
 * 模板正文使用 DSL 语法（src/modules/legal/document/dsl-renderer.ts）：
 *   {{var}} / {{obj.field}} / {{#each list}}...{{/each}} / {{#if cond}}...{{/if}}
 *
 * 每模板含：
 *   - vars：变量 schema（供 validateVars 把关）
 *   - body：DSL 模板正文
 *   - lawRefs：引用法条（文书尾部声明 + 供 RAG 检索）
 *   - version + status：模板版本管理
 *
 * 设计依据：A3 §六文书类型；A3-W2 实施计划阶段 6。
 */
import type { VarSchema } from '../modules/legal/document/dsl-renderer';

export type { VarSchema } from '../modules/legal/document/dsl-renderer';

/** 文书类型枚举 */
export type DocumentType =
  'civil_complaint' | 'standard_contract' | 'lawyer_letter' | 'civil_defense';

/** 当事人信息子字段 schema（plaintiff / defendant / party_a / party_b 复用） */
const PARTY_FIELDS: VarSchema[] = [
  { name: 'name', type: 'string', required: true, maxLength: 60, label: '姓名/名称' },
  {
    name: 'id_no',
    type: 'string',
    required: false,
    maxLength: 32,
    label: '身份证号/统一社会信用代码',
  },
  { name: 'address', type: 'string', required: false, maxLength: 200, label: '住址/地址' },
  { name: 'phone', type: 'string', required: false, format: '^1\\d{10}$', label: '联系电话' },
];

/** 字符串列表项 schema（claims/terms/demands/defense_points 复用） */
const STRING_LIST_ITEM: VarSchema[] = [
  { name: 'item', type: 'string', required: true, maxLength: 500 },
];

export interface DocumentTemplate {
  /** 模板编码（含版本后缀），如 civil_complaint_v1 */
  code: string;
  type: DocumentType;
  version: number;
  status: 'active' | 'deprecated';
  title: string;
  description?: string;
  /** 变量 schema（供 validateVars） */
  vars: VarSchema[];
  /** DSL 模板正文 */
  body: string;
  /** 引用法条（文书声明 + RAG 检索提示） */
  lawRefs: string[];
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  // ===== 民事起诉状 =====
  {
    code: 'civil_complaint_v1',
    type: 'civil_complaint',
    version: 1,
    status: 'active',
    title: '民事起诉状',
    description: '民事诉讼一审起诉状模板，含原被告信息、诉讼请求、事实与理由。',
    vars: [
      { name: 'court_name', type: 'string', required: true, maxLength: 80, label: '受理法院名称' },
      {
        name: 'plaintiff',
        type: 'party_group',
        required: true,
        fields: PARTY_FIELDS,
        label: '原告',
      },
      {
        name: 'defendant',
        type: 'party_group',
        required: true,
        fields: PARTY_FIELDS,
        label: '被告',
      },
      {
        name: 'claims',
        type: 'list',
        required: true,
        itemSchema: STRING_LIST_ITEM,
        label: '诉讼请求',
      },
      { name: 'facts', type: 'string', required: true, maxLength: 3000, label: '事实与理由' },
    ],
    body: [
      '{{court_name}}：',
      '',
      '原告：{{plaintiff.name}}，身份证号：{{plaintiff.id_no}}，住址：{{plaintiff.address}}。',
      '被告：{{defendant.name}}，身份证号：{{defendant.id_no}}，住址：{{defendant.address}}。',
      '',
      '诉讼请求：',
      '{{#each claims}}{{this}}',
      '{{/each}}',
      '事实与理由：',
      '{{facts}}',
      '',
      '此致',
      '{{court_name}}',
      '',
      '具状人：{{plaintiff.name}}',
      '日期：{{sign_date}}',
    ].join('\n'),
    lawRefs: ['民法典第一百四十三条', '民事诉讼法第一百一十九条'],
  },

  // ===== 标准合同 =====
  {
    code: 'standard_contract_v1',
    type: 'standard_contract',
    version: 1,
    status: 'active',
    title: '标准合同',
    description: '通用合同模板，含甲乙双方、合同标的、条款、签署日期。',
    vars: [
      { name: 'party_a', type: 'party_group', required: true, fields: PARTY_FIELDS, label: '甲方' },
      { name: 'party_b', type: 'party_group', required: true, fields: PARTY_FIELDS, label: '乙方' },
      {
        name: 'contract_subject',
        type: 'string',
        required: true,
        maxLength: 200,
        label: '合同标的',
      },
      {
        name: 'terms',
        type: 'list',
        required: true,
        itemSchema: STRING_LIST_ITEM,
        label: '合同条款',
      },
      { name: 'sign_date', type: 'date', required: true, label: '签署日期' },
    ],
    body: [
      '合同',
      '',
      '甲方：{{party_a.name}}，地址：{{party_a.address}}。',
      '乙方：{{party_b.name}}，地址：{{party_b.address}}。',
      '',
      '根据《中华人民共和国民法典》及相关法律法规，甲乙双方在平等、自愿、公平、诚实信用的基础上，就{{contract_subject}}事宜，达成如下协议：',
      '',
      '{{#each terms}}{{this}}',
      '{{/each}}',
      '本合同一式两份，甲乙双方各执一份，自双方签字盖章之日起生效。',
      '',
      '甲方：{{party_a.name}}（签字/盖章）',
      '乙方：{{party_b.name}}（签字/盖章）',
      '签署日期：{{sign_date}}',
    ].join('\n'),
    lawRefs: ['民法典第四百六十四条', '民法典第五百零九条'],
  },

  // ===== 律师函 =====
  {
    code: 'lawyer_letter_v1',
    type: 'lawyer_letter',
    version: 1,
    status: 'active',
    title: '律师函',
    description: '律师函模板，含发函律所、收函人、事由、要求、期限。',
    vars: [
      {
        name: 'sender_firm',
        type: 'string',
        required: true,
        maxLength: 100,
        label: '发函律师事务所',
      },
      { name: 'recipient', type: 'string', required: true, maxLength: 100, label: '收函人' },
      { name: 'matter', type: 'string', required: true, maxLength: 1000, label: '事由' },
      {
        name: 'demands',
        type: 'list',
        required: true,
        itemSchema: STRING_LIST_ITEM,
        label: '具体要求',
      },
      { name: 'deadline', type: 'date', required: true, label: '履行期限' },
    ],
    body: [
      '律师函',
      '',
      '{{sender_firm}}律师函',
      '',
      '{{recipient}}：',
      '',
      '{{sender_firm}}接受委托，就{{matter}}一事，特致函如下：',
      '',
      '现要求贵方：',
      '{{#each demands}}{{this}}',
      '{{/each}}',
      '请贵方于{{deadline}}前履行上述要求，逾期将依法采取进一步法律措施，由此产生的全部法律后果由贵方承担。',
      '',
      '{{sender_firm}}',
      '发函日期：{{sign_date}}',
    ].join('\n'),
    lawRefs: ['民法典第一百四十三条', '律师法第二十八条'],
  },

  // ===== 民事答辩状 =====
  {
    code: 'civil_defense_v1',
    type: 'civil_defense',
    version: 1,
    status: 'active',
    title: '民事答辩状',
    description: '民事答辩状模板，含答辩人信息、案号、答辩要点、致送法院。',
    vars: [
      {
        name: 'defendant_info',
        type: 'party_group',
        required: true,
        fields: PARTY_FIELDS,
        label: '答辩人',
      },
      { name: 'case_no', type: 'string', required: true, maxLength: 60, label: '案号' },
      {
        name: 'defense_points',
        type: 'list',
        required: true,
        itemSchema: STRING_LIST_ITEM,
        label: '答辩要点',
      },
      { name: 'court_name', type: 'string', required: true, maxLength: 80, label: '致送法院' },
    ],
    body: [
      '民事答辩状',
      '',
      '答辩人：{{defendant_info.name}}，身份证号：{{defendant_info.id_no}}，住址：{{defendant_info.address}}。',
      '',
      '因原告就案号{{case_no}}一案起诉答辩人，现提出答辩意见如下：',
      '',
      '{{#each defense_points}}{{this}}',
      '{{/each}}',
      '综上所述，答辩人认为原告的诉讼请求缺乏事实和法律依据，请求人民法院依法驳回原告的诉讼请求。',
      '',
      '此致',
      '{{court_name}}',
      '',
      '答辩人：{{defendant_info.name}}',
      '日期：{{sign_date}}',
    ].join('\n'),
    lawRefs: ['民事诉讼法第一百二十八条'],
  },
];
