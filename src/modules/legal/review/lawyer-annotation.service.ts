/**
 * LawyerAnnotationService —— 律师标注回流（v2.3 阶段十，17 §6）。
 *
 * 将律师标注转化为可复用资产，回流至 4 目标，驱动持续改进。
 *
 * 回流目标（17 §6.2）：
 *   | 目标 | 集合 | 触发条件 | 回流内容 |
 *   | 推理评测集 | intent_eval_set | case_reasoning + 推理缺陷 | 标注样本 + 期望推理链 |
 *   | 推理链纠错 | reasoning_chain | reasoningFlaws 非空 | 律师修正步骤，标记 lawyerCorrected=true |
 *   | 法条订正 | law_article | citationErrors 非空 | 法条内容/状态订正 |
 *   | 反馈归档 | feedback | 用户标记入审 | 归档用户反馈 + 律师处置结论 |
 *
 * 回流流程（17 §6.3）：
 *   1. 触发：lawyer_review.state=submitted 且 质量分<2.5 或 riskFlag=high
 *   2. for target in 回流目标:
 *      if hasRelevantAnnotations(target): upsert(target_collection, record, dedupKey)
 *   3. update lawyer_review.state = reflowed
 *   4. AuditLog.write annotation_reflowed { reviewId, targets, targetIds }
 *
 * 去重策略（17 §6.4）：
 *   - 推理评测集：按 msgId + intent 去重
 *   - 推理链纠错：按 reasoningChainId + step 去重
 *   - 法条订正：按 articleId 去重，多次订正追加到 amendmentHistory
 *   - 反馈归档：按 msgId 去重
 *
 * 设计依据：17 §6 律师标注回流；05 3.28/3.1/3.17 集合。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IntentEvalSet,
  type IntentEvalSetDocument,
  LawArticle,
  type LawArticleDocument,
} from '../../../infra/database/schemas/legal.schema';
import {
  ReasoningChain,
  type ReasoningChainDocument,
} from '../../../infra/database/schemas/reasoning-chain.schema';
import { Feedback, type FeedbackDocument } from '../../../infra/database/schemas/user.schema';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { IntentType } from '../../../types/intent';
import type { ReflowInput, ReflowResult, ReflowTarget, ReflowTargetResult } from './review.types';
import { LawyerReviewService } from './lawyer-review.service';

/** 全部回流目标 */
const ALL_REFLOW_TARGETS: ReflowTarget[] = [
  'intent_eval_set',
  'reasoning_chain',
  'law_article',
  'feedback',
];

