/**
 * LawyerReviewController —— 律师审核后台 REST 端点（v2.3 阶段十，17 §2-§6）。
 *
 * 端点（全部需 JWT 鉴权，role=ops/admin 为律师/运营角色）：
 *
 *   队列与详情：
 *     GET    /v1/reviews/queue              待审队列（state=pending，按风险降序）
 *     GET    /v1/reviews/mine               我的审核（claimedBy=me，state∈claimed/reviewing）
 *     GET    /v1/reviews/:reviewId          审核详情
 *
 *   审核流程操作（17 §2.2 状态机）：
 *     POST   /v1/reviews/:reviewId/claim    领取（pending→claimed）
 *     POST   /v1/reviews/:reviewId/start    开始标注（claimed→reviewing）
 *     POST   /v1/reviews/:reviewId/submit   提交标注（reviewing→submitted）
 *     POST   /v1/reviews/:reviewId/give-up  放弃（claimed/reviewing→pending）
 *     POST   /v1/reviews/:reviewId/reflow   触发标注回流（submitted→reflowed）
 *
 *   溯源与合规：
 *     GET    /v1/answers/:msgId/trace        查询消息溯源（17 §4.3）
 *     POST   /v1/reviews/:reviewId/compliance 合规复扫（17 §5.4）
 *
 * 响应格式：全局 ResponseInterceptor 包装为 { code:0, message:'ok', traceId, data }
 * 异常格式：HttpExceptionFilter 转为 { code, message, traceId, data:null }
 *
 * 设计依据：17 §2-§6；06-api-spec 律师审核端点。
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles, RolesGuard } from '../../auth/roles.decorator';
import type { JwtPayload } from '../../auth/auth.types';
import { LawyerReviewService } from './lawyer-review.service';
import { AnswerTracer } from './answer-tracer.service';
import { AnswerQualityScorer } from './answer-quality-scorer.service';
import { ComplianceMonitor } from './compliance-monitor.service';
import { LawyerAnnotationService } from './lawyer-annotation.service';
import { REVIEW_ERROR_CODES } from './review.constants';
import type { SubmitReviewDto, ReflowDto, ComplianceScanDto } from './lawyer-review.dto';
import type { LawyerReviewAnnotations, LawyerRiskFlag } from './review.types';

/** 业务错误码 → HTTP 状态映射 */
function mapReviewError(err: unknown): never {
  const code = (err as Error & { code?: number })?.code;
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case REVIEW_ERROR_CODES.REVIEW_NOT_FOUND:
    case REVIEW_ERROR_CODES.TRACE_NOT_FOUND:
      throw new NotFoundException({ code, message });
    case REVIEW_ERROR_CODES.INVALID_TRANSITION:
      throw new BadRequestException({ code, message });
    case REVIEW_ERROR_CODES.INVALID_SCORE:
      throw new BadRequestException({ code, message });
    case REVIEW_ERROR_CODES.COMPLIANCE_BLOCKED:
      throw new ForbiddenException({ code, message });
    default:
      throw new BadRequestException({ code: code ?? 5001, message });
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ops', 'admin')
export class LawyerReviewController {
  constructor(
    private readonly reviewService: LawyerReviewService,
    private readonly tracer: AnswerTracer,
    private readonly qualityScorer: AnswerQualityScorer,
    private readonly complianceMonitor: ComplianceMonitor,
    private readonly annotationService: LawyerAnnotationService,
  ) {}

  // ===== 队列与详情 =====

  /** 待审队列（state=pending，按风险降序，17 §2.5） */
  @Get('v1/reviews/queue')
  async getQueue(@Query('limit') limit?: string) {
    const lim = limit ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100) : 20;
    return this.reviewService.getQueue(lim);
  }

  /** 我的审核（claimedBy=me，state∈claimed/reviewing，17 §2.5） */
  @Get('v1/reviews/mine')
  async getMine(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    const lim = limit ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100) : 20;
    return this.reviewService.getMyReviews(user.sub, lim);
  }

  /** 审核详情（17 §2.5） */
  @Get('v1/reviews/:reviewId')
  async getReview(@Param('reviewId') reviewId: string) {
    const review = await this.reviewService.getReview(reviewId);
    if (!review) {
      throw new NotFoundException({
        code: REVIEW_ERROR_CODES.REVIEW_NOT_FOUND,
        message: `审核 ${reviewId} 不存在`,
      });
    }
    return review;
  }

  // ===== 审核流程操作（17 §2.2 状态机）=====

  /** 领取审核（pending→claimed） */
  @Post('v1/reviews/:reviewId/claim')
  @HttpCode(200)
  async claim(@Param('reviewId') reviewId: string, @CurrentUser() user: JwtPayload) {
    try {
      return await this.reviewService.claim(reviewId, user.sub);
    } catch (err) {
      mapReviewError(err);
    }
  }

  /** 开始标注（claimed→reviewing） */
  @Post('v1/reviews/:reviewId/start')
  @HttpCode(200)
  async start(@Param('reviewId') reviewId: string, @CurrentUser() user: JwtPayload) {
    try {
      return await this.reviewService.startReview(reviewId, user.sub);
    } catch (err) {
      mapReviewError(err);
    }
  }

  /** 提交标注（reviewing→submitted，17 §2.4 标注字段） */
  @Post('v1/reviews/:reviewId/submit')
  @HttpCode(200)
  async submit(
    @Param('reviewId') reviewId: string,
    @Body() dto: SubmitReviewDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const annotations: LawyerReviewAnnotations = {
      scores: dto.scores,
      textAnnotations: dto.textAnnotations,
      riskFlag: dto.riskFlag,
      reviewedBy: user.sub,
      reviewedAt: new Date(),
      duration: dto.duration ?? 0,
    };

    try {
      const review = await this.reviewService.submit(reviewId, annotations);
      if (!review) {
        throw new NotFoundException({
          code: REVIEW_ERROR_CODES.REVIEW_NOT_FOUND,
          message: `审核 ${reviewId} 不存在`,
        });
      }

      // 计算律师评分（17 §3.3 + §3.4）
      const lawyerScore = this.qualityScorer.computeLawyerScore({ scores: dto.scores });

      // 律师提交后触发合规复扫（17 §5.4 闭环）
      let complianceResult: { level: string; blocked: boolean } | undefined;
      try {
        const scan = await this.complianceMonitor.scanAfterLawyerReview(
          review.msgId,
          review.userId,
          dto.riskFlag as LawyerRiskFlag,
        );
        complianceResult = { level: scan.level, blocked: scan.blocked };
      } catch {
        // 合规复扫失败不阻断提交，仅记录
      }

      return {
        review,
        lawyerScore,
        compliance: complianceResult,
      };
    } catch (err) {
      mapReviewError(err);
    }
  }

  /** 放弃审核（claimed/reviewing→pending，17 §2.2 give_up） */
  @Post('v1/reviews/:reviewId/give-up')
  @HttpCode(200)
  async giveUp(@Param('reviewId') reviewId: string, @CurrentUser() user: JwtPayload) {
    try {
      return await this.reviewService.giveUp(reviewId, user.sub);
    } catch (err) {
      mapReviewError(err);
    }
  }

  /** 触发标注回流（submitted→reflowed，17 §6.3） */
  @Post('v1/reviews/:reviewId/reflow')
  @HttpCode(200)
  async reflow(@Param('reviewId') reviewId: string, @Body() dto: ReflowDto) {
    const review = await this.reviewService.getReview(reviewId);
    if (!review) {
      throw new NotFoundException({
        code: REVIEW_ERROR_CODES.REVIEW_NOT_FOUND,
        message: `审核 ${reviewId} 不存在`,
      });
    }
    if (review.state !== 'submitted') {
      throw new BadRequestException({
        code: REVIEW_ERROR_CODES.INVALID_TRANSITION,
        message: `审核当前状态为 ${review.state}，仅 submitted 可触发回流`,
      });
    }
    if (!review.annotations) {
      throw new BadRequestException({
        code: REVIEW_ERROR_CODES.INVALID_SCORE,
        message: '审核缺少标注数据，无法回流',
      });
    }

    // 若未传 reasoningChainId，尝试从溯源记录中获取
    let reasoningChainId = dto.reasoningChainId;
    if (!reasoningChainId) {
      const trace = await this.tracer.getTrace(review.msgId);
      reasoningChainId = trace?.reasoningChainId;
    }

    const result = await this.annotationService.reflow(
      {
        reviewId: review.reviewId,
        msgId: review.msgId,
        userId: review.userId,
        intent: review.intent as never,
        annotations: review.annotations,
      },
      {
        reasoningChainId,
        qualityScore: dto.qualityScore,
      },
    );

    return result;
  }

  // ===== 溯源与合规 =====

  /** 查询消息溯源记录（17 §4.3，GET /v1/answers/:msgId/trace） */
  @Get('v1/answers/:msgId/trace')
  async getTrace(@Param('msgId') msgId: string) {
    const trace = await this.tracer.getTrace(msgId);
    if (!trace) {
      throw new NotFoundException({
        code: REVIEW_ERROR_CODES.TRACE_NOT_FOUND,
        message: `消息 ${msgId} 的溯源记录不存在`,
      });
    }
    return trace;
  }

  /** 合规复扫（17 §5.4，律师可手动触发合规风险扫描） */
  @Post('v1/reviews/:reviewId/compliance')
  @HttpCode(200)
  async complianceScan(@Param('reviewId') reviewId: string, @Body() dto: ComplianceScanDto) {
    const review = await this.reviewService.getReview(reviewId);
    if (!review) {
      throw new NotFoundException({
        code: REVIEW_ERROR_CODES.REVIEW_NOT_FOUND,
        message: `审核 ${reviewId} 不存在`,
      });
    }

    // 从溯源记录中获取引用法条，计算失败率
    let citationFailureRate = dto.citationFailureRate;
    if (citationFailureRate === undefined) {
      const trace = await this.tracer.getTrace(review.msgId);
      if (trace) {
        citationFailureRate = this.tracer.computeCitationFailureRate(trace.citedLaws);
      }
    }

    const result = await this.complianceMonitor.scan({
      msgId: review.msgId,
      userId: review.userId,
      answer: '',
      citationFailureRate,
      lawyerRiskFlag: dto.lawyerRiskFlag ?? review.annotations?.riskFlag,
    });

    return result;
  }
}
