/**
 * ChatController —— 对话主入口（A1-W4）。
 *
 * 端点：
 *   POST /v1/chat  (SSE 流式，需 JWT 鉴权)
 *
 * 职责：
 *   1. 校验入参（message 非空、长度上限）
 *   2. 构建 DialogContext
 *   3. 委托 OrchestratorService 编排，逐帧写入 SSE Response
 *   4. 全程 traceId 贯穿（RequestContext 由 TraceContextMiddleware 注入）
 *
 * SSE 帧序列（A1 §十）：[chunk]* → [meta] → [disclaimer] → [done]
 * ResponseInterceptor 检测 text/event-stream 自动放行（不包装统一信封）。
 *
 * 设计依据：A1 §十；06 §二 /v1/chat；07 §1.4 降级链。
 */
import {
  Body,
  Controller,
  Post,
  UseGuards,
  Res,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { JwtPayload } from '../../auth/auth.types';
import type { DialogContext } from '../../../types/dialog';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import type { ChatDto } from './chat.dto';
import { CHAT_MESSAGE_MAX_LEN } from './chat.dto';
import { initSseResponse, writeSseFrame } from './sse-frames';
import { requestContext } from '../../../common/context/request-context';
import { AppLoggerService } from '../../platform/logger/logger.service';

/**
 * Phase 2.5：SSE 长连接端点排除全局限流。
 *
 * 全局 ThrottlerGuard 默认按 IP 计数（60s 内 100 次），
 * 但 /v1/chat 是 SSE 长连接：单客户端正常会话即可在 1 分钟内多次调用，
 * 触发 429 会中断流式回答。这里类级 @SkipThrottle() 豁免本控制器所有路由。
 *
 * 单用户会话级限流由 rateLimit 配置（perUserChatPerMin）在编排层守卫，
 * 不依赖 Throttler 的 IP 级计数。
 */
@SkipThrottle()
@Controller('v1/chat')
export class ChatController {
  /** 单用户 chat 每分钟限流器（perUserChatPerMin 次/分钟） */
  private readonly chatRateLimiter: RateLimiterMemory;

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly logger: AppLoggerService,
    config: ConfigService,
  ) {
    const points = config.get<number>('app.rateLimit.perUserChatPerMin') ?? 20;
    this.chatRateLimiter = new RateLimiterMemory({ points, duration: 60 });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async chat(
    @Body() dto: ChatDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    // ===== 入参校验（手动，项目未引入 class-validator） =====
    if (dto == null || typeof dto.message !== 'string' || dto.message.trim() === '') {
      throw new BadRequestException({ code: 1001, message: 'message 不能为空' });
    }
    if (dto.message.length > CHAT_MESSAGE_MAX_LEN) {
      throw new BadRequestException({
        code: 1002,
        message: `message 长度超过上限 ${CHAT_MESSAGE_MAX_LEN}`,
      });
    }

    const userId = user.sub;

    // ===== 单用户限流（在 SSE 头发送前执行，超限返回 HTTP 429 而非 SSE 帧） =====
    try {
      await this.chatRateLimiter.consume(userId, 1);
    } catch {
      throw new HttpException(
        { code: 4291, message: '请求过于频繁，请稍后再试' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const traceId = requestContext.getTraceId();
    const sessionId = dto.sessionId ?? traceId;

    // 构建会话上下文（recentTurns 置空，多轮记忆由 Orchestrator 经 getRelevantMemories 注入 LLM prompt；
    // contextBonus 多轮延续 A1-W4 暂不启用，避免意图识别前额外 DB 往返）
    const ctx: DialogContext = {
      sessionId,
      userId,
      unresolvedCount: 0,
      recentTurns: [],
    };

    // ===== 初始化 SSE =====
    initSseResponse(res);

    try {
      // ===== 编排 + 逐帧写入 =====
      for await (const frame of this.orchestrator.orchestrate(dto.message, ctx, userId)) {
        writeSseFrame(res, frame);
      }
      res.end();
    } catch (err) {
      // 编排过程异常（非 LLM 降级，属未预期错误）→ error 帧
      // 不外泄 err.message（可能含内部细节），原始错误落服务端日志
      this.logger.error('chat orchestrate failed', {
        traceId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      writeSseFrame(res, {
        type: 'error',
        code: 5001,
        message: '内部错误',
      });
      writeSseFrame(res, { type: 'done', traceId });
      res.end();
    }
  }
}
