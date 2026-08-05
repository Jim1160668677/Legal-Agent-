/**
 * LegalExpertiseController 单元测试（v3.0 新增）。
 *
 * 覆盖：
 *   - 无 Authorization 头 → 401（JwtAuthGuard）
 *   - 带合法 JWT 但角色不足 → 403（RolesGuard，mock AuthService.requireRole 抛错）
 *   - 带合法 JWT + lawyer 角色 → 200（CRUD 端点可达）
 *   - knowledge / review / visualization / quality 端点路由正确
 *   - 服务方法被正确调用
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/roles.decorator';
import { LegalExpertiseController } from '../../src/modules/legal/legal-expertise.controller';
import { LawyerExpertiseKnowledgeBaseService } from '../../src/modules/legal/knowledge/lawyer-expertise-knowledge-base.service';
import { PrePublishReviewService } from '../../src/modules/legal/review/pre-publish-review.service';
import { ReasoningVisualizationService } from '../../src/modules/legal/reasoning/reasoning-visualization.service';
import { ExpertiseQualityScorer } from '../../src/modules/legal/review/expertise-quality-scorer.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

const mockJwtAuthGuard: CanActivate = {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const auth = req.headers['authorization'] ?? '';
    if (auth.startsWith('Bearer ')) return true;
    throw new UnauthorizedException({ code: 1003, message: '未授权' });
  },
};

const mockRolesGuard: CanActivate = {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const role = req.headers['x-role'] ?? '';
    if (role === 'lawyer' || role === 'admin' || role === 'user') return true;
    throw new ForbiddenException({ code: 1004, message: '角色权限不足' });
  },
};

function makeExpertiseService() {
  return {
    create: vi.fn().mockResolvedValue({ expertiseId: 'le_1' }),
    query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getById: vi.fn().mockResolvedValue({ expertiseId: 'le_1' }),
    update: vi.fn().mockResolvedValue({ expertiseId: 'le_1' }),
    remove: vi.fn().mockResolvedValue(true),
    queryForScenario: vi.fn().mockResolvedValue([]),
  };
}

function makeReviewService() {
  return {
    createReview: vi.fn().mockResolvedValue({ reviewId: 'ppr_1' }),
    getQueue: vi.fn().mockResolvedValue([]),
    claimReview: vi.fn().mockResolvedValue({ reviewId: 'ppr_1' }),
    startReview: vi.fn().mockResolvedValue({ reviewId: 'ppr_1' }),
    submitAndApprove: vi.fn().mockResolvedValue({ status: 'approved' }),
    submitAndReject: vi.fn().mockResolvedValue({ status: 'rejected' }),
    getByReviewId: vi.fn().mockResolvedValue({ reviewId: 'ppr_1' }),
    getLawyerHistory: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ total: 0 }),
  };
}

function makeVisualizationService() {
  return {
    generateVisualization: vi.fn().mockResolvedValue({ type: 'irac_flowchart' }),
    generateJudgmentExplanation: vi.fn().mockResolvedValue({ summary: 's' }),
    generateSummaryView: vi.fn().mockResolvedValue({ totalExpertiseApplied: 0 }),
  };
}

function makeQualityScorer() {
  return {
    evaluateByReasoningChain: vi.fn().mockResolvedValue({ grade: 'B' }),
    evaluate: vi.fn().mockResolvedValue({ grade: 'B' }),
  };
}

describe('LegalExpertiseController /api/v3/legal/expertise', () => {
  let app: INestApplication;
  let expertiseService: ReturnType<typeof makeExpertiseService>;
  let reviewService: ReturnType<typeof makeReviewService>;
  let visualizationService: ReturnType<typeof makeVisualizationService>;
  let qualityScorer: ReturnType<typeof makeQualityScorer>;

  beforeEach(async () => {
    expertiseService = makeExpertiseService();
    reviewService = makeReviewService();
    visualizationService = makeVisualizationService();
    qualityScorer = makeQualityScorer();

    const moduleRef = await Test.createTestingModule({
      controllers: [LegalExpertiseController],
      providers: [
        { provide: LawyerExpertiseKnowledgeBaseService, useValue: expertiseService },
        { provide: PrePublishReviewService, useValue: reviewService },
        { provide: ReasoningVisualizationService, useValue: visualizationService },
        { provide: ExpertiseQualityScorer, useValue: qualityScorer },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ===== 鉴权 =====

  it('无 Authorization 头 → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v3/legal/expertise/knowledge');
    expect(res.status).toBe(401);
  });

  it('带 JWT 但角色不足（无 x-role）→ 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v3/legal/expertise/knowledge')
      .set('Authorization', 'Bearer valid');
    expect(res.status).toBe(403);
  });

  // ===== 知识库 CRUD =====

  it('GET knowledge：查询列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v3/legal/expertise/knowledge')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'lawyer');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(expertiseService.query).toHaveBeenCalled();
  });

  it('POST knowledge：创建专业知识', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/legal/expertise/knowledge')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'lawyer')
      .send({ expertiseType: 'case_analysis', title: 't', content: 'c', contributedBy: 'l1' });

    expect(res.status).toBe(201);
    expect(expertiseService.create).toHaveBeenCalled();
  });

  it('GET knowledge/:id：按 ID 查询', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v3/legal/expertise/knowledge/le_1')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'user');

    expect(res.status).toBe(200);
    expect(expertiseService.getById).toHaveBeenCalledWith('le_1');
  });

  it('DELETE knowledge/:id：admin 删除', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v3/legal/expertise/knowledge/le_1')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'admin');

    expect(res.status).toBe(200);
    expect(expertiseService.remove).toHaveBeenCalledWith('le_1');
  });

  // ===== 预发布审核 =====

  it('GET review/queue：审核队列', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v3/legal/expertise/review/queue')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'lawyer');

    expect(res.status).toBe(200);
    expect(reviewService.getQueue).toHaveBeenCalled();
  });

  it('POST review/approve：提交通过', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/legal/expertise/review/approve')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'lawyer')
      .send({ reviewId: 'ppr_1', lawyerId: 'l1', modifications: [], supplements: [] });

    expect(res.status).toBe(200);
    expect(reviewService.submitAndApprove).toHaveBeenCalled();
  });

  // ===== 可视化 =====

  it('GET visualization/:chainId：生成可视化', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v3/legal/expertise/visualization/rc-1')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'user');

    expect(res.status).toBe(200);
    expect(visualizationService.generateVisualization).toHaveBeenCalledWith('rc-1', {});
  });

  // ===== 质量评估 =====

  it('GET quality/:chainId：评估质量', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v3/legal/expertise/quality/rc-1')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'lawyer');

    expect(res.status).toBe(200);
    expect(qualityScorer.evaluateByReasoningChain).toHaveBeenCalledWith('rc-1');
  });

  it('POST quality/evaluate：即时评估', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/legal/expertise/quality/evaluate')
      .set('Authorization', 'Bearer valid')
      .set('x-role', 'admin')
      .send({ expertiseApplied: [] });

    expect(res.status).toBe(201);
    expect(qualityScorer.evaluate).toHaveBeenCalled();
  });
});
