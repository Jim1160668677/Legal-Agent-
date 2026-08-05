/**
 * PrePublishReviewService —— 实时人机协同预发布审核服务（v3.0 新增）。
 *
 * 核心功能：
 *   1. 创建 AI 法律意见的预发布审核任务
 *   2. 律师领取、审核、修改、补充 AI 生成意见
 *   3. 状态机流转：pending → claimed → reviewing → approved/rejected
 *   4. 超时处理和升级机制
 *   5. 律师修改反馈至专业知识库持续优化
 *
 * 工作流：
 *   AI 生成 → 创建审核 → 推送队列 → 律师领取 → 审核修改 → 审核通过 → 交付用户
 *
 * 区别于事后抽样的 lawyer_review：
 *   - pre_publish_review 是即时的、阻塞交付的实时审核
 *   - 仅对高风险意图（case_reasoning/document_generate）启用
 *   - 支持律师实时修改和补充
 */

import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { LawyerExpertiseKnowledgeBaseService } from '../knowledge/lawyer-expertise-knowledge-base.service';
import {
  PrePublishReview,
  type PrePublishReviewDocument,
  type AiGeneratedOpinion,
  type LawyerModification,
  type LawyerSupplement,
  type FinalOpinion,
  type PrePublishReviewState,
} from '../../../infra/database/schemas/pre-publish-review.schema';

/** 创建审核任务的输入参数 */
export interface CreateReviewInput {
  msgId: string;
  userId: string;
  intent: string;
  aiOpinion: AiGeneratedOpinion;
  triggerSource?: 'auto' | 'user_request' | 'manual';
  priority?: number;
  escalated?: boolean;
  escalationReason?: string;
}

/** 律师领取审核任务的参数 */
export interface ClaimReviewInput {
  lawyerId: string;
  reviewId: string;
}

/** 律师提交修改的参数 */
export interface SubmitModificationInput {
  reviewId: string;
  lawyerId: string;
  modifications: LawyerModification[];
  supplements: LawyerSupplement[];
  finalOpinion?: Partial<FinalOpinion>;
  reviewNote?: string;
}

/** 审核结果 */
export interface ReviewResult {
  reviewId: string;
  finalOpinion: FinalOpinion;
  reviewDuration: number;
  modificationsCount: number;
  supplementsCount: number;
  status: 'approved' | 'rejected';
}

/** 队列查询参数 */
export interface QueueQuery {
  lawyerId?: string;
  states?: PrePublishReviewState[];
  priority?: number;
  limit?: number;
}

@Injectable()
export class PrePublishReviewService {
  /** 默认超时时间（ms）：30 分钟 */
  private static readonly DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
  /** 超时后升级的时间（ms）：1 小时 */
  private static readonly ESCALATION_TIMEOUT_MS = 60 * 60 * 1000;

  constructor(
    @Optional()
    @InjectModel(PrePublishReview.name)
    private readonly reviewModel?: Model<PrePublishReviewDocument>,
    @Optional() private readonly lawyerExpertiseService?: LawyerExpertiseKnowledgeBaseService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  // ===== 创建审核任务 =====

  /**
   * 创建预发布审核任务
   */
  async createReview(input: CreateReviewInput): Promise<PrePublishReviewDocument> {
    if (!this.reviewModel) {
      throw new Error('PrePublishReview Model 未注入');
    }

    const reviewId = this.generateReviewId();

    // 计算优先级（基于风险等级和置信度）
    const calculatedPriority = input.priority ?? this.calculatePriority(input.aiOpinion);

    const doc = {
      reviewId,
      msgId: input.msgId,
      userId: input.userId,
      intent: input.intent,
      triggerSource: input.triggerSource ?? 'auto',
      aiOpinion: input.aiOpinion,
      state: 'pending' as PrePublishReviewState,
      priority: calculatedPriority,
      escalated: input.escalated ?? false,
      escalationReason: input.escalationReason,
    };

    const created = await this.reviewModel.create(doc);

    this.logger?.info('预发布审核任务已创建', {
      reviewId,
      msgId: input.msgId,
      intent: input.intent,
      priority: calculatedPriority,
    });

    return created;
  }

  /**
   * 批量创建审核任务
   */
  async batchCreateReviews(inputs: CreateReviewInput[]): Promise<PrePublishReviewDocument[]> {
    const results: PrePublishReviewDocument[] = [];
    for (const input of inputs) {
      try {
        results.push(await this.createReview(input));
      } catch (err) {
        this.logger?.warn('批量创建审核任务失败', {
          error: err instanceof Error ? err.message : String(err),
          msgId: input.msgId,
        });
      }
    }
    return results;
  }

  // ===== 律师领取审核任务 =====

  /**
   * 律师领取待处理的审核任务
   */
  async claimReview(input: ClaimReviewInput): Promise<PrePublishReviewDocument | null> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');

    const now = new Date();

    const result = await this.reviewModel.findOneAndUpdate(
      {
        reviewId: input.reviewId,
        state: 'pending',
      },
      {
        $set: {
          state: 'claimed',
          claimedBy: input.lawyerId,
          claimedAt: now,
        },
      },
      { new: true },
    );

    if (result) {
      this.logger?.info('律师领取审核任务', {
        reviewId: input.reviewId,
        lawyerId: input.lawyerId,
      });
    }

    return result;
  }

