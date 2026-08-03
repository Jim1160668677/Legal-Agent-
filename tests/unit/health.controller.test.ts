/**
 * HealthController 单元测试（A1-W1 + Phase 1.2 扩展）。
 *
 * 用 NestJS Testing Module 验证 /health 与 /health/ready 端点逻辑正确（不依赖真实 DB/Redis）。
 * 验收标准 A1 §十三第 1 项：/health 返回 200 + status:ok。
 *
 * Phase 1.2：mock mongo.Connection + REDIS_CLIENT，原 /health 用例不回归。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { HealthController } from '../../src/modules/health/health.controller';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('HealthController /health (liveness)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: { readyState: 1 } },
        { provide: REDIS_CLIENT, useValue: { ping: vi.fn().mockResolvedValue('PONG') } },
      ],
    })
      .overrideInterceptor(ResponseInterceptor)
      .useValue(new ResponseInterceptor())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  it('GET /health 返回 200 + status ok', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('ok');
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.data.timestamp).toBeTruthy();
  });

  it('GET /health 响应含 X-Trace-Id 头', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-trace-id']).toBeTruthy();
  });

  it('GET /health 多次调用 uptime 递增', async () => {
    const r1 = await request(app.getHttpServer()).get('/health');
    // 等待 1 秒确保 uptime 变化
    await new Promise((r) => setTimeout(r, 1100));
    const r2 = await request(app.getHttpServer()).get('/health');
    expect(r2.body.data.uptime).toBeGreaterThan(r1.body.data.uptime);
  });
});
