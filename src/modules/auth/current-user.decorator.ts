/**
 * @CurrentUser() 装饰器（A1-W2）。
 *
 * 从 req.user（JwtAuthGuard 注入）取当前用户 payload。
 * 支持 @CurrentUser() 取整个 payload，或 @CurrentUser('sub') 取单个字段。
 *
 * 设计依据：A1 §三 common/decorators。
 */
import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { JwtPayload } from './auth.types';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | unknown => {
    const req = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
