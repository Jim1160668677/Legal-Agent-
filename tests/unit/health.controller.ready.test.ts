/**
 * HealthController /health/ready 单元测试（Phase 1.2）。
 *
 * 验收点：
 *   - mongo + redis 均 up → 200 {code:0, data:{status:'ready', checks:{mongo:'up',redis:'up'}}}
 *   - mongo down (readyState≠1) → 503 {code:5030, data:null, message 含 'mongo=down'}
 *   - redis ping 失败 → 503 {code:5030, message 含 'redis=down'}
 *   - redis ping 超时（>2s）→ 503 {code:5030, message 含 'redis=down'}
 *
 * 设计依据：Phase 1.2 readiness 探针。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { HealthController } from '../../src/modules/health/health.controller';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('HealthController /health/ready (readiness)', () => {
  let app: INestApplication;
  let mongoConn: { readyState: number };
  let redis: { ping: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mongoConn = { readyState: 1 }; // 1 = connected
    redis = { ping: vi.fn().mockResolvedValue('PONG') };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: mongoConn },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    })
      .overrideInterceptor(ResponseInterceptor)
      .useValue(new ResponseInterceptor())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('mongo + redis 均 up → 200 ready', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('ready');
    expect(res.body.data.checks.mongo).toBe('up');
    expect(res.body.data.checks.redis).toBe('up');
    expect(res.body.data.timestamp).toBeTruthy();
  });

  it('mongo readyState=0 (disconnected) → 503 degraded + mongo=down', async () => {
    mongoConn.readyState = 0;
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(5030);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toContain('mongo=down');
  });

  it('mongo readyState=2 (connecting) → 503 degraded + mongo=down', async () => {
    mongoConn.readyState = 2;
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(5030);
    expect(res.body.message).toContain('mongo=down');
  });

  it('redis ping 失败 → 503 degraded + redis=down', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(5030);
    expect(res.body.message).toContain('redis=down');
  });

  it('redis ping 超时 (>2s) → 503 degraded + redis=down', async () => {
    // ping 永不 resolve，模拟 ioredis 重试挂住
    redis.ping.mockImplementation(
      () =>
        new Promise<string>(() => {
          /* never resolve */
        }),
    );
    const start = Date.now();
    const res = await request(app.getHttpServer()).get('/health/ready');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(5030);
    expect(res.body.message).toContain('redis=down');
    // 验证超时保护生效：总耗时不应超过 3s（2s 超时 + 余量）
    expect(elapsed).toBeLessThan(3000);
  });
});
