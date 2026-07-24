/**
 * @Roles() 装饰器 + RolesGuard（A1-W2）。
 *
 * 用法：
 *   @Roles('ops','admin')
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *
 * RolesGuard 读取 @Roles() 元数据，调 AuthService.requireRole 校验。
 *
 * 设计依据：A1 §6.1 requireRole；03 §六 RBAC。
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthService } from './auth.service';
import type { JwtPayload, UserRole } from './auth.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator | ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = req.user;
    if (!user) return false; // 未登录直接拒绝（应已被 JwtAuthGuard 拦截）

    // 取最低要求角色校验（requireRole 内部按 rank 比较）
    const minRequired = required[0] as UserRole;
    await this.auth.requireRole(user, minRequired);
    return true;
  }
}