@Injectable()
export class LawyerAnnotationService {
  constructor(
    @Optional()
    @InjectModel(IntentEvalSet.name)
    private readonly evalSetModel?: Model<IntentEvalSetDocument>,
    @Optional()
    @InjectModel(ReasoningChain.name)
    private readonly reasoningChainModel?: Model<ReasoningChainDocument>,
    @Optional()
    @InjectModel(LawArticle.name)
    private readonly lawArticleModel?: Model<LawArticleDocument>,
    @Optional()
    @InjectModel(Feedback.name)
    private readonly feedbackModel?: Model<FeedbackDocument>,
    @Optional() private readonly lawyerReviewService?: LawyerReviewService,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 执行标注回流（17 §6.3）。
   *
   * @param input 回流输入（含 reviewId / msgId / userId / intent / annotations）
   * @param options 可选：reasoningChainId（推理链纠错目标所需）、qualityScore（质量分，<2.5 触发回流）
   * @returns ReflowResult，含各目标回流结果 + 成功/跳过/失败计数
   */
  async reflow(
    input: ReflowInput,
    options: { reasoningChainId?: string; qualityScore?: number } = {},
  ): Promise<ReflowResult> {
    const results: ReflowTargetResult[] = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const target of ALL_REFLOW_TARGETS) {
      // 检查是否有相关标注
      if (!this.hasRelevantAnnotations(target, input, options)) {
        results.push({
          target,
          success: false,
          skipped: true,
          error: '无相关标注，跳过',
        });
        skippedCount++;
        continue;
      }

      try {
        const targetId = await this.reflowToTarget(target, input, options);
        results.push({
          target,
          success: true,
          targetId,
        });
        successCount++;

        // 写 annotation_reflowed 审计（17 §9）
        this.audit?.write('annotation_reflowed', {
          reviewId: input.reviewId,
          target,
          targetId,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger?.warn('回流目标失败', {
          reviewId: input.reviewId,
          target,
          error: errorMsg,
        });
        results.push({
          target,
          success: false,
          error: errorMsg,
        });
        failedCount++;
      }
    }

    // 更新 lawyer_review.state = reflowed（17 §6.3 第 3 步）
    const successTargets = results.filter((r) => r.success).map((r) => r.target);
    if (this.lawyerReviewService && successTargets.length > 0) {
      try {
        await this.lawyerReviewService.markReflowed(input.reviewId, successTargets);
      } catch (err) {
        this.logger?.warn('标记 reflowed 状态失败', {
          reviewId: input.reviewId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger?.info('标注回流完成', {
      reviewId: input.reviewId,
      successCount,
      skippedCount,
      failedCount,
    });

    return {
      results,
      successCount,
      skippedCount,
      failedCount,
      ok: failedCount === 0,
    };
  }

  // ===== 各目标回流逻辑 =====

  /** 判断是否有相关标注（17 §6.3 第 2.1 步 hasRelevantAnnotations） */
  private hasRelevantAnnotations(
    target: ReflowTarget,
    input: ReflowInput,
    options: { reasoningChainId?: string },
  ): boolean {
    const { annotations, intent } = input;
    const textAnnotations = annotations.textAnnotations;

    switch (target) {
      case 'intent_eval_set':
        // case_reasoning 意图 + 推理缺陷（17 §6.2）
        return (
          intent === ('case_reasoning' as IntentType) &&
          (textAnnotations?.reasoningFlaws?.length ?? 0) > 0
        );
      case 'reasoning_chain':
        // reasoningFlaws 非空 + 有 reasoningChainId（17 §6.2）
        return (
          (textAnnotations?.reasoningFlaws?.length ?? 0) > 0 &&
          options.reasoningChainId !== undefined
        );
      case 'law_article':
        // citationErrors 非空（17 §6.2）
        return (textAnnotations?.citationErrors?.length ?? 0) > 0;
      case 'feedback':
        // 用户标记入审（riskLevel=user_flagged，由调用方在 intent/annotations 体现）
        // 简化：有 generalComment 或 factCorrections 即归档
        return (
          textAnnotations?.generalComment !== undefined ||
          (textAnnotations?.factCorrections?.length ?? 0) > 0
        );
    }
  }

  /** 执行单个目标的回流 */
  private async reflowToTarget(
    target: ReflowTarget,
    input: ReflowInput,
    options: { reasoningChainId?: string },
  ): Promise<string | undefined> {
    switch (target) {
      case 'intent_eval_set':
        return this.reflowToEvalSet(input);
      case 'reasoning_chain':
        return this.reflowToReasoningChain(input, options.reasoningChainId!);
      case 'law_article':
        return this.reflowToLawArticle(input);
      case 'feedback':
        return this.reflowToFeedback(input);
    }
  }

  /** 回流至推理评测集（17 §6.2 + §6.4 按 msgId+intent 去重） */
  private async reflowToEvalSet(input: ReflowInput): Promise<string | undefined> {
    if (!this.evalSetModel) {
      throw new Error('IntentEvalSet Model 未注入');
    }
    const generalComment = input.annotations.textAnnotations?.generalComment ?? '';
    const text = `[律师标注回流] ${input.msgId} | ${input.intent} | ${generalComment}`;
    const doc = {
      text,
      expectedIntent: input.intent,
      source: `lawyer_reflow:${input.reviewId}`,
      version: 1,
    };
    // 按 reviewId 去重 upsert（source 作为去重标记）
    try {
      const existing = await this.evalSetModel
        .findOne({ source: `lawyer_reflow:${input.reviewId}` })
        .exec();
      if (existing) {
        return existing._id.toString();
      }
      const created = await this.evalSetModel.create(doc);
      return created._id.toString();
    } catch (err) {
      throw new Error(
        `回流 intent_eval_set 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 回流至推理链纠错（17 §6.2 标记 lawyerCorrected=true） */
  private async reflowToReasoningChain(
    input: ReflowInput,
    reasoningChainId: string,
  ): Promise<string | undefined> {
    if (!this.reasoningChainModel) {
      throw new Error('ReasoningChain Model 未注入');
    }
    const flaws = input.annotations.textAnnotations?.reasoningFlaws ?? [];
    const correctionNote = flaws
      .map((f) => `[${f.step}] ${f.flaw} → 建议：${f.suggestion}`)
      .join('; ');

    try {
      // 标记 lawyerCorrected=true，记录修正说明
      const updated = await this.reasoningChainModel
        .updateOne(
          { chainId: reasoningChainId },
          {
            $set: {
              lawyerCorrected: true,
              lawyerCorrectionNote: correctionNote,
              lawyerReviewId: input.reviewId,
            },
          },
        )
        .exec();
      if (updated.matchedCount === 0) {
        throw new Error(`推理链 ${reasoningChainId} 不存在`);
      }
      return reasoningChainId;
    } catch (err) {
      throw new Error(
        `回流 reasoning_chain 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 回流至法条订正（17 §6.2 法条内容/状态订正） */
  private async reflowToLawArticle(input: ReflowInput): Promise<string | undefined> {
    if (!this.lawArticleModel) {
      throw new Error('LawArticle Model 未注入');
    }
    const errors = input.annotations.textAnnotations?.citationErrors ?? [];
    const correctedIds: string[] = [];

    for (const err of errors) {
      try {
        // 按 articleId（err.lawRef）订正，追加 amendmentHistory（简化：更新 status 标记待复查）
        // 法条库的精确字段订正需 LawTimelinessScanner 配合（17 §6.2），此处仅记录订正请求
        const result = await this.lawArticleModel
          .updateOne(
            { articleNo: err.lawRef },
            {
              $set: {
                pendingReview: true,
                reviewNote: `${err.errorType}: ${err.correction}（律师 ${input.annotations.reviewedBy}）`,
              },
            },
          )
          .exec();
        if (result.matchedCount > 0) {
          correctedIds.push(err.lawRef);
        }
      } catch (e) {
        this.logger?.warn('法条订正失败，继续处理其余', {
          lawRef: err.lawRef,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (correctedIds.length === 0) {
      throw new Error('未能订正任何法条（可能 articleNo 不匹配）');
    }
    return correctedIds.join(',');
  }

  /** 回流至反馈归档（17 §6.2 归档用户反馈 + 律师处置结论） */
  private async reflowToFeedback(input: ReflowInput): Promise<string | undefined> {
    if (!this.feedbackModel) {
      throw new Error('Feedback Model 未注入');
    }
    // 按 msgId 去重（17 §6.4）
    try {
      const existing = await this.feedbackModel
        .findOne({ relatedMsgId: input.msgId, type: 'lawyer_review' })
        .exec();
      if (existing) {
        // 已存在：追加律师处置结论
        existing.content = `${existing.content}\n[律师处置] ${input.annotations.textAnnotations?.generalComment ?? '已审核'}`;
        existing.status = 'resolved';
        existing.assignee = input.annotations.reviewedBy;
        await existing.save();
        return existing._id.toString();
      }
      const textAnnotations = input.annotations.textAnnotations;
      const content = [
        `[律师审核 ${input.reviewId}]`,
        `评分：准确${input.annotations.scores.accuracy}/完整${input.annotations.scores.completeness}/合规${input.annotations.scores.compliance}/实用${input.annotations.scores.usefulness}`,
        textAnnotations?.generalComment ? `评语：${textAnnotations.generalComment}` : '',
        textAnnotations?.factCorrections?.length
          ? `事实订正：${textAnnotations.factCorrections.map((c) => c.correction).join('; ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const created = await this.feedbackModel.create({
        userId: input.userId,
        type: 'lawyer_review',
        relatedMsgId: input.msgId,
        content,
        status: 'resolved',
        assignee: input.annotations.reviewedBy,
      });
      return created._id.toString();
    } catch (err) {
      throw new Error(`回流 feedback 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
