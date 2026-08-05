/**
 * RolesGuard 单元测试（A1-W2 RBAC 守卫）。
 *
 * 覆盖：
 *   - 无 @Roles 元数据 → 放行
 *   - 空角色数组 → 放行
 *   - 有角色但 req.user 缺失 → 拒绝
 *   - 有角色 + user → 调 AuthService.requireRole 且返回 true
 *   - requireRole 抛错 → 上抛（由 HttpExceptionFilter 转错误信封）
 *
 * 设计依据：A1 §6.1 requireRole；03 §六 RBAC。
 */
import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RolesGuard, Roles, ROLES_KEY } from '../../src/modules/auth/roles.decorator';
import type { JwtPayload } from '../../src/modules/auth/auth.types';

const user: JwtPayload = { sub: 'u1', username: 'ops-1', role: 'ops' };

function makeContext(userInReq?: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: userInReq }),
    }),
  } as never;
}

describe('RolesGuard', () => {
  it('无 @Roles 元数据 → 放行', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => undefined) };
    const auth = { requireRole: vi.fn() };
    const guard = new RolesGuard(reflector as never, auth as never);
    expect(await guard.canActivate(makeContext(user))).toBe(true);
    expect(auth.requireRole).not.toHaveBeenCalled();
  });

  it('空角色数组 → 放行', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => []) };
    const guard = new RolesGuard(reflector as never, { requireRole: vi.fn() } as never);
    expect(await guard.canActivate(makeContext(user))).toBe(true);
  });

  it('有 @Roles 但 req.user 缺失 → 拒绝（false）', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => ['ops']) };
    const guard = new RolesGuard(reflector as never, { requireRole: vi.fn() } as never);
    expect(await guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it('有 @Roles + user → 调 requireRole 并放行', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => ['ops', 'admin']) };
    const requireRole = vi.fn().mockResolvedValue(undefined);
    const guard = new RolesGuard(reflector as never, { requireRole } as never);

    expect(await guard.canActivate(makeContext(user))).toBe(true);
    expect(requireRole).toHaveBeenCalledWith(user, 'ops');
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('requireRole 抛错 → 上抛异常', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => ['admin']) };
    const authError = new Error('forbidden');
    const guard = new RolesGuard(reflector as never, {
      requireRole: vi.fn().mockRejectedValue(authError),
    } as never);
    await expect(guard.canActivate(makeContext(user))).rejects.toThrow('forbidden');
  });

  it('Roles 装饰器写入 ROLES_KEY 元数据', () => {
    @Roles('ops', 'admin')
    class FakeController {}
    const metadata = Reflect.getMetadata(ROLES_KEY, FakeController);
    expect(metadata).toEqual(['ops', 'admin']);
  });

  it('真实 Reflector 集成：类级装饰 → 读取到角色', async () => {
    @Roles('admin')
    class FakeController {}

    const reflector = new Reflector();
    const ctx = {
      getHandler: () => ({}) as never,
      getClass: () => FakeController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as never;

    const guard = new RolesGuard(reflector, { requireRole: vi.fn() } as never);
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});