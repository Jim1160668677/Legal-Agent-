/**
 * JwtAuthGuard —— JWT 鉴权守卫（A1-W2）。
 *
 * 默认策略 'jwt'（见 jwt.strategy.ts）。校验失败由 HttpExceptionFilter 转 4011。
 *
 * 用法：
 *   @UseGuards(JwtAuthGuard)
 *   @Controller('v1/chat')
 *   class ChatController { ... }
 *
 * 配合 @CurrentUser() 装饰器获取当前用户。
 *
 * 设计依据：A1 §6.1；03 §六。
 */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
