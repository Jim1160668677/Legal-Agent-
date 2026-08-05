/**
 * seed-knowledge.ts —— 法律知识种子数据导入脚本。
 *
 * 用途：将 src/data/caseProcesses.ts（四类流程）+ materialChecklists.ts（材料清单）
 *       导入 MongoDB legal_knowledge 集合，供 KnowledgeBase.queryByType / queryByKeyword 召回。
 * 幂等：按 type+category+title 做 upsert，重复运行安全（已存在且无变更计 skipped）。
 * 依赖：.env 配置 MONGO_URI
 */
import 'dotenv/config';
import { connectToDatabase } from '../src/infra/database/database.module';
import { LegalKnowledgeSchema } from '../src/infra/database/schemas/legal.schema';
import { CASE_PROCESSES } from '../src/data/caseProcesses';
import { MATERIAL_CHECKLISTS } from '../src/data/materialChecklists';

async function main(): Promise<void> {
  const { connection } = await connectToDatabase();

  const LegalKnowledge = connection.model('LegalKnowledge', LegalKnowledgeSchema, 'legal_knowledge');
  const all = [...CASE_PROCESSES, ...MATERIAL_CHECKLISTS];

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

  console.log('[seed-knowledge] 导入完成', {
    total: all.length,
    inserted,
    updated,
    skipped,
  });

  await connection.close();
}

main().catch((err) => {
  console.error('[seed-knowledge] 导入失败', err);
  process.exit(1);
});