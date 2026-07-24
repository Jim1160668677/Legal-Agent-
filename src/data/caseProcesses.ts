/**
 * legal_knowledge 种子数据 · 四类诉讼/仲裁流程（A2-W1，A2 §7.3）。
 *
 * 覆盖民事/刑事/商事/行政四类常见流程，type=process。
 * 法条引用基于现行有效法律：民事诉讼法/刑事诉讼法/行政诉讼法/仲裁法。
 * 由 import-legal-knowledge.ts 导入 legal_knowledge 集合，供 KnowledgeBase.queryByType 召回。
 *
 * 数据来源：人工整理（基于国家法律法规数据库公开法律文本）。
 */

/** legal_knowledge 种子条目（对齐 LegalKnowledge schema，省略 _id） */
export interface KnowledgeSeedData {
  type: 'process' | 'material' | 'term' | 'faq' | 'template';
  category: string;
  subCategory?: string;
  title: string;
  content: string;
  structured: Record<string, unknown>;
  lawRefs: string[];
  tags: string[];
}

/** 流程步骤（structured.steps 元素） */
export interface ProcessStep {
  stage: string;
  description: string;
  duration?: string;
  lawRef?: string;
}

export const CASE_PROCESSES: KnowledgeSeedData[] = [
  // ===== 民事诉讼流程 =====
  {
    type: 'process',
    category: '民事',
    subCategory: '一审',
    title: '民事诉讼一审流程',
    content:
      '民事诉讼一审流程包括立案受理、审前准备、开庭审理、宣判与上诉等阶段。' +
      '原告向有管辖权的人民法院起诉，法院经审查符合起诉条件的应当在七日内立案。' +
      '被告应在收到起诉状副本之日起十五日内提交答辩状。开庭审理经法庭调查、法庭辩论、' +
      '最后陈述后依法裁判。当事人不服一审判决的，可在判决书送达之日起十五日内向上一级法院上诉。',
    structured: {
      steps: [
        {
          stage: '立案受理',
          description: '原告向有管辖权法院提交起诉状，法院七日内决定是否立案',
          duration: '7日内',
          lawRef: '民事诉讼法第一百二十六条',
        },
        {
          stage: '审前准备',
          description: '送达起诉状副本，被告十五日内提交答辩状，组织证据交换',
          duration: '15日内答辩',
          lawRef: '民事诉讼法第一百二十八条',
        },
        {
          stage: '开庭审理',
          description: '法庭调查、举证质证、法庭辩论、最后陈述',
          lawRef: '民事诉讼法第一百三十八条',
        },
        {
          stage: '宣判',
          description: '当庭宣判或定期宣判，送达判决书',
          lawRef: '民事诉讼法第一百五十一条',
        },
        {
          stage: '上诉',
          description: '不服一审判决，十五日内向上一级法院上诉',
          duration: '15日内',
          lawRef: '民事诉讼法第一百七十一条',
        },
        {
          stage: '执行',
          description: '义务人不履行生效判决，权利人向法院申请强制执行',
          duration: '两年内申请',
          lawRef: '民事诉讼法第二百四十三条',
        },
      ] satisfies ProcessStep[],
    },
    lawRefs: [
      '民事诉讼法第一百二十六条',
      '民事诉讼法第一百二十八条',
      '民事诉讼法第一百三十八条',
      '民事诉讼法第一百五十一条',
      '民事诉讼法第一百七十一条',
      '民事诉讼法第二百四十三条',
    ],
    tags: ['民事诉讼', '一审', '流程', '立案', '审判', '执行', '答辩', '上诉'],
  },

  // ===== 刑事诉讼流程 =====
  {
    type: 'process',
    category: '刑事',
    subCategory: '一审',
    title: '刑事诉讼流程',
    content:
      '刑事诉讼流程包括立案侦查、审查起诉、审判、执行等阶段。公安机关对刑事案件立案侦查，' +
      '侦查终结后移送人民检察院审查起诉。检察院认为犯罪事实清楚、证据确实充分的，应当作出起诉决定，' +
      '向人民法院提起公诉。法院依法开庭审理，作出判决。当事人不服一审判决的，十日内可上诉。' +
      '判决生效后交付执行。',
    structured: {
      steps: [
        {
          stage: '立案侦查',
          description: '公安机关立案侦查，收集证据、查明犯罪事实',
          lawRef: '刑事诉讼法第一百一十五条',
        },
        {
          stage: '审查起诉',
          description: '检察院审查案件，一个月内决定是否提起公诉',
          duration: '一个月内',
          lawRef: '刑事诉讼法第一百七十二条',
        },
        {
          stage: '一审审判',
          description: '法院开庭审理，法庭调查、辩论、被告人最后陈述后裁判',
          lawRef: '刑事诉讼法第二百零八条',
        },
        {
          stage: '上诉抗诉',
          description: '被告人不服判决十日内上诉，检察院可抗诉',
          duration: '10日内',
          lawRef: '刑事诉讼法第二百三十条',
        },
        {
          stage: '执行',
          description: '判决生效后交付执行机关执行刑罚',
          lawRef: '刑事诉讼法第二百五十九条',
        },
      ] satisfies ProcessStep[],
    },
    lawRefs: [
      '刑事诉讼法第一百一十五条',
      '刑事诉讼法第一百七十二条',
      '刑事诉讼法第二百零八条',
      '刑事诉讼法第二百三十条',
      '刑事诉讼法第二百五十九条',
    ],
    tags: ['刑事诉讼', '流程', '侦查', '审查起诉', '审判', '上诉', '执行'],
  },

  // ===== 行政诉讼流程 =====
  {
    type: 'process',
    category: '行政',
    subCategory: '一审',
    title: '行政诉讼流程',
    content:
      '行政诉讼是公民、法人或其他组织认为行政机关及其工作人员的行政行为侵犯其合法权益，' +
      '依法向人民法院提起的诉讼。法院审查行政行为合法性。流程包括起诉立案、审理、判决、上诉与执行。' +
      '法院收到起诉状后七日内决定是否立案。审理以审查行政行为合法性为原则，' +
      '判决分为驳回诉讼请求、撤销、变更等类型。',
    structured: {
      steps: [
        {
          stage: '起诉立案',
          description: '原告向法院提起行政诉讼，法院七日内决定是否立案',
          duration: '7日内',
          lawRef: '行政诉讼法第五十一条',
        },
        {
          stage: '审理',
          description: '法院审查行政行为合法性，被告负举证责任',
          lawRef: '行政诉讼法第六条',
        },
        {
          stage: '判决',
          description: '判决类型：驳回诉讼请求、撤销、责令履行、变更等',
          lawRef: '行政诉讼法第六十九条',
        },
        {
          stage: '上诉',
          description: '不服一审判决十五日内向上一级法院上诉',
          duration: '15日内',
          lawRef: '行政诉讼法第八十五条',
        },
        {
          stage: '执行',
          description: '当事人不履行生效判决，申请法院强制执行',
          lawRef: '行政诉讼法第九十四条',
        },
      ] satisfies ProcessStep[],
    },
    lawRefs: [
      '行政诉讼法第五十一条',
      '行政诉讼法第六条',
      '行政诉讼法第六十九条',
      '行政诉讼法第八十五条',
      '行政诉讼法第九十四条',
    ],
    tags: ['行政诉讼', '流程', '立案', '合法性审查', '判决', '上诉', '执行'],
  },

  // ===== 商事仲裁流程 =====
  {
    type: 'process',
    category: '商事',
    subCategory: '仲裁',
    title: '商事仲裁流程',
    content:
      '商事仲裁是当事人根据仲裁协议将争议提交仲裁机构裁决的争议解决方式，实行一裁终局。' +
      '流程包括申请仲裁、组成仲裁庭、审理、裁决与执行。当事人应提交仲裁协议和仲裁申请书，' +
      '选定或由仲裁委员会主任指定仲裁员组成仲裁庭。仲裁庭开庭审理后作出裁决，裁决自作出之日起生效。' +
      '一方当事人不履行的，另一方可向人民法院申请执行。',
    structured: {
      steps: [
        {
          stage: '申请仲裁',
          description: '当事人提交仲裁协议和仲裁申请书，仲裁委员会受理',
          lawRef: '仲裁法第二十二条',
        },
        {
          stage: '组成仲裁庭',
          description: '当事人选定或仲裁委主任指定仲裁员，组成合议庭或独任庭',
          lawRef: '仲裁法第三十一条',
        },
        {
          stage: '审理',
          description: '开庭审理或书面审理，当事人举证质证、辩论',
          lawRef: '仲裁法第三十九条',
        },
        {
          stage: '裁决',
          description: '仲裁庭作出裁决，一裁终局，裁决自作出之日起生效',
          lawRef: '仲裁法第五十七条',
        },
        {
          stage: '执行',
          description: '一方不履行裁决，另一方向人民法院申请执行',
          lawRef: '仲裁法第六十二条',
        },
      ] satisfies ProcessStep[],
    },
    lawRefs: [
      '仲裁法第二十二条',
      '仲裁法第三十一条',
      '仲裁法第三十九条',
      '仲裁法第五十七条',
      '仲裁法第六十二条',
    ],
    tags: ['商事仲裁', '仲裁', '流程', '一裁终局', '仲裁庭', '裁决', '执行'],
  },
];
