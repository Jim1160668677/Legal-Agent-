/**
 * KnowledgeBaseModule —— 结构化知识查询模块（v3.0 增强版）。
 *
 * v3.0 新增：
 *   - LawyerExpertiseKnowledgeBaseService：律师专业知识库管理
 *   - LawyerExpertise Schema 注册
 *
 * 设计依据：A2 §三；v3.0 律师专业判断深度整合需求。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeBaseService } from './knowledge-base.service';
import { LawyerExpertiseKnowledgeBaseService } from './lawyer-expertise-knowledge-base.service';
import {
  LawyerExpertise,
  LawyerExpertiseSchema,
} from '../../../infra/database/schemas/lawyer-expertise.schema';
import { LoggerModule } from '../../platform/logger/logger.module';
import { KnowledgeController } from './knowledge.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LawyerExpertise.name, schema: LawyerExpertiseSchema },
    ]),
    LoggerModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeBaseService,
    LawyerExpertiseKnowledgeBaseService, // v3.0 新增
  ],
  exports: [
    KnowledgeBaseService,
    LawyerExpertiseKnowledgeBaseService, // v3.0 新增
  ],
})
export class KnowledgeBaseModule {}
