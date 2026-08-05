/**
 * seed-lawyer-expertise.ts —— 律师专业知识种子数据执行脚本。
 *
 * 用法：npx ts-node scripts/seed-lawyer-expertise.ts
 * 依赖：MongoDB 连接配置
 */

import { lawyerExpertiseSeeds, seedMetadata } from '../src/data/lawyer-expertise-seeds';
import { connectToDatabase } from '../src/infra/database/database.module';
import { LawyerExpertise } from '../src/infra/database/schemas/lawyer-expertise.schema';
import { Logger } from '@nestjs/common';

const logger = new Logger('seed-lawyer-expertise');

async function main(): Promise<void> {
  logger.log('开始初始化律师专业知识种子数据...');
  logger.log(`种子数据版本：${seedMetadata.version}`);
  logger.log(`预计插入数量：${seedMetadata.totalCount} 条`);

  try {
    // 连接数据库
    const { connection } = await connectToDatabase();

    // 获取集合
    const collection = connection.collection(LawyerExpertise.collection.name);

    // 清空现有数据（可选）
    const existingCount = await collection.countDocuments({});
    logger.log(`现有数据量：${existingCount} 条`);

    // 插入种子数据
    let inserted = 0;
    let failed = 0;

    for (const seed of lawyerExpertiseSeeds) {
      try {
        // 检查是否已存在
        const exists = await collection.findOne({ expertiseId: seed.expertiseId });
        if (exists) {
          logger.debug(`跳过已存在：${seed.expertiseId}`);
          continue;
        }

        await collection.insertOne({
          ...seed,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        inserted++;
        logger.debug(`已插入：${seed.expertiseId} - ${seed.title}`);
      } catch (err) {
        failed++;
        logger.warn(`插入失败：${seed.expertiseId} - ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.log('种子数据初始化完成！');
    logger.log(`- 成功插入：${inserted} 条`);
    logger.log(`- 失败数量：${failed} 条`);
    logger.log(`- 总计：${lawyerExpertiseSeeds.length} 条`);

    // 分类统计
    const categoryStats = {} as Record<string, number>;
    for (const seed of lawyerExpertiseSeeds) {
      categoryStats[seed.expertiseType] = (categoryStats[seed.expertiseType] || 0) + 1;
    }
    logger.log('分类统计：');
    for (const [category, count] of Object.entries(categoryStats)) {
      logger.log(`  - ${category}: ${count} 条`);
    }

    await connection.close();
    process.exit(0);
  } catch (err) {
    logger.error('种子数据初始化失败', err);
    process.exit(1);
  }
}

main();
