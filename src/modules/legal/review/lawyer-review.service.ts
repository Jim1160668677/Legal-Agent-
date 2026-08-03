/**
 * LawyerReviewService —— 律师审核工作流（v2.3 阶段十，17 §2）。
 *
 * 职责：
 *   1. sample：按风险等级抽样入审（高风险/用户标记 100% / 普通 5% 随机）
 *   2. 状态机流转：pending → claimed → reviewing → submitted → reflowed
 *   3. 超时/放弃：pending 72h 重排、claimed/reviewing 48h 释放回 pending
 *   4. 队列查询：待审列表（state=pending）、我的审核（claimedBy=me）
 *
 * 状态机（17 §2.2）：
 *   pending → claimed → reviewing → submitted → reflowed
 *      ↓         ↓          ↓
 *   timeout   timeout    give_up
 *
 * 抽样策略（17 §2.3）：
 *   | 风险等级 | 判定条件 | 抽样率 |
 *   | 高风险   | case_reasoning / document_generate | 100% |
 *   | 用户标记 | userFlagged=true                    | 100% |
 *   | 普通     | 其他意图                            | 5%   |
 *
 * 设计依据：17 §2 律师审核工作流；05 3.33 lawyer_review 集合。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  LawyerReview,
  type LawyerReviewDocument,
  type LawyerReviewAnnotations,
  type LawyerReviewState,
  type LawyerReviewRiskLevel,
} from '../../../infra/database/schemas/lawyer-review.schema';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import {
  HIGH_RISK_INTENTS,
  REVIEW_SAMPLING_RATES,
  REVIEW_TIMEOUTS,
  type ReviewSamplingInput,
  type ReviewSamplingResult,
} from './review.types';
import { REVIEW_ERROR_CODES } from './review.constants';

/** 审核记录（内存表示，DB 不可用时兜底；对外暴露为 ReviewRecord） */
export interface ReviewRecord {
  reviewId: string;
  msgId: string;
  userId: string;
  intent: string;
  riskLevel: string;
  state: string;
  sampledAt: Date;
  claimedBy?: string;
  claimedAt?: Date;
  annotations?: LawyerReviewAnnotations;
  reflowTargets?: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** lean() 返回的结构化类型（避免 FlattenMaps 与 Document 类型不兼容） */
type LeanReview = {
  reviewId: string;
  msgId: string;
  userId: string;
  intent: string;
  riskLevel: string;
  state: string;
  sampledAt: Date;
  claimedBy?: string;
  claimedAt?: Date;
  annotations?: LawyerReviewAnnotations;
  reflowTargets?: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

/** 状态机合法流转表（17 §2.2） */
const VALID_TRANSITIONS: Record<LawyerReviewState, LawyerReviewState[]> = {
  pending: ['claimed'],
  claimed: ['reviewing', 'pending'], // reviewing 进入标注；pending 为超时释放回退
  reviewing: ['submitted', 'pending'], // submitted 提交；pending 为超时/give_up 释放
  submitted: ['reflowed'], // reflowed 回流完成
  reflowed: [], // 终态
};

@Injectable()
export class LawyerReviewService {
  /** 内存审核表：reviewId → review（DB 不可用时兜底） */
  private readonly reviews = new Map<string, ReviewRecord>();

  constructor(
    @Optional()
    @InjectModel(LawyerReview.name)
    private readonly reviewModel?: Model<LawyerReviewDocument>,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  // ===== 抽样入审（17 §2.3）=====

  /**
   * 按风险等级抽样决定是否入审。
   * 命中即写 lawyer_review(state=pending)。
   */
  async sample(input: ReviewSamplingInput): Promise<ReviewSamplingResult> {
    const { msgId, userId, intent, userFlagged } = input;

    // 判定风险等级
    let riskLevel: LawyerReviewRiskLevel;
    let sampled: boolean;

    if (userFlagged) {
      riskLevel = 'user_flagged';
      sampled = true; // 100%
    } else if (HIGH_RISK_INTENTS.includes(intent)) {
      riskLevel = 'high';
      sampled = true; // 100%
    } else {
      riskLevel = 'normal';
      sampled = Math.random() < REVIEW_SAMPLING_RATES.normal; // 5% 随机
    }

    if (!sampled) {
      this.logger?.debug('抽样未命中', { msgId, intent, riskLevel });
      // 仍返回 riskLevel，便于调用方记录分析（17 §2.3 抽样来源标记）
      return { sampled: false, riskLevel };
    }

    // 命中：写 lawyer_review(pending)
    const reviewId = this.generateReviewId();
    const now = new Date();
    const expireAt = new Date(now.getTime() + 365 * 24 * 3600 * 1000);

    const review: ReviewRecord = {
      reviewId,
      msgId,
      userId,
      intent,
      riskLevel,
      state: 'pending',
      sampledAt: now,
      reflowTargets: [],
      createdAt: now,
      updatedAt: now,
    };

    this.putInMemory(review);

    if (this.reviewModel) {
      try {
        await this.reviewModel.create({
          reviewId,
          msgId,
          userId,
          intent,
          riskLevel,
          state: 'pending',
          sampledAt: now,
          reflowTargets: [],
          expireAt,
        });
      } catch (err) {
        // msgId 唯一约束冲突：同消息已入审，幂等返回
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('duplicate') || msg.includes('E11000')) {
          this.logger?.warn('同消息已入审，幂等返回', { msgId, reviewId });
          const existing = await this.findByMsgId(msgId);
          return {
            sampled: true,
            riskLevel,
            reviewId: existing?.reviewId ?? reviewId,
          };
        }
        this.logger?.error('写入 lawyer_review 失败，仅保留内存', {
          reviewId,
          msgId,
          error: msg,
        });
      }
    }

    this.logger?.info('抽样入审', { reviewId, msgId, intent, riskLevel });

    return { sampled: true, riskLevel, reviewId };
  }

  // ===== 状态机流转 =====

  /** 律师领取（pending → claimed，17 §2.2） */
  async claim(reviewId: string, lawyerId: string): Promise<ReviewRecord | null> {
    return this.transition(reviewId, 'claimed', (r) => {
      r.claimedBy = lawyerId;
      r.claimedAt = new Date();
    });
  }

  /** 开始标注（claimed → reviewing，17 §2.2） */
  async startReview(reviewId: string, lawyerId: string): Promise<ReviewRecord | null> {
    return this.transition(reviewId, 'reviewing', (r) => {
      // 校验领取人一致（防止其他律师抢标）
      if (r.claimedBy && r.claimedBy !== lawyerId) {
        throw this.error(
          REVIEW_ERROR_CODES.INVALID_TRANSITION,
          `审核 ${reviewId} 已被 ${r.claimedBy} 领取，${lawyerId} 无权标注`,
        );
      }
    });
  }

  /** 律师提交标注（reviewing → submitted，17 §2.4 标注字段） */
  async submit(
    reviewId: string,
    annotations: LawyerReviewAnnotations,
  ): Promise<ReviewRecord | null> {
    return this.transition(reviewId, 'submitted', (r) => {
      // 校验四维评分合法性
      this.validateScores(annotations.scores);
      r.annotations = annotations;
    });
  }

  /** 律师放弃（claimed/reviewing → pending，17 §2.2 give_up） */
  async giveUp(reviewId: string, lawyerId: string): Promise<ReviewRecord | null> {
    return this.transition(reviewId, 'pending', (r) => {
      if (r.claimedBy && r.claimedBy !== lawyerId) {
        throw this.error(
          REVIEW_ERROR_CODES.INVALID_TRANSITION,
          `审核 ${reviewId} 由 ${r.claimedBy} 领取，${lawyerId} 无权放弃`,
        );
      }
      // 释放：清除领取人，回 pending
      r.claimedBy = undefined;
      r.claimedAt = undefined;
    });
  }

  /** 标记回流完成（submitted → reflowed，由 LawyerAnnotationService 调用） */
  async markReflowed(reviewId: string, reflowTargets: string[]): Promise<ReviewRecord | null> {
    return this.transition(reviewId, 'reflowed', (r) => {
      r.reflowTargets = reflowTargets;
    });
  }

  // ===== 超时巡检（17 §2.2 超时/放弃）=====

  /**
   * 巡检超时审核：
   *   - pending 超 72h 未领取 → 重新入队（state 不变，更新 sampledAt）
   *   - claimed/reviewing 超 48h 未提交 → 释放回 pending
   *
   * 建议由定时任务每小时调用一次。
   */
  async sweepTimeouts(): Promise<{ requeued: number; released: number }> {
    const now = Date.now();
    let requeued = 0;
    let released = 0;

    const all = await this.listAll();
    for (const r of all) {
      const updatedMs = new Date(r.updatedAt ?? r.sampledAt).getTime();
      if (r.state === 'pending') {
        if (now - updatedMs > REVIEW_TIMEOUTS.pendingRequeueMs) {
          // 重新入队：刷新 sampledAt
          await this.refreshPending(r.reviewId);
          requeued++;
        }
      } else if (r.state === 'claimed' || r.state === 'reviewing') {
        if (now - updatedMs > REVIEW_TIMEOUTS.claimedReleaseMs) {
          // 释放回 pending
          await this.releaseToPending(r.reviewId);
          released++;
        }
      }
    }

    if (requeued > 0 || released > 0) {
      this.logger?.info('超时巡检完成', { requeued, released });
    }
    return { requeued, released };
  }

  // ===== 查询 =====

  /** 待审队列（state=pending，按 sampledAt 升序，优先高风险） */
  async getQueue(limit = 20): Promise<ReviewRecord[]> {
    if (this.reviewModel) {
      try {
        const docs = await this.reviewModel
          .find({ state: 'pending' })
          .sort({ riskLevel: -1, sampledAt: 1 })
          .limit(limit)
          .lean()
          .exec();
        return docs.map((d) => this.toInMemory(d));
      } catch (err) {
        this.logger?.warn('查询待审队列失败，回退内存', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return Array.from(this.reviews.values())
      .filter((r) => r.state === 'pending')
      .sort((a, b) => this.riskOrder(b.riskLevel) - this.riskOrder(a.riskLevel))
      .slice(0, limit);
  }

  /** 我的审核（claimedBy=lawyerId） */
  async getMyReviews(lawyerId: string, limit = 20): Promise<ReviewRecord[]> {
    if (this.reviewModel) {
      try {
        const docs = await this.reviewModel
          .find({ claimedBy: lawyerId, state: { $in: ['claimed', 'reviewing'] } })
          .sort({ claimedAt: -1 })
          .limit(limit)
          .lean()
          .exec();
        return docs.map((d) => this.toInMemory(d));
      } catch (err) {
        this.logger?.warn('查询我的审核失败，回退内存', {
          lawyerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return Array.from(this.reviews.values())
      .filter((r) => r.claimedBy === lawyerId && (r.state === 'claimed' || r.state === 'reviewing'))
      .slice(0, limit);
  }

  /** 查询审核详情 */
  async getReview(reviewId: string): Promise<ReviewRecord | null> {
    const inMem = this.reviews.get(reviewId);
    if (inMem) return inMem;
    if (this.reviewModel) {
      try {
        const doc = await this.reviewModel.findOne({ reviewId }).lean().exec();
        if (doc) return this.toInMemory(doc);
      } catch (err) {
        this.logger?.warn('查询审核详情失败', {
          reviewId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }

  // ===== 内部辅助 =====

  /** 通用状态流转：校验合法性 → 应用变更 → 持久化 */
  private async transition(
    reviewId: string,
    target: LawyerReviewState,
    apply: (r: ReviewRecord) => void,
  ): Promise<ReviewRecord | null> {
    const review = await this.getReview(reviewId);
    if (!review) {
      throw this.error(REVIEW_ERROR_CODES.REVIEW_NOT_FOUND, `审核 ${reviewId} 不存在`);
    }

    const current = review.state as LawyerReviewState;
    const allowed = VALID_TRANSITIONS[current] ?? [];
    if (!allowed.includes(target)) {
      throw this.error(
        REVIEW_ERROR_CODES.INVALID_TRANSITION,
        `非法状态流转：${current} → ${target}（合法：${allowed.join('/')}）`,
      );
    }

    // 应用变更（可能抛错，如领取人校验）
    apply(review);
    review.state = target;
    review.updatedAt = new Date();

    this.putInMemory(review);
    await this.persist(review);

    this.logger?.debug('审核状态流转', { reviewId, from: current, to: target });

    // 提交时写审计
    if (target === 'submitted' && this.audit && review.annotations) {
      this.audit.write('lawyer_review_submit', {
        reviewId,
        lawyerId: review.annotations.reviewedBy,
        msgId: review.msgId,
        scores: review.annotations.scores,
        riskFlag: review.annotations.riskFlag,
      });
    }

    return review;
  }

  /** 四维评分合法性校验 */
  private validateScores(scores: {
    accuracy: number;
    completeness: number;
    compliance: number;
    usefulness: number;
  }): void {
    const dims: Array<[string, number]> = [
      ['accuracy', scores.accuracy],
      ['completeness', scores.completeness],
      ['compliance', scores.compliance],
      ['usefulness', scores.usefulness],
    ];
    for (const [name, val] of dims) {
      if (typeof val !== 'number' || val < 1 || val > 5 || !Number.isFinite(val)) {
        throw this.error(
          REVIEW_ERROR_CODES.INVALID_SCORE,
          `评分维度 ${name} 非法（应为 1-5 数值，实际 ${val}）`,
        );
      }
    }
  }

  /** 刷新 pending（重新入队） */
  private async refreshPending(reviewId: string): Promise<void> {
    const now = new Date();
    const r = this.reviews.get(reviewId);
    if (r) {
      r.sampledAt = now;
      r.updatedAt = now;
    }
    if (this.reviewModel) {
      await this.reviewModel
        .updateOne({ reviewId }, { $set: { sampledAt: now, updatedAt: now } })
        .exec()
        .catch((err: unknown) => {
          this.logger?.warn('刷新 pending 失败', {
            reviewId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }

  /** 释放回 pending（超时清理） */
  private async releaseToPending(reviewId: string): Promise<void> {
    const r = this.reviews.get(reviewId);
    if (r) {
      r.state = 'pending';
      r.claimedBy = undefined;
      r.claimedAt = undefined;
      r.updatedAt = new Date();
    }
    if (this.reviewModel) {
      await this.reviewModel
        .updateOne(
          { reviewId },
          { $set: { state: 'pending', claimedBy: null, claimedAt: null, updatedAt: new Date() } },
        )
        .exec()
        .catch((err: unknown) => {
          this.logger?.warn('释放回 pending 失败', {
            reviewId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }

  /** 按 msgId 查询（幂等用） */
  private async findByMsgId(msgId: string): Promise<ReviewRecord | null> {
    if (this.reviewModel) {
      try {
        const doc = await this.reviewModel.findOne({ msgId }).lean().exec();
        if (doc) return this.toInMemory(doc);
      } catch {
        // 忽略
      }
    }
    for (const r of this.reviews.values()) {
      if (r.msgId === msgId) return r;
    }
    return null;
  }

  /** 列出全部审核（超时巡检用） */
  private async listAll(): Promise<ReviewRecord[]> {
    if (this.reviewModel) {
      try {
        const docs = await this.reviewModel
          .find({ state: { $in: ['pending', 'claimed', 'reviewing'] } })
          .lean()
          .exec();
        return docs.map((d) => this.toInMemory(d));
      } catch (err) {
        this.logger?.warn('listAll 失败，回退内存', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return Array.from(this.reviews.values());
  }

  /** 风险等级排序权重（high > user_flagged > normal） */
  private riskOrder(level: string): number {
    if (level === 'high') return 3;
    if (level === 'user_flagged') return 2;
    return 1;
  }

  /** 生成 reviewId */
  private generateReviewId(): string {
    return `lr_${randomUUID()}`;
  }

  /** 写入内存表 */
  private putInMemory(review: ReviewRecord): void {
    this.reviews.set(review.reviewId, review);
  }

  /** 持久化到 DB */
  private async persist(review: ReviewRecord): Promise<void> {
    if (!this.reviewModel) return;
    try {
      await this.reviewModel.updateOne(
        { reviewId: review.reviewId },
        {
          $set: {
            state: review.state,
            claimedBy: review.claimedBy,
            claimedAt: review.claimedAt,
            annotations: review.annotations,
            reflowTargets: review.reflowTargets,
            updatedAt: review.updatedAt,
          },
        },
        { upsert: false },
      );
    } catch (err) {
      this.logger?.warn('持久化审核状态失败', {
        reviewId: review.reviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** DB 文档 → 内存表示 */
  private toInMemory(doc: LeanReview): ReviewRecord {
    return {
      reviewId: doc.reviewId,
      msgId: doc.msgId,
      userId: doc.userId,
      intent: doc.intent,
      riskLevel: doc.riskLevel,
      state: doc.state,
      sampledAt: doc.sampledAt,
      claimedBy: doc.claimedBy,
      claimedAt: doc.claimedAt,
      annotations: doc.annotations,
      reflowTargets: doc.reflowTargets,
      createdAt: doc.createdAt ?? doc.sampledAt,
      updatedAt: doc.updatedAt ?? doc.sampledAt,
    };
  }

  /** 构造业务错误 */
  private error(code: number, message: string): Error {
    const err = new Error(message);
    (err as Error & { code?: number }).code = code;
    return err;
  }
}
