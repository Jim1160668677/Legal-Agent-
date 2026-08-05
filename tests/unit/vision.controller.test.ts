/**
 * VisionController 单元测试（v2.4 图像识别 REST API）。
 *
 * 覆盖：
 *   - POST /v1/vision/recognize：无 token → 401（JwtAuthGuard）
 *   - POST /v1/vision/recognize：带 token → 200 + 调用 recognize
 *   - POST /v1/vision/upload：无文件 → 400（8001）
 *   - POST /v1/vision/upload：带文件 → base64 包装后调用 recognize
 *   - GET /v1/vision/health：返回 provider 健康状态
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { VisionController } from '../../src/modules/legal/vision/vision.controller';
import { VisionService } from '../../src/modules/legal/vision/vision.service';
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

function makeVisionService() {
  return {
    recognize: vi.fn().mockResolvedValue({
      text: '识别结果',
      provider: 'zhipu-flash',
      fallbackUsed: false,
      durationMs: 5,
    }),
    getProviderStatus: vi.fn().mockReturnValue([
      { name: 'zhipu-flash', model: 'glm-4v-flash', priority: 1, healthy: true },
    ]),
  };
}

describe('VisionController /v1/vision', () => {
  let app: INestApplication;
  let visionService: ReturnType<typeof makeVisionService>;

  beforeEach(async () => {
    visionService = makeVisionService();

    const moduleRef = await Test.createTestingModule({
      controllers: [VisionController],
      providers: [{ provide: VisionService, useValue: visionService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST recognize：无 token → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/vision/recognize')
      .send({ image: 'https://example.com/doc.png' });
    expect(res.status).toBe(401);
  });

  it('POST recognize：带 token → 200 + 调用服务', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/vision/recognize')
      .set('Authorization', 'Bearer valid')
      .send({ image: 'https://example.com/doc.png', prompt: '识别文字' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(visionService.recognize).toHaveBeenCalledWith({
      image: 'https://example.com/doc.png',
      prompt: '识别文字',
    });
  });

  it('POST upload：无文件 → 400（8001）', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/vision/upload')
      .set('Authorization', 'Bearer valid')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(8001);
  });

  it('POST upload：带文件 → base64 包装后调用服务', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/vision/upload')
      .set('Authorization', 'Bearer valid')
      .attach('file', Buffer.from('fake-image-bytes'), 'doc.png');

    expect(res.status).toBe(201);
    expect(visionService.recognize).toHaveBeenCalledWith({
      image: 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==',
    });
  });

  it('GET health：返回 provider 健康状态', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/vision/health')
      .set('Authorization', 'Bearer valid');

    expect(res.status).toBe(200);
    expect(visionService.getProviderStatus).toHaveBeenCalled();
    expect(res.body.data.providers).toHaveLength(1);
  });
});