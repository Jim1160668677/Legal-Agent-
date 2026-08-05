/**
 * AuthController 单元测试（A1-W2 登录/刷新端点）。
 *
 * 覆盖：
 *   - POST /v1/auth/login：合法入参 → 200 + 调用 AuthService.loginByExternal
 *   - POST /v1/auth/login：缺 externalId → 400（class-validator）
 *   - POST /v1/auth/login：缺 provider → 400
 *   - POST /v1/auth/refresh：合法入参 → 200 + 调用 AuthService.refresh
 *   - POST /v1/auth/refresh：缺 refreshToken → 400
 *
 * 设计依据：A1 §6.1 登录端点。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

function makeAuth() {
  return {
    loginByExternal: vi.fn().mockResolvedValue({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      userId: 'u-1',
      isNewUser: false,
    }),
    refresh: vi.fn().mockResolvedValue({ accessToken: 'at-2', refreshToken: 'rt-2' }),
    validateToken: vi.fn(),
    logout: vi.fn(),
  };
}

describe('AuthController /v1/auth', () => {
  let app: INestApplication;
  let auth: ReturnType<typeof makeAuth>;

  beforeEach(async () => {
    auth = makeAuth();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();

    app = moduleRef.createNestApplication();
    // 使用真实 ValidationPipe 验证 DTO 校验规则
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST login：合法入参 → 200 + 调用服务', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ provider: 'phone', externalId: '13800138000', role: 'user' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(auth.loginByExternal).toHaveBeenCalledWith('phone', '13800138000', 'user');
  });

  it('POST login：缺 externalId → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ provider: 'phone' });

    expect(res.status).toBe(400);
    expect(auth.loginByExternal).not.toHaveBeenCalled();
  });

  it('POST login：缺 provider → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ externalId: '13800138000' });

    expect(res.status).toBe(400);
  });

  it('POST refresh：合法入参 → 200 + 调用服务', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'rt-1' });

    expect(res.status).toBe(200);
    expect(auth.refresh).toHaveBeenCalledWith('rt-1');
  });

  it('POST refresh：缺 refreshToken → 400', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/refresh').send({});

    expect(res.status).toBe(400);
    expect(auth.refresh).not.toHaveBeenCalled();
  });
});