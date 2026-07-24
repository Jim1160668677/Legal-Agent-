/**
 * legal_knowledge 种子数据导入脚本（A2-W1，A2 §7.3）。
 *
 * 用途：将 src/data/caseProcesses.ts（四类流程）+ materialChecklists.ts（材料清单）
 *       导入 MongoDB legal_knowledge 集合，供 KnowledgeBase.queryByType / queryByKeyword 召回。
 *
 * 幂等：按 type+category+title 做 upsert，重复运行安全（已存在且无变更计 skipped）。
 *
 * 运行：npm run import:knowledge（需 .env 配置 MONGO_URI）
 * 输出：控制台统计 { total, inserted, updated, skipped }
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { LegalKnowledgeSchema } from '../infra/database/schemas/legal.schema';
import { CASE_PROCESSES, type KnowledgeSeedData } from '../data/caseProcesses';
import { MATERIAL_CHECKLISTS } from '../data/materialChecklists';

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[import-legal-knowledge] MONGO_URI 未配置，请在 .env 中设置后重试');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[import-legal-knowledge] 已连接 MongoDB');

  const LegalKnowledge = mongoose.model('LegalKnowledge', LegalKnowledgeSchema, 'legal_knowledge');

  const all: KnowledgeSeedData[] = [...CASE_PROCESSES, ...MATERIAL_CHECKLISTS];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of all) {
    const filter = { type: item.type, category: item.category, title: item.title };
    const res = await LegalKnowledge.updateOne(filter, { $set: item }, { upsert: true }).exec();
    if (res.upsertedCount > 0) inserted++;
    else if (res.modifiedCount > 0) updated++;
    else skipped++;
  }

  console.log('[import-legal-knowledge] 导入完成', {
    total: all.length,
    inserted,
    updated,
    skipped,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[import-legal-knowledge] 导入失败', err);
  process.exit(1);
});
