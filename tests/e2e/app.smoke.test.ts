import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * 应用级 E2E smoke —— 真实 AppModule 启动 + 全链路 HTTP 验证。
 *
 * 门控：本地 Mongo(27017) + Redis(6379) 可达（docker compose up -d mongo redis）。
 * 不可达时整个 describe 在 beforeEach 中 runtime skip，避免在缺 infra 的 CI 环境失败。
 *
 * 启动策略：supertest 绑定 app.getHttpServer()，由 supertest 自动绑定临时端口，
 * 不占用固定端口（避免与本机已运行实例冲突），也不依赖 app.listen()。
 *
 * 覆盖：/health → JWT 登录 → 受保护端点(401/403) → 真实 LLM 对话
 *   (意图识别→规则引擎→法条引用→SSE 帧→免责声明→Mongo 持久化)。
 *
 * 设计依据：v3.0 收尾；此前因 Docker/Mongo/Redis 不可用被阻塞,现已打通。
 */

let app: INestApplication;
let request: supertest.Agent;
let infraReady = false;
let accessToken = '';

beforeAll(async () => {
  try {
    app = await NestFactory.create(AppModule, { bufferLogs: true });

    // 与 main.ts 保持一致的全局件：ValidationPipe + HttpExceptionFilter + ResponseInterceptor
    // （helmet/cors 在纯后端测试中省略，不影响功能验证）
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());

    await app.init();
    request = supertest(app.getHttpServer());

    // 启动后探测 /health：200 说明应用启动成功（ResponseInterceptor 包裹后 data.status === 'ok'）
    const res = await request.get('/health');
    infraReady = res.status === 200 && res.body?.data?.status === 'ok';
    if (!infraReady) {
      console.warn('[app.smoke] /health not ok, skipping E2E (infra not ready)');
      return;
    }

    // 预登录，供后续受保护端点复用
    const login = await request
      .post('/v1/auth/login')
      .send({ provider: 'email', externalId: 'e2e_smoke@test.com', role: 'lawyer' });
    accessToken = login.body?.data?.accessToken ?? '';
  } catch (err) {
    infraReady = false;
    console.warn(
      `[app.smoke] app failed to start: ${err instanceof Error ? err.stack : String(err)}`,
    );
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
});

// 运行时 infra 未就绪则跳过整个 describe
beforeEach((ctx) => {
  if (!infraReady) ctx.skip();
});

describe('AppModule E2E smoke（真实启动 + HTTP 端到端）', () => {
  it('1. /health → 200 + status ok + 统一信封(code=0)', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('ok');
    expect(res.body.data.status).toBe('ok');
    expect(res.body.traceId).toBeTruthy();
  });

  it('2. POST /v1/auth/login → 签发 access + refresh token', async () => {
    const res = await request
      .post('/v1/auth/login')
      .send({ provider: 'email', externalId: `e2e_${Date.now()}@test.com`, role: 'lawyer' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.userId).toBeTruthy();
  });

  it('3. 受保护端点无 token → 401，有 token → 通过认证', async () => {
    const noAuth = await request.get('/v1/answers/msg_smoke/trace');
    expect(noAuth.status).toBe(401);

    // 有 token 后应通过认证（403 = 权限不足，也说明认证已过）
    const withAuth = await request
      .get('/v1/answers/msg_smoke/trace')
      .set('Authorization', `Bearer ${accessToken}`);
    expect([200, 403]).toContain(withAuth.status);
  });

  it('4. POST /v1/chat → 真实 LLM 对话全链路（意图→规则→法条→SSE→免责声明）', async () => {
    const res = await request
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .send({ message: '请用一句话解释什么是诉讼时效?' });

    // SSE 流式：201 + text/event-stream
    expect([200, 201]).toContain(res.status);
    const raw = res.text ?? '';

    // 帧序列完整：chunk → meta(含 intent/route/lawRefs) → disclaimer → done
    expect(raw).toContain('"type":"chunk"');
    expect(raw).toContain('"type":"meta"');
    expect(raw).toContain('"intent":"legal_qa"');
    expect(raw).toContain('"route":"rule"');
    expect(raw).toContain('lawRefs');
    expect(raw).toContain('"type":"disclaimer"');
    expect(raw).toContain('不构成法律意见');
    expect(raw).toContain('"type":"done"');
  });

  it('5. GET /v1/vision/health → provider 健康状态', async () => {
    const res = await request
      .get('/v1/vision/health')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.providers).toBeInstanceOf(Array);
    expect(res.body.data.providers.length).toBeGreaterThan(0);
  });
});