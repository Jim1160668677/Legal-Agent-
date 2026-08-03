/**
 * AnswerTracer —— AI 回答溯源记录（v2.3 阶段十，17 §4）。
 *
 * 职责：
 *   1. record：写 answer_traceability 集合，绑定全链路溯源元数据
 *      字段：msgId / userId / intent / citedLaws / citedCases / promptVersion /
 *            modelVersion / reasoningChainId / ragSources / autoScore / lawyerReviewId
 *   2. getTrace：查询某消息的溯源记录（溯源 API GET /v1/answers/{msgId}/trace）
 *   3. bindLawyerReview：入审后回填 lawyerReviewId
 *   4. listByUser：按用户查询历史溯源（审计用）
 *
 * 自动评分联动（17 §3.2）：
 *   record 时同步调用 AnswerQualityScorer.computeAutoScore 计算实时 autoScore，
 *   写入 answer_traceability.autoScore，用于实时质量监控与合规评分输入。
 *
 * 权限校验（17 §4.3）：
 *   - 用户查自己消息（AuthService.checkOwner）
 *   - 律师查待审消息（lawyer 角色）
 *   - 管理员全查
 *   权限校验由调用方（Controller 层）负责，本服务仅提供数据读写。
 *
 * 设计依据：17 §4 AI 回答溯源；05 3.34 answer_traceability 集合。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AnswerTraceability,
  type AnswerTraceabilityDocument,
} from '../../../infra/database/schemas/answer-traceability.schema';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { IntentType } from '../../../types/intent';
import type { TraceRecordInput, TraceRecord } from './review.types';

/** lean() 返回的结构化类型（避免 FlattenMaps 与 Document 类型不兼容） */
type LeanTrace = {
  msgId: string;
  userId: string;
  intent: string;
  citedLaws: Array<{ ref: string; verified: boolean }>;
  citedCases: Array<{ caseId: string; caseTitle?: string }>;
  promptVersion?: string;
  modelVersion?: string;
  reasoningChainId?: string;
  ragSources: Array<{ docId: string; score: number; collection: string }>;
  autoScore: number;
  lawyerReviewId?: string;
  createdAt?: Date;
};

@Injectable()
export class AnswerTracer {
  constructor(
    @Optional()
    @InjectModel(AnswerTraceability.name)
    private readonly traceModel?: Model<AnswerTraceabilityDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 记录溯源元数据。
   * autoScore 由调用方（编排器）通过 AnswerQualityScorer 计算后传入，
   * 本服务不直接依赖 AnswerQualityScorer，避免循环依赖。
   *
   * @param input 溯源输入（含 answer 用于评分，autoScore 由调用方计算）
   * @param autoScore 已计算的自动评分（0-5），由 AnswerQualityScorer.computeAutoScore 提供
   */
  async record(input: TraceRecordInput, autoScore: number): Promise<TraceRecord> {
    const now = new Date();
    const expireAt = new Date(now.getTime() + 180 * 24 * 3600 * 1000);

    const doc: Partial<AnswerTraceabilityDocument> = {
      msgId: input.msgId,
      userId: input.userId,
      intent: input.intent,
      citedLaws: input.citedLaws,
      citedCases: input.citedCases ?? [],
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
      reasoningChainId: input.reasoningChainId,
      ragSources: input.ragSources ?? [],
      autoScore,
      expireAt,
    };

    if (this.traceModel) {
      try {
        await this.traceModel.updateOne({ msgId: input.msgId }, { $set: doc }, { upsert: true });
      } catch (err) {
        this.logger?.error('写入 answer_traceability 失败', {
          msgId: input.msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger?.debug('溯源记录已写入', {
      msgId: input.msgId,
      intent: input.intent,
      autoScore,
      citedLawsCount: input.citedLaws.length,
    });

    // 构造返回的 TraceRecord（直接从 input 派生，避免 lean 类型转换）
    return {
      msgId: input.msgId,
      userId: input.userId,
      intent: input.intent,
      citedLaws: input.citedLaws,
      citedCases: input.citedCases ?? [],
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
      reasoningChainId: input.reasoningChainId,
      ragSources: input.ragSources ?? [],
      autoScore,
      createdAt: now,
    };
  }

  /**
   * 查询溯源记录（溯源 API 用，17 §4.3）。
   * @returns TraceRecord 或 null（不存在）
   */
  async getTrace(msgId: string): Promise<TraceRecord | null> {
    if (this.traceModel) {
      try {
        const doc = await this.traceModel.findOne({ msgId }).lean().exec();
        if (doc) {
          return this.toRecord(doc, doc.createdAt ?? new Date());
        }
      } catch (err) {
        this.logger?.warn('查询溯源记录失败', {
          msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }

  /**
   * 入审后回填 lawyerReviewId（17 §4.2）。
   * 由 LawyerReviewService.sample 命中后调用，关联审核与溯源。
   */
  async bindLawyerReview(msgId: string, reviewId: string): Promise<void> {
    if (!this.traceModel) return;
    try {
      await this.traceModel.updateOne({ msgId }, { $set: { lawyerReviewId: reviewId } }).exec();
      this.logger?.debug('溯源记录已绑定审核', { msgId, reviewId });
    } catch (err) {
      this.logger?.warn('绑定 lawyerReviewId 失败', {
        msgId,
        reviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 按用户查询历史溯源（审计/合规核查用）。
   */
  async listByUser(userId: string, limit = 50): Promise<TraceRecord[]> {
    if (!this.traceModel) return [];
    try {
      const docs = await this.traceModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec();
      return docs.map((d) => this.toRecord(d, d.createdAt ?? new Date()));
    } catch (err) {
      this.logger?.warn('按用户查询溯源失败', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * 计算法条引用失败率（ComplianceMonitor 输入，17 §5.2）。
   * @returns verified=false 的比例 [0,1]；无引用法条时返回 0
   */
  computeCitationFailureRate(citedLaws: Array<{ ref: string; verified: boolean }>): number {
    if (citedLaws.length === 0) return 0;
    const failed = citedLaws.filter((l) => !l.verified).length;
    return failed / citedLaws.length;
  }

  // ===== 内部辅助 =====

  /** DB 文档 → TraceRecord */
  private toRecord(doc: LeanTrace, createdAt: Date): TraceRecord {
    return {
      msgId: doc.msgId,
      userId: doc.userId,
      intent: doc.intent as IntentType,
      citedLaws: doc.citedLaws ?? [],
      citedCases: doc.citedCases ?? [],
      promptVersion: doc.promptVersion,
      modelVersion: doc.modelVersion,
      reasoningChainId: doc.reasoningChainId,
      ragSources: doc.ragSources ?? [],
      autoScore: doc.autoScore ?? 0,
      lawyerReviewId: doc.lawyerReviewId,
      createdAt,
    };
  }
}
