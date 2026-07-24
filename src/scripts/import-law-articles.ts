/**
 * law_article 法条种子数据导入脚本（A2-W1，A2 §7.1）。
 *
 * 用途：将 src/data/lawArticles.ts（常用法条种子集）导入 MongoDB law_article 集合，
 *       供 RuleEngine 精确匹配 + RagService 向量召回使用。
 *       A2-W2 向量化阶段由 EmbeddingService 补全 embedding 字段。
 *
 * 去重：contentHash = SHA-256(content)，按 lawName+articleNoInt 做 upsert。
 * 幂等：重复运行安全（已存在且无变更计 skipped）。
 *
 * 运行：npm run import:law（需 .env 配置 MONGO_URI）
 * 输出：控制台统计 { total, inserted, updated, skipped }
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { LawArticleSchema } from '../infra/database/schemas/legal.schema';
import { LAW_ARTICLES } from '../data/lawArticles';

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[import-law-articles] MONGO_URI 未配置，请在 .env 中设置后重试');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[import-law-articles] 已连接 MongoDB');

  const LawArticle = mongoose.model('LawArticle', LawArticleSchema, 'law_article');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const a of LAW_ARTICLES) {
    const contentHash = createHash('sha256').update(a.content).digest('hex');
    const filter = { lawName: a.lawName, articleNoInt: a.articleNoInt };
    const res = await LawArticle.updateOne(
      filter,
      { $set: { ...a, contentHash } },
      { upsert: true },
    ).exec();
    if (res.upsertedCount > 0) inserted++;
    else if (res.modifiedCount > 0) updated++;
    else skipped++;
  }

  console.log('[import-law-articles] 导入完成', {
    total: LAW_ARTICLES.length,
    inserted,
    updated,
    skipped,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[import-law-articles] 导入失败', err);
  process.exit(1);
});
