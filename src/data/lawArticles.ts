/**
 * 常用法条内存快取种子集（A1-W3）。
 *
 * 权威源：国家法律法规数据库（https://flk.npc.gov.cn）公开数据。
 * 用途：RuleEngine 启动时加载至内存 Map，保证法条精确匹配 < 100ms（A1 §十三验收第 4 项）。
 *
 * 范围：覆盖民法典 / 刑法 / 民事诉讼法 / 劳动合同法 / 行政诉讼法 等高频引用条文。
 * 本种子集为 A1-W3 MVP 子集（~40 条），完整 200 条快取由 A2 知识库管道从 law_article
 * 集合全量加载（development-plan.md A1-W3 交付物）。
 *
 * 字段对齐 LawArticle schema（src/infra/database/schemas/legal.schema.ts），
 * content 为条文正文（过长条文做合理节选并标注），keywords 供关键词匹配召回。
 */
export interface LawArticleData {
  lawName: string;
  /** 条号原文："第一百四十三条" */
  articleNo: string;
  /** 条号整数：143（用于精确匹配键） */
  articleNoInt: number;
  /** 业务分类 */
  category: string;
  /** 条文正文 */
  content: string;
  /** 检索关键词 */
  keywords: string[];
  /** 法律位阶（07 §7.5 枚举） */
  legalHierarchy: string;
  status: 'effective' | 'repealed' | 'amended';
}

