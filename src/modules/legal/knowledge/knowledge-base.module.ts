/**
 * KnowledgeBaseModule —— 结构化知识查询模块（A2-W1）。
 *
 * LegalKnowledge Model 由 DatabaseModule.forFeature 注册并经 MongooseModule 导出，
 * 本模块仅需声明 KnowledgeBaseService 并导出，供 LegalModule 聚合。
 *
 * 设计依据：A2 §三；A1 §三 NestJS 工程结构。
 */
import { Module } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeController } from './knowledge.controller';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
