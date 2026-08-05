/**
 * KnowledgeController 单元测试（A2-W1 法律知识 REST 端点）。
 *
 * 覆盖：
 *   - GET /v1/knowledge：分页列表 + 查询参数透传 + 参数校验
 *   - GET /v1/knowledge/categories：分类聚合
 *   - GET /v1/knowledge/:id：详情（含空 id → 400、不存在 → 404）
 *
 * 设计依据：A2 § 法律知识体系。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { KnowledgeController } from '../../src/modules/legal/knowledge/knowledge.controller';
import { KnowledgeBaseService } from '../../src/modules/legal/knowledge/knowledge-base.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

function makeService() {
  return {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
    listCategories: vi.fn().mockResolvedValue([]),
    getDetailById: vi.fn().mockResolvedValue({ id: 'k-1', title: '知识' }),
  };
}

describe('KnowledgeController /v1/knowledge', () => {
  let app: INestApplication;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    service = makeService();
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeBaseService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /：分页列表，参数透传', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/knowledge')
      .query({ type: 'law', category: 'civil', keyword: '时效', page: '2', pageSize: '20' });

    expect(res.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith({
      type: 'law',
      category: 'civil',
      keyword: '时效',
      page: 2,
      pageSize: 20,
    });
  });

  it('GET /：page < 1 → 400', async () => {
    const res = await request(app.getHttpServer()).get('/v1/knowledge').query({ page: '-1' });
    expect(res.status).toBe(400);
  });

  it('GET /：pageSize > 50 → 400', async () => {
    const res = await request(app.getHttpServer()).get('/v1/knowledge').query({ pageSize: '100' });
    expect(res.status).toBe(400);
  });

  it('GET /categories：分类聚合', async () => {
    service.listCategories.mockResolvedValue([{ type: 'law', count: 3 }]);
    const res = await request(app.getHttpServer()).get('/v1/knowledge/categories');
    expect(res.status).toBe(200);
    expect(service.listCategories).toHaveBeenCalled();
  });

  it('GET /:id：返回详情', async () => {
    const res = await request(app.getHttpServer()).get('/v1/knowledge/k-1');
    expect(res.status).toBe(200);
    expect(service.getDetailById).toHaveBeenCalledWith('k-1');
  });

  it('GET /:id：不存在 → 404', async () => {
    service.getDetailById.mockResolvedValue(null);
    const res = await request(app.getHttpServer()).get('/v1/knowledge/unknown');
    expect(res.status).toBe(404);
  });
});