export const LAW_ARTICLES: LawArticleData[] = [
  // ===== 民法典 =====
  {
    lawName: '民法典',
    articleNo: '第一百四十三条',
    articleNoInt: 143,
    category: '民法总则',
    content:
      '具备下列条件的民事法律行为有效：（一）行为人具有相应的民事行为能力；（二）意思表示真实；（三）不违反法律、行政法规的强制性规定，不违背公序良俗。',
    keywords: ['民事法律行为', '有效', '民事行为能力', '意思表示', '公序良俗'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一百八十八条',
    articleNoInt: 188,
    category: '民法总则',
    content:
      '向人民法院请求保护民事权利的诉讼时效期间为三年。法律另有规定的，依照其规定。诉讼时效期间自权利人知道或者应当知道权利受到损害以及义务人之日起计算。',
    keywords: ['诉讼时效', '三年', '民事权利', '时效期间'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第五百零九条',
    articleNoInt: 509,
    category: '合同编',
    content:
      '当事人应当按照约定全面履行自己的义务。当事人应当遵循诚信原则，根据合同的性质、目的和交易习惯履行通知、协助、保密等义务。',
    keywords: ['合同履行', '诚信原则', '全面履行', '通知协助保密'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第五百七十七条',
    articleNoInt: 577,
    category: '合同编',
    content:
      '当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。',
    keywords: ['违约责任', '不履行', '补救措施', '赔偿损失'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一千一百六十五条',
    articleNoInt: 1165,
    category: '侵权责任编',
    content:
      '行为人因过错侵害他人民事权益造成损害的，应当承担侵权责任。依照法律规定推定行为人有过错，其不能证明自己没有过错的，应当承担侵权责任。',
    keywords: ['过错侵权', '侵权责任', '民事权益', '过错推定'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一千一百七十九条',
    articleNoInt: 1179,
    category: '侵权责任编',
    content:
      '侵害他人造成人身损害的，应当赔偿医疗费、护理费、交通费、营养费、住院伙食补助费等为治疗和康复支出的合理费用，以及因误工减少的收入。造成残疾的，还应当赔偿辅助器具费和残疾赔偿金；造成死亡的，还应当赔偿丧葬费和死亡赔偿金。',
    keywords: ['人身损害赔偿', '医疗费', '护理费', '误工费', '残疾赔偿金', '死亡赔偿金'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一千零七十九条',
    articleNoInt: 1079,
    category: '婚姻家庭编',
    content:
      '夫妻一方要求离婚的，可以由有关组织进行调解或者直接向人民法院提起离婚诉讼。人民法院审理离婚案件，应当进行调解；如果感情确已破裂，调解无效的，应当准予离婚。',
    keywords: ['诉讼离婚', '离婚', '感情破裂', '调解', '准予离婚'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一千零八十七条',
    articleNoInt: 1087,
    category: '婚姻家庭编',
    content:
      '离婚时，夫妻的共同财产由双方协议处理；协议不成的，由人民法院根据财产的具体情况，按照照顾子女、女方和无过错方权益的原则判决。',
    keywords: ['离婚财产分割', '共同财产', '财产分割', '照顾子女女方'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一千一百二十七条',
    articleNoInt: 1127,
    category: '继承编',
    content:
      '遗产按照下列顺序继承：（一）第一顺序：配偶、子女、父母；（二）第二顺序：兄弟姐妹、祖父母、外祖父母。继承开始后，由第一顺序继承人继承，第二顺序继承人不继承；没有第一顺序继承人继承的，由第二顺序继承人继承。',
    keywords: ['法定继承', '继承顺序', '配偶子女父母', '遗产'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民法典',
    articleNo: '第一百五十三条',
    articleNoInt: 153,
    category: '民法总则',
    content:
      '违反法律、行政法规的强制性规定的民事法律行为无效。但是，该强制性规定不导致该民事法律行为无效的除外。违背公序良俗的民事法律行为无效。',
    keywords: ['民事法律行为无效', '强制性规定', '公序良俗', '无效'],
    legalHierarchy: 'law',
    status: 'effective',
  },

  // ===== 刑法 =====
  {
    lawName: '刑法',
    articleNo: '第十三条',
    articleNoInt: 13,
    category: '刑法总则',
    content:
      '一切危害国家主权、领土完整和安全，分裂国家、颠覆人民民主专政的政权和推翻社会主义制度，破坏社会秩序和经济秩序，侵犯国有财产或者劳动群众集体所有的财产，侵犯公民私人所有的财产，侵犯公民的人身权利、民主权利和其他权利，以及其他危害社会的行为，依照法律应当受刑罚处罚的，都是犯罪，但是情节显著轻微危害不大的，不认为是犯罪。',
    keywords: ['犯罪概念', '犯罪', '情节显著轻微', '危害社会'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第十四条',
    articleNoInt: 14,
    category: '刑法总则',
    content:
      '明知自己的行为会发生危害社会的结果，并且希望或者放任这种结果发生，因而构成犯罪的，是故意犯罪。故意犯罪，应当负刑事责任。',
    keywords: ['故意犯罪', '明知', '希望放任', '刑事责任'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第十五条',
    articleNoInt: 15,
    category: '刑法总则',
    content:
      '应当预见自己的行为可能发生危害社会的结果，因为疏忽大意而没有预见，或者已经预见而轻信能够避免，以致发生这种结果的，是过失犯罪。过失犯罪，法律有规定的才负刑事责任。',
    keywords: ['过失犯罪', '疏忽大意', '轻信能够避免', '应当预见'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第二十条',
    articleNoInt: 20,
    category: '刑法总则',
    content:
      '为了使国家、公共利益、本人或者他人的人身、财产和其他权利免受正在进行的不法侵害，而采取的制止不法侵害的行为，对不法侵害人造成损害的，属于正当防卫，不负刑事责任。正当防卫明显超过必要限度造成重大损害的，应当负刑事责任，但是应当减轻或者免除处罚。',
    keywords: ['正当防卫', '不法侵害', '必要限度', '不负刑事责任'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第二十一条',
    articleNoInt: 21,
    category: '刑法总则',
    content:
      '为了使国家、公共利益、本人或者他人的人身、财产和其他权利免受正在发生的危险，不得已采取的紧急避险行为，造成损害的，不负刑事责任。紧急避险超过必要限度造成不应有的损害的，应当负刑事责任，但是应当减轻或者免除处罚。',
    keywords: ['紧急避险', '危险', '必要限度', '不负刑事责任'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第二百三十二条',
    articleNoInt: 232,
    category: '侵犯公民人身权利',
    content:
      '故意杀人的，处死刑、无期徒刑或者十年以上有期徒刑；情节较轻的，处三年以上十年以下有期徒刑。',
    keywords: ['故意杀人罪', '死刑', '无期徒刑', '有期徒刑'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第二百三十四条',
    articleNoInt: 234,
    category: '侵犯公民人身权利',
    content:
      '故意伤害他人身体的，处三年以下有期徒刑、拘役或者管制。犯前款罪，致人重伤的，处三年以上十年以下有期徒刑；致人死亡或者以特别残忍手段致人重伤造成严重残疾的，处十年以上有期徒刑、无期徒刑或者死刑。',
    keywords: ['故意伤害罪', '重伤', '有期徒刑', '拘役管制'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第二百六十四条',
    articleNoInt: 264,
    category: '侵犯财产',
    content:
      '盗窃公私财物，数额较大的，或者多次盗窃、入户盗窃、携带凶器盗窃、扒窃的，处三年以下有期徒刑、拘役或者管制，并处或者单处罚金；数额巨大或者有其他严重情节的，处三年以上十年以下有期徒刑，并处罚金；数额特别巨大或者有其他特别严重情节的，处十年以上有期徒刑或者无期徒刑，并处罚金或者没收财产。',
    keywords: ['盗窃罪', '数额较大', '入户盗窃', '扒窃', '罚金'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第二百六十六条',
    articleNoInt: 266,
    category: '侵犯财产',
    content:
      '诈骗公私财物，数额较大的，处三年以下有期徒刑、拘役或者管制，并处或者单处罚金；数额巨大或者有其他严重情节的，处三年以上十年以下有期徒刑，并处罚金；数额特别巨大或者有其他特别严重情节的，处十年以上有期徒刑或者无期徒刑，并处罚金或者没收财产。',
    keywords: ['诈骗罪', '数额较大', '骗取', '罚金'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '刑法',
    articleNo: '第一百三十三条',
    articleNoInt: 133,
    category: '危害公共安全',
    content:
      '违反交通运输管理法规，因而发生重大事故，致人重伤、死亡或者使公私财产遭受重大损失的，处三年以下有期徒刑或者拘役；交通运输肇事后逃逸或者有其他特别恶劣情节的，处三年以上七年以下有期徒刑；因逃逸致人死亡的，处七年以上有期徒刑。',
    keywords: ['交通肇事罪', '重大事故', '逃逸', '有期徒刑'],
    legalHierarchy: 'law',
    status: 'effective',
  },

  // ===== 民事诉讼法 =====
  {
    lawName: '民事诉讼法',
    articleNo: '第一百一十九条',
    articleNoInt: 119,
    category: '诉讼程序',
    content:
      '起诉必须符合下列条件：（一）原告是与本案有直接利害关系的公民、法人和其他组织；（二）有明确的被告；（三）有具体的诉讼请求和事实、理由；（四）属于人民法院受理民事诉讼的范围和受诉人民法院管辖。',
    keywords: ['起诉条件', '原告', '被告', '诉讼请求', '管辖'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民事诉讼法',
    articleNo: '第九十二条',
    articleNoInt: 92,
    category: '诉讼程序',
    content:
      '期间以时、日、月、年计算。期间开始的时和日，不计算在期间内。期间届满的最后一日是节假日的，以节假日后的第一日为期间届满的日期。期间不包括在途时间，诉讼文书在期满前交邮的，不算过期。',
    keywords: ['期间计算', '节假日顺延', '在途时间', '期间届满'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民事诉讼法',
    articleNo: '第一百六十四条',
    articleNoInt: 164,
    category: '诉讼程序',
    content:
      '人民法院适用简易程序审理案件，应当在立案之日起三个月内审结。有特殊情况需要延长的，经本院院长批准，可以延长一个月。',
    keywords: ['简易程序', '审限', '三个月', '立案'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民事诉讼法',
    articleNo: '第一百四十九条',
    articleNoInt: 149,
    category: '诉讼程序',
    content:
      '人民法院适用普通程序审理的案件，应当在立案之日起六个月内审结。有特殊情况需要延长的，由本院院长批准，可以延长六个月；还需要延长的，报请上级人民法院批准。',
    keywords: ['普通程序', '审限', '六个月', '立案', '延长'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '民事诉讼法',
    articleNo: '第一百二十二条',
    articleNoInt: 122,
    category: '诉讼程序',
    content: '当事人起诉到人民法院的民事纠纷，适宜调解的，先行调解，但当事人拒绝调解的除外。',
    keywords: ['先行调解', '起诉', '民事纠纷', '调解'],
    legalHierarchy: 'law',
    status: 'effective',
  },

  // ===== 劳动合同法 =====
  {
    lawName: '劳动合同法',
    articleNo: '第十条',
    articleNoInt: 10,
    category: '劳动',
    content:
      '建立劳动关系，应当订立书面劳动合同。已建立劳动关系，未同时订立书面劳动合同的，应当自用工之日起一个月内订立书面劳动合同。',
    keywords: ['书面劳动合同', '建立劳动关系', '用工之日', '一个月'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '劳动合同法',
    articleNo: '第三十八条',
    articleNoInt: 38,
    category: '劳动',
    content:
      '用人单位有下列情形之一的，劳动者可以解除劳动合同：（一）未按照劳动合同约定提供劳动保护或者劳动条件的；（二）未及时足额支付劳动报酬的；（三）未依法为劳动者缴纳社会保险费的；（四）用人单位的规章制度违反法律、法规的规定，损害劳动者权益的；……',
    keywords: ['劳动者解除', '解除劳动合同', '劳动保护', '劳动报酬', '社会保险'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '劳动合同法',
    articleNo: '第四十条',
    articleNoInt: 40,
    category: '劳动',
    content:
      '有下列情形之一的，用人单位提前三十日以书面形式通知劳动者本人或者额外支付劳动者一个月工资后，可以解除劳动合同：（一）劳动者患病或者非因工负伤，在规定的医疗期满后不能从事原工作，也不能从事由用人单位另行安排的工作的；（二）劳动者不能胜任工作，经过培训或者调整工作岗位，仍不能胜任工作的；……',
    keywords: ['用人单位解除', '提前三十日', '额外支付一个月工资', '医疗期', '不能胜任'],
    legalHierarchy: 'law',
    status: 'effective',
  },
  {
    lawName: '劳动合同法',
    articleNo: '第四十七条',
    articleNoInt: 47,
    category: '劳动',
    content:
      '经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资的标准向劳动者支付。六个月以上不满一年的，按一年计算；不满六个月的，向劳动者支付半个月工资的经济补偿。',
    keywords: ['经济补偿', '工作年限', '一个月工资', '半个月工资', 'N'],
    legalHierarchy: 'law',
    status: 'effective',
  },

  // ===== 行政诉讼法 =====
  {
    lawName: '行政诉讼法',
    articleNo: '第四十六条',
    articleNoInt: 46,
    category: '行政',
    content:
      '公民、法人或者其他组织直接向人民法院提起诉讼的，应当自知道或者应当知道作出行政行为之日起六个月内提出。法律另有规定的除外。',
    keywords: ['行政诉讼起诉期限', '六个月', '行政行为', '起诉期限'],
    legalHierarchy: 'law',
    status: 'effective',
  },

  // ===== 治安管理处罚法 =====
  {
    lawName: '治安管理处罚法',
    articleNo: '第四十三条',
    articleNoInt: 43,
    category: '行政',
    content:
      '殴打他人的，或者故意伤害他人身体的，处五日以上十日以下拘留，并处二百元以上五百元以下罚款；情节较轻的，处五日以下拘留或者五百元以下罚款。',
    keywords: ['殴打', '故意伤害', '拘留', '罚款', '治安处罚'],
    legalHierarchy: 'law',
    status: 'effective',
  },

  // ===== FAQ 兜底（非法条，规则层高频问句快答） =====
];

/**
 * FAQ 快答库（source='faq'）。
 * 用于无明确法条引用但命中高频问句时，规则层直接返回，避免下沉到 LLM。
 * 命中即返回，成本最优（07 §1.4 Fallback 链第 1 层）。
 */
export interface FaqEntry {
  /** 触发关键词（命中任一即匹配） */
  triggerKeywords: string[];
  answer: string;
  lawRefs: { ref: string; title?: string; verified?: boolean }[];
  matchedKey: string;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    triggerKeywords: ['免责声明', '你是不是律师', '能代替律师吗', '法律意见吗'],
    answer: '我是法律智能助手，提供法律信息参考，不构成法律意见。具体法律问题建议咨询执业律师。',
    lawRefs: [],
    matchedKey: '免责声明',
  },
  {
    triggerKeywords: ['你好', '在吗', '你是谁', '能做什么'],
    answer:
      '你好，我是法律智能助手，可以为您提供法律条文查询、流程指引、文书生成、案件分析等服务。请问有什么可以帮您？',
    lawRefs: [],
    matchedKey: '问候',
  },
];