  /**
   * 律师领取自己队列中下一个待处理任务
   */
  async claimNextForLawyer(
    lawyerId: string,
    filter?: { priority?: number; intents?: string[] },
  ): Promise<PrePublishReviewDocument | null> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');

    const query: Record<string, unknown> = { state: 'pending' };
    if (filter?.priority) {
      query.priority = { $gte: filter.priority };
    }
    if (filter?.intents && filter.intents.length > 0) {
      query.intent = { $in: filter.intents };
    }

    const nextTask = await this.reviewModel.findOne(query).sort({
      priority: -1,
      createdAt: 1,
    });

    if (!nextTask) return null;

    return this.claimReview({
      reviewId: nextTask.reviewId,
      lawyerId,
    });
  }

  // ===== 律师提交修改 =====

  /**
   * 律师提交修改并审核通过
   */
  async submitAndApprove(input: SubmitModificationInput): Promise<ReviewResult> {
    return this.processSubmission(input, 'approved');
  }

  /**
   * 律师提交修改并驳回
   */
  async submitAndReject(input: SubmitModificationInput): Promise<ReviewResult> {
    return this.processSubmission(input, 'rejected');
  }

  /**
   * 开始审核（状态变为 reviewing）
   */
  async startReview(reviewId: string, lawyerId: string): Promise<PrePublishReviewDocument | null> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');

    const result = await this.reviewModel.findOneAndUpdate(
      {
        reviewId,
        claimedBy: lawyerId,
        state: 'claimed',
      },
      { $set: { state: 'reviewing' } },
      { new: true },
    );

    return result;
  }

  // ===== 查询接口 =====

  /**
   * 获取审核队列
   */
  async getQueue(query: QueueQuery = {}): Promise<PrePublishReviewDocument[]> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');

    const mongoQuery: Record<string, unknown> = {};

    if (query.lawyerId) {
      mongoQuery.$or = [
        { state: 'pending' },
        { state: { $in: ['claimed', 'reviewing'] }, claimedBy: query.lawyerId },
      ];
    }

    if (query.states && query.states.length > 0) {
      mongoQuery.state = { $in: query.states };
    }

    const sort: Record<string, 1 | -1> = {};
    if (query.priority) {
      sort.priority = -1;
    }
    sort.createdAt = 1;

    const limit = query.limit ?? 50;

    return this.reviewModel.find(mongoQuery).sort(sort).limit(limit);
  }

  /**
   * 获取单个审核详情
   */
  async getByReviewId(reviewId: string): Promise<PrePublishReviewDocument | null> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');
    return this.reviewModel.findOne({ reviewId });
  }

  /**
   * 根据 msgId 获取审核
   */
  async getByMsgId(msgId: string): Promise<PrePublishReviewDocument | null> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');
    return this.reviewModel.findOne({ msgId });
  }

  /**
   * 获取律师的已完成审核列表
   */
  async getLawyerHistory(
    lawyerId: string,
    limit: number = 100,
  ): Promise<PrePublishReviewDocument[]> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');

    return this.reviewModel
      .find({
        claimedBy: lawyerId,
        state: { $in: ['approved', 'rejected'] },
      })
      .sort({ updatedAt: -1 })
      .limit(limit);
  }

  /**
   * 获取待处理数量（队列长度）
   */
  async getPendingCount(lawyerId?: string): Promise<number> {
    if (!this.reviewModel) return 0;

    const query: Record<string, unknown> = { state: 'pending' };
    if (lawyerId) {
      query.$or = [
        { state: 'pending' },
        { state: { $in: ['claimed', 'reviewing'] }, claimedBy: lawyerId },
      ];
      delete query.state;
    }

    return this.reviewModel.countDocuments(query);
  }

  // ===== 超时处理 =====

  /**
   * 处理超时的审核任务
   */
  async processTimeouts(timeoutMs?: number): Promise<{
    timedOut: number;
    escalated: number;
  }> {
    if (!this.reviewModel) return { timedOut: 0, escalated: 0 };

    const timeout = timeoutMs ?? PrePublishReviewService.DEFAULT_TIMEOUT_MS;
    const now = new Date();
    const timeoutDate = new Date(now.getTime() - timeout);

    // 标记超时的 pending 任务
    const timedOutResult = await this.reviewModel.updateMany(
      {
        state: 'pending',
        createdAt: { $lt: timeoutDate },
      },
      {
        $set: { state: 'escalated', escalated: true, escalationReason: 'timeout' },
      },
    );

    // 标记超时的 claimed/reviewing 任务
    const claimedTimeoutDate = new Date(
      now.getTime() - PrePublishReviewService.ESCALATION_TIMEOUT_MS,
    );
    const escalatedResult = await this.reviewModel.updateMany(
      {
        state: { $in: ['claimed', 'reviewing'] },
        updatedAt: { $lt: claimedTimeoutDate },
      },
      {
        $set: { state: 'escalated', escalated: true, escalationReason: 'review_timeout' },
      },
    );

    return {
      timedOut: timedOutResult.modifiedCount,
      escalated: escalatedResult.modifiedCount,
    };
  }

  // ===== 统计接口 =====

  /**
   * 获取审核统计信息
   */
  async getStats(startDate?: Date, endDate?: Date): Promise<{
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    averageDuration: number;
    modificationsApplied: number;
  }> {
    if (!this.reviewModel) {
      return {
        total: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        averageDuration: 0,
        modificationsApplied: 0,
      };
    }

    const dateQuery: Record<string, unknown> = {};
    if (startDate) dateQuery.$gte = startDate;
    if (endDate) dateQuery.$lte = endDate;

    const matchStage: Record<string, unknown> = {};
    if (Object.keys(dateQuery).length > 0) {
      matchStage.createdAt = dateQuery;
    }

    const stats = await this.reviewModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$state', 'rejected'] }, 1, 0] } },
          pending: {
            $sum: {
              $cond: [
                { $in: ['$state', ['pending', 'claimed', 'reviewing']] },
                1,
                0,
              ],
            },
          },
          avgDuration: { $avg: '$reviewDuration' },
          totalMods: { $sum: { $size: { $ifNull: ['$modifications', []] } } },
        },
      },
    ]);

    const result = stats[0] ?? {};

    return {
      total: result.total ?? 0,
      approved: result.approved ?? 0,
      rejected: result.rejected ?? 0,
      pending: result.pending ?? 0,
      averageDuration: Math.round(result.avgDuration ?? 0),
      modificationsApplied: result.totalMods ?? 0,
    };
  }

  // ===== 私有方法 =====

  /**
   * 处理审核提交
   */
  private async processSubmission(
    input: SubmitModificationInput,
    finalState: 'approved' | 'rejected',
  ): Promise<ReviewResult> {
    if (!this.reviewModel) throw new Error('PrePublishReview Model 未注入');

    const now = new Date();

    // 获取当前审核记录
    const review = await this.reviewModel.findOne({ reviewId: input.reviewId });
    if (!review) {
      throw new Error(`审核任务不存在：${input.reviewId}`);
    }

    if (!this.canTransition(review.state, finalState)) {
      throw new Error(`状态流转不允许：${review.state} → ${finalState}`);
    }

    // 计算审核耗时
    const reviewDuration = review.claimedAt
      ? now.getTime() - review.claimedAt.getTime()
      : 0;

    // 构建最终意见
    const finalOpinion = input.finalOpinion
      ? this.mergeFinalOpinion(review.aiOpinion, input.finalOpinion, input.supplements)
      : this.buildFinalOpinion(review.aiOpinion, input.modifications, input.supplements);

    // 更新审核记录
    const updated = await this.reviewModel.findOneAndUpdate(
      { reviewId: input.reviewId },
      {
        $set: {
          state: finalState,
          claimedBy: input.lawyerId,
          modifications: input.modifications,
          supplements: input.supplements,
          finalOpinion,
          reviewNote: input.reviewNote,
          reviewDuration,
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new Error('更新审核记录失败');
    }

    // v3.0：异步将律师修改反馈至专业知识库
    this.feedbackToExpertiseBaseAsync(input).catch(() => {
      // 静默失败
    });

    this.logger?.info('审核完成', {
      reviewId: input.reviewId,
      lawyerId: input.lawyerId,
      finalState,
      reviewDuration,
      modificationsCount: input.modifications.length,
      supplementsCount: input.supplements.length,
    });

    return {
      reviewId: input.reviewId,
      finalOpinion,
      reviewDuration,
      modificationsCount: input.modifications.length,
      supplementsCount: input.supplements.length,
      status: finalState,
    };
  }

  /**
   * 构建最终意见
   */
  private buildFinalOpinion(
    aiOpinion: AiGeneratedOpinion,
    modifications: LawyerModification[],
    supplements: LawyerSupplement[],
  ): FinalOpinion {
    let summary = aiOpinion.summary;
    let analysis = aiOpinion.analysis;

    // 应用修改
    for (const mod of modifications) {
      if (mod.type === 'edit' && mod.modifiedContent) {
        if (mod.fieldPath === 'summary') {
          summary = mod.modifiedContent;
        } else if (mod.fieldPath === 'analysis') {
          analysis = mod.modifiedContent;
        }
      }
    }

    // 合并引用法条
    const lawRefs = new Set<string>(aiOpinion.lawRefs);
    for (const mod of modifications) {
      if (mod.appliedExpertiseIds) {
        // 律师专业知识引用已在 expertiseIds 中记录
      }
    }

    // 从补充中提取法条引用
    for (const sup of supplements) {
      if (sup.lawRefs) {
        sup.lawRefs.forEach((ref) => lawRefs.add(ref));
      }
    }

    // 生成专业判断应用说明
    const judgmentNote = this.buildJudgmentNote(modifications, supplements);

    return {
      summary,
      analysis,
      lawyerSupplements: supplements,
      lawRefs: Array.from(lawRefs),
      confidence: this.adjustConfidence(aiOpinion.confidence, modifications),
      riskLevel: aiOpinion.riskLevel,
      judgmentAppliedNote: judgmentNote,
    };
  }

  /**
   * 合并预设的最终意见
   */
  private mergeFinalOpinion(
    aiOpinion: AiGeneratedOpinion,
    partialFinal: Partial<FinalOpinion>,
    supplements: LawyerSupplement[],
  ): FinalOpinion {
    return {
      summary: partialFinal.summary ?? aiOpinion.summary,
      analysis: partialFinal.analysis ?? aiOpinion.analysis,
      lawyerSupplements: supplements,
      lawRefs: partialFinal.lawRefs ?? aiOpinion.lawRefs,
      confidence: partialFinal.confidence ?? aiOpinion.confidence,
      riskLevel: partialFinal.riskLevel ?? aiOpinion.riskLevel,
      lawyerSignature: partialFinal.lawyerSignature,
      judgmentAppliedNote: partialFinal.judgmentAppliedNote,
    };
  }

  /**
   * 调整置信度
   */
  private adjustConfidence(
    original: number,
    modifications: LawyerModification[],
  ): number {
    if (modifications.length === 0) return original;

    // 律师修改通常表示需要调整置信度
    const hasMajorEdit = modifications.some(
      (m) => m.type === 'edit' || m.type === 'supplement',
    );

    if (hasMajorEdit) {
      // 律师修改后，置信度应基于专业判断
      return Math.min(original + 0.1, 1.0);
    }

    return original;
  }

  /**
   * 构建专业判断应用说明
   */
  private buildJudgmentNote(
    modifications: LawyerModification[],
    supplements: LawyerSupplement[],
  ): string {
    const parts: string[] = [];

    if (modifications.length > 0) {
      const expertiseIds = modifications.flatMap((m) => m.appliedExpertiseIds ?? []);
      if (expertiseIds.length > 0) {
        parts.push(`本次审核应用了 ${expertiseIds.length} 条律师专业知识。`);
      }
    }

    if (supplements.length > 0) {
      const types = [...new Set(supplements.map((s) => s.supplementType))];
      parts.push(`律师补充了 ${supplements.length} 条专业意见（类型：${types.join('、')}）。`);
    }

    return parts.length > 0 ? parts.join('') : '律师审核确认，AI 生成内容符合专业标准。';
  }

  /**
   * 状态流转检查
   */
  private canTransition(current: string, target: string): boolean {
    const transitions: Record<string, string[]> = {
      pending: ['claimed', 'escalated'],
      claimed: ['reviewing', 'escalated'],
      reviewing: ['approved', 'rejected', 'escalated'],
      escalated: ['claimed'],
      approved: [],
      rejected: [],
    };

    return transitions[current]?.includes(target) ?? false;
  }

  /**
   * 计算优先级
   */
  private calculatePriority(aiOpinion: AiGeneratedOpinion): number {
    // 基于风险等级和置信度计算优先级
    const riskScore: Record<string, number> = {
      high: 5,
      medium: 3,
      low: 1,
    };

    const riskPriority = riskScore[aiOpinion.riskLevel] ?? 3;
    const lowConfidencePenalty = aiOpinion.confidence < 0.5 ? 1 : 0;

    return Math.min(riskPriority + lowConfidencePenalty, 5);
  }

  /**
   * 生成审核 ID
   */
  private generateReviewId(): string {
    return `ppr_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  /**
   * 异步反馈至专业知识库
   */
  private async feedbackToExpertiseBaseAsync(input: SubmitModificationInput): Promise<void> {
    if (!this.lawyerExpertiseService) return;

    try {
      // 收集应用的专业知识 ID
      const expertiseIds = new Set<string>();

      for (const mod of input.modifications) {
        if (mod.appliedExpertiseIds) {
          mod.appliedExpertiseIds.forEach((id) => expertiseIds.add(id));
        }
      }

      for (const sup of input.supplements) {
        if (sup.expertiseIds) {
          sup.expertiseIds.forEach((id) => expertiseIds.add(id));
        }
      }

      // 记录使用情况（通过外部 ID 引用）
      // 注意：这里使用 reviewId 作为外部引用
      for (const expertiseId of expertiseIds) {
        try {
          // 通过外部 ID 记录使用
          await this.lawyerExpertiseService.recordUsageByExternalId(
            expertiseId,
            input.reviewId,
            'pre_publish_review',
          );
        } catch {
          // 静默单个失败
        }
      }

      // 如果有重要修改，考虑创建新的专业知识条目
      const significantModifications = input.modifications.filter(
        (m) => m.type === 'supplement' || (m.type === 'edit' && m.modificationNote),
      );

      if (significantModifications.length > 0 && input.finalOpinion) {
        this.logger?.debug('律师修改反馈至专业知识库', {
          reviewId: input.reviewId,
          modificationsCount: significantModifications.length,
        });
      }
    } catch (err) {
      this.logger?.warn('反馈至专业知识库失败', {
        reviewId: input.reviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
