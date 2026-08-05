/**
 * LegalExpertiseController —— 律师专业知识 API 控制器（v3.0 新增）。
 *
 * 提供以下 API 端点：
 *   1. 律师专业知识库 CRUD
 *   2. 预发布审核工作流管理
 *   3. 推理可视化查询
 *   4. 专业判断质量评估
 *
 * 路由前缀：/api/v3/legal/expertise
 *
 * 设计依据：用户需求 1-5；v3.0 律师专业判断深度整合。
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.decorator';
import { Roles } from '../auth/roles.decorator';
import { LawyerExpertiseKnowledgeBaseService } from './knowledge/lawyer-expertise-knowledge-base.service';
import { PrePublishReviewService } from './review/pre-publish-review.service';
import { ReasoningVisualizationService } from './reasoning/reasoning-visualization.service';
import { ExpertiseQualityScorer } from './review/expertise-quality-scorer.service';
import type {
  CreateExpertiseInput,
  UpdateExpertiseInput,
  ExpertiseQuery,
} from './knowledge/lawyer-expertise-knowledge-base.service';
import type {
  CreateReviewInput,
  ClaimReviewInput,
  SubmitModificationInput,
  QueueQuery,
} from './review/pre-publish-review.service';
import type { VisualizationConfig } from './reasoning/reasoning-visualization.service';

@Controller('api/v3/legal/expertise')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LegalExpertiseController {
  constructor(
    private readonly expertiseService: LawyerExpertiseKnowledgeBaseService,
    private readonly prePublishReviewService: PrePublishReviewService,
    private readonly visualizationService: ReasoningVisualizationService,
    private readonly qualityScorer: ExpertiseQualityScorer,
  ) {}

  // ===== 律师专业知识库 CRUD =====

  /** 创建律师专业知识 */
  @Post('knowledge')
  @Roles('lawyer', 'admin')
  async createKnowledge(@Body() input: CreateExpertiseInput) {
    return this.expertiseService.create(input);
  }

  /** 查询律师专业知识列表 */
  @Get('knowledge')
  @Roles('lawyer', 'admin', 'user')
  async queryKnowledge(@Query() params: ExpertiseQuery) {
    return this.expertiseService.query(params);
  }

  /** 按 ID 查询律师专业知识 */
  @Get('knowledge/:expertiseId')
  @Roles('lawyer', 'admin', 'user')
  async getKnowledge(@Param('expertiseId') expertiseId: string) {
    return this.expertiseService.getById(expertiseId);
  }

  /** 更新律师专业知识 */
  @Put('knowledge/:expertiseId')
  @Roles('lawyer', 'admin')
  async updateKnowledge(
    @Param('expertiseId') expertiseId: string,
    @Body() input: UpdateExpertiseInput,
  ) {
    return this.expertiseService.update(expertiseId, input);
  }

  /** 删除律师专业知识 */
  @Delete('knowledge/:expertiseId')
  @Roles('admin')
  async deleteKnowledge(@Param('expertiseId') expertiseId: string) {
    return this.expertiseService.remove(expertiseId);
  }

  /** 按场景查询相关专业知识 */
  @Get('knowledge/scenario/:scenario')
  @Roles('lawyer', 'admin', 'user')
  async queryByScenario(@Param('scenario') scenario: string) {
    return this.expertiseService.queryForScenario(scenario as never);
  }

  // ===== 预发布审核工作流 =====

  /** 创建预发布审核任务 */
  @Post('review/pending')
  @Roles('lawyer', 'admin')
  async createReview(@Body() input: CreateReviewInput) {
    return this.prePublishReviewService.createReview(input);
  }

  /** 获取待处理审核队列 */
  @Get('review/queue')
  @Roles('lawyer', 'admin')
  async getReviewQueue(@Query() query: QueueQuery) {
    return this.prePublishReviewService.getQueue(query);
  }

  /** 律师领取审核任务 */
  @Post('review/claim')
  @Roles('lawyer')
  async claimReview(@Body() input: ClaimReviewInput) {
    return this.prePublishReviewService.claimReview(input);
  }

  /** 律师开始审核 */
  @Post('review/:reviewId/start')
  @Roles('lawyer')
  async startReview(
    @Param('reviewId') reviewId: string,
    @Body('lawyerId') lawyerId: string,
  ) {
    return this.prePublishReviewService.startReview(reviewId, lawyerId);
  }

  /** 律师提交审核（通过） */
  @Post('review/approve')
  @Roles('lawyer')
  @HttpCode(200)
  async submitApproval(@Body() input: SubmitModificationInput) {
    return this.prePublishReviewService.submitAndApprove(input);
  }

  /** 律师提交审核（驳回） */
  @Post('review/reject')
  @Roles('lawyer')
  @HttpCode(200)
  async submitRejection(@Body() input: SubmitModificationInput) {
    return this.prePublishReviewService.submitAndReject(input);
  }

  /** 获取审核详情 */
  @Get('review/:reviewId')
  @Roles('lawyer', 'admin', 'user')
  async getReview(@Param('reviewId') reviewId: string) {
    return this.prePublishReviewService.getByReviewId(reviewId);
  }

  /** 获取律师历史审核记录 */
  @Get('review/history/:lawyerId')
  @Roles('lawyer', 'admin')
  async getReviewHistory(
    @Param('lawyerId') lawyerId: string,
    @Query('limit') limit?: number,
  ) {
    return this.prePublishReviewService.getLawyerHistory(lawyerId, limit);
  }

  /** 获取审核统计 */
  @Get('review/stats')
  @Roles('admin', 'lawyer')
  async getReviewStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.prePublishReviewService.getStats(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  // ===== 推理可视化 =====

  /** 生成推理可视化图 */
  @Get('visualization/:reasoningChainId')
  @Roles('lawyer', 'admin', 'user')
  async generateVisualization(
    @Param('reasoningChainId') reasoningChainId: string,
    @Query() config?: Partial<VisualizationConfig>,
  ) {
    return this.visualizationService.generateVisualization(
      reasoningChainId,
      config ?? {},
    );
  }

  /** 生成专业判断应用说明 */
  @Get('visualization/:reasoningChainId/explanation')
  @Roles('lawyer', 'admin', 'user')
  async generateJudgmentExplanation(
    @Param('reasoningChainId') reasoningChainId: string,
  ) {
    return this.visualizationService.generateJudgmentExplanation(reasoningChainId);
  }

  /** 生成摘要视图 */
  @Get('visualization/:reasoningChainId/summary')
  @Roles('lawyer', 'admin', 'user')
  async generateSummaryView(
    @Param('reasoningChainId') reasoningChainId: string,
  ) {
    return this.visualizationService.generateSummaryView(reasoningChainId);
  }

  // ===== 专业判断质量评估 =====

  /** 评估指定推理链的专业判断质量 */
  @Get('quality/:reasoningChainId')
  @Roles('lawyer', 'admin')
  async evaluateQuality(@Param('reasoningChainId') reasoningChainId: string) {
    return this.qualityScorer.evaluateByReasoningChain(reasoningChainId);
  }

  /** 即时评估专业判断质量 */
  @Post('quality/evaluate')
  @Roles('lawyer', 'admin')
  async evaluateQualityInstant(@Body() input: Parameters<ExpertiseQualityScorer['evaluate']>[0]) {
    return this.qualityScorer.evaluate(input);
  }
}
