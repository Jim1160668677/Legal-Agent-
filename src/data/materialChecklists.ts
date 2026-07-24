/**
 * legal_knowledge 种子数据 · 材料清单（A2-W1，A2 §7.3）。
 *
 * 覆盖民事/刑事/行政常见诉讼材料清单，type=material。
 * 用于 material_checklist 意图路由命中后，KnowledgeBase.queryByType('material', ...) 召回。
 * 由 import-legal-knowledge.ts 导入 legal_knowledge 集合。
 *
 * 数据来源：人工整理（基于各级法院诉讼服务指南公开信息）。
 */
import type { KnowledgeSeedData } from './caseProcesses';

/** 材料清单项（structured.materials 元素） */
export interface MaterialItem {
  name: string;
  required: boolean;
  note?: string;
}

export const MATERIAL_CHECKLISTS: KnowledgeSeedData[] = [
  // ===== 民事起诉材料清单 =====
  {
    type: 'material',
    category: '民事',
    subCategory: '起诉',
    title: '民事起诉材料清单',
    content:
      '向人民法院提起民事诉讼，原告应提交以下材料。起诉状需按被告人数提供副本，' +
      '并附原告身份证明、证据材料等。委托代理人参加诉讼的，需提交授权委托书。',
    structured: {
      materials: [
        { name: '民事起诉状', required: true, note: '正本一份，副本按被告人数提供' },
        { name: '原告身份证明', required: true, note: '身份证复印件；企业需营业执照副本' },
        { name: '法定代表人身份证明书', required: false, note: '原告为法人或其他组织时提供' },
        { name: '授权委托书', required: false, note: '委托代理人参加诉讼时提供' },
        { name: '证据材料清单', required: true, note: '列明证据名称、来源、证明目的' },
        { name: '证据材料', required: true, note: '按被告人数提供副本' },
      ] satisfies MaterialItem[],
    },
    lawRefs: ['民事诉讼法第一百二十二条', '民事诉讼法第一百二十三条'],
    tags: ['民事诉讼', '起诉', '材料清单', '起诉状', '证据'],
  },

  // ===== 民事答辩材料清单 =====
  {
    type: 'material',
    category: '民事',
    subCategory: '答辩',
    title: '民事答辩材料清单',
    content:
      '被告收到起诉状副本后，应在十五日内提交答辩状及相关材料。答辩状应针对原告的诉讼请求、' +
      '事实与理由进行答辩，并可提交反诉请求及相应证据。',
    structured: {
      materials: [
        { name: '民事答辩状', required: true, note: '正本一份，副本按原告人数提供' },
        { name: '被告身份证明', required: true, note: '身份证复印件' },
        { name: '授权委托书', required: false, note: '委托代理人时提供' },
        { name: '反驳证据材料', required: false, note: '针对原告诉讼请求的反驳证据' },
        { name: '反诉状', required: false, note: '提起反诉时提供，按原告人数提供副本' },
      ] satisfies MaterialItem[],
    },
    lawRefs: ['民事诉讼法第一百二十八条'],
    tags: ['民事诉讼', '答辩', '材料清单', '答辩状', '反诉'],
  },

  // ===== 刑事自诉材料清单 =====
  {
    type: 'material',
    category: '刑事',
    subCategory: '自诉',
    title: '刑事自诉材料清单',
    content:
      '刑事自诉案件由被害人或其法定代理人直接向人民法院起诉。自诉人应提交自诉状、' +
      '身份证明及证明被告人犯罪事实的证据材料。自诉案件包括告诉才处理的案件、' +
      '被害人有证据证明的轻微刑事案件等。',
    structured: {
      materials: [
        { name: '刑事自诉状', required: true, note: '正本一份，副本按被告人数提供' },
        { name: '自诉人身份证明', required: true, note: '身份证复印件' },
        { name: '被告人基本信息', required: true, note: '姓名、性别、住址、联系方式等' },
        { name: '犯罪事实证据', required: true, note: '证明被告人犯罪事实的证据材料' },
        { name: '授权委托书', required: false, note: '委托代理人时提供' },
      ] satisfies MaterialItem[],
    },
    lawRefs: ['刑事诉讼法第二百一十条', '刑事诉讼法第二百一十二条'],
    tags: ['刑事诉讼', '自诉', '材料清单', '自诉状', '证据'],
  },

  // ===== 行政诉讼起诉材料清单 =====
  {
    type: 'material',
    category: '行政',
    subCategory: '起诉',
    title: '行政诉讼起诉材料清单',
    content:
      '公民、法人或其他组织认为行政行为侵犯其合法权益，向人民法院提起行政诉讼，' +
      '应提交行政起诉状、原告身份证明、行政行为存在的证据等材料。',
    structured: {
      materials: [
        { name: '行政起诉状', required: true, note: '正本一份，副本按被告人数提供' },
        { name: '原告身份证明', required: true, note: '身份证复印件；法人需营业执照副本' },
        { name: '行政行为存在证据', required: true, note: '如行政决定书、处罚通知书等' },
        { name: '授权委托书', required: false, note: '委托代理人时提供' },
        { name: '其他证据材料', required: false, note: '证明行政行为违法或损害的证据' },
      ] satisfies MaterialItem[],
    },
    lawRefs: ['行政诉讼法第五十条', '行政诉讼法第五十一条'],
    tags: ['行政诉讼', '起诉', '材料清单', '起诉状', '行政行为'],
  },
];
