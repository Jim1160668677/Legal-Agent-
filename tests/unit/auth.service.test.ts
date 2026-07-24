/**
 * AuthService 单元测试（A1-W2）。
 *
 * 验收点（A1 §6.1）：
 *   - loginByExternal 首次登录创建用户 + 签发 token + isNewUser=true
 *   - loginByExternal 二次登录复用 userId + isNewUser=false
 *   - verifyJwt 校验 access token，type 不匹配抛 4011
 *   - refresh 用 refresh token 换新 access
 *   - checkOwner 横向越权抛 4031
 *   - requireRole 角色越权抛 4032
 *
 * 设计依据：A1 §6.1；06 错误码 4011/4031/4032。
 *
 * 实现注：手动 new AuthService(jwt, config, userModel) 绕过 NestJS DI，
 *       避免 swc decorator metadata 在测试环境的解析差异。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/modules/auth/auth.service';

function makeConfig(): ConfigService {
  const store: Record<string, unknown> = {
    'app.jwt.secret': 'test-secret-32-chars-min-length!',
    'app.jwt.expiresIn': '7d',
    'app.jwt.refreshExpiresIn': '30d',
  };
  return {
    get: <T>(key: string): T => store[key] as T,
  } as unknown as ConfigService;
}

describe('AuthService', () => {
  let svc: AuthService;
  let jwt: JwtService;
  let userModel: {
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jwt = new JwtService({
      secret: 'test-secret-32-chars-min-length!',
      signOptions: { expiresIn: 604800 },
    });
    userModel = {
      findOne: vi.fn(),
      create: vi.fn(),
      updateOne: vi.fn(),
    };
    svc = new AuthService(jwt, makeConfig(), userModel as never);
  });

  it('loginByExternal 首次登录：创建用户 + 签发 token + isNewUser=true', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
      }),
    });
    userModel.create.mockResolvedValue({});
    userModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });

    const r = await svc.loginByExternal('phone', '13812345678');
    expect(r.isNewUser).toBe(true);
    expect(r.accessToken).toBeTruthy();
    expect(r.refreshToken).toBeTruthy();
    expect(r.userId).toBeTruthy();
  });

  it('loginByExternal 二次登录：复用 userId + isNewUser=false', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi
          .fn()
          .mockReturnValue({ exec: vi.fn().mockResolvedValue({ userId: 'existing-uid' }) }),
      }),
    });
    userModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });

    const r = await svc.loginByExternal('wechat', 'wx-openid-123');
    expect(r.isNewUser).toBe(false);
    expect(r.userId).toBe('existing-uid');
  });

  it('loginByExternal 空外部 ID → 抛 1001', async () => {
    await expect(svc.loginByExternal('phone', '')).rejects.toThrow(BadRequestException);
  });

  it('verifyJwt 校验 access token 成功', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ userId: 'u1' }) }),
      }),
    });
    userModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
    const { accessToken } = await svc.loginByExternal('email', 'a@b.com');
    const payload = svc.verifyJwt(accessToken, 'access');
    expect(payload.sub).toBe('u1');
    expect(payload.type).toBe('access');
  });

  it('verifyJwt refresh token 当 access 用 → 抛 4011', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ userId: 'u1' }) }),
      }),
    });
    userModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
    const { refreshToken } = await svc.loginByExternal('email', 'a@b.com');
    expect(() => svc.verifyJwt(refreshToken, 'access')).toThrow(UnauthorizedException);
  });

  it('refresh 用 refresh token 换新 access', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ userId: 'u1' }) }),
      }),
    });
    userModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
    const { refreshToken } = await svc.loginByExternal('email', 'a@b.com');
    const newTokens = await svc.refresh(refreshToken);
    expect(newTokens.accessToken).toBeTruthy();
    expect(newTokens.refreshToken).toBeTruthy();
    const payload = svc.verifyJwt(newTokens.accessToken, 'access');
    expect(payload.sub).toBe('u1');
  });

  it('refresh 用 access token → 抛 4011', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ userId: 'u1' }) }),
      }),
    });
    userModel.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
    const { accessToken } = await svc.loginByExternal('email', 'a@b.com');
    await expect(svc.refresh(accessToken)).rejects.toThrow(UnauthorizedException);
  });

  it('checkOwner 同 userId 通过', async () => {
    await expect(svc.checkOwner('u1', 'u1')).resolves.toBeUndefined();
  });

  it('checkOwner 不同 userId → 抛 4031', async () => {
    await expect(svc.checkOwner('u-other', 'u1')).rejects.toThrow(ForbiddenException);
    try {
      await svc.checkOwner('u-other', 'u1');
    } catch (e) {
      const resp = (e as ForbiddenException).getResponse() as { code: number };
      expect(resp.code).toBe(4031);
    }
  });

  it('requireRole admin 调 ops 通过', async () => {
    await expect(svc.requireRole({ sub: 'a', role: 'admin' }, 'ops')).resolves.toBeUndefined();
  });

  it('requireRole user 调 admin → 抛 4032', async () => {
    await expect(svc.requireRole({ sub: 'u', role: 'user' }, 'admin')).rejects.toThrow(
      ForbiddenException,
    );
    try {
      await svc.requireRole({ sub: 'u', role: 'user' }, 'admin');
    } catch (e) {
      const resp = (e as ForbiddenException).getResponse() as { code: number };
      expect(resp.code).toBe(4032);
    }
  });

  it('mapExternalIdentity 未命中返回空串', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
      }),
    });
    const id = await svc.mapExternalIdentity('phone', '13900000000');
    expect(id).toBe('');
  });

  it('mapExternalIdentity wechat 命中返回 userId', async () => {
    userModel.findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ userId: 'wx-uid' }) }),
      }),
    });
    const id = await svc.mapExternalIdentity('wechat', 'openid-xxx');
    expect(id).toBe('wx-uid');
  });
});
