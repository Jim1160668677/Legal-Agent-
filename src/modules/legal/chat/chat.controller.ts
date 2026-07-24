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
import { Body, Controller, Post, UseGuards, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { JwtPayload } from '../../auth/auth.types';
import type { DialogContext } from '../../../types/dialog';
import type { OrchestratorService } from '../orchestrator/orchestrator.service';
import type { ChatDto } from './chat.dto';
import { CHAT_MESSAGE_MAX_LEN } from './chat.dto';
import { initSseResponse, writeSseFrame } from './sse-frames';
import { requestContext } from '../../../common/context/request-context';

@Controller('v1/chat')
export class ChatController {
  constructor(private readonly orchestrator: OrchestratorService) {}

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
      writeSseFrame(res, {
        type: 'error',
        code: 5001,
        message: err instanceof Error ? err.message : '内部错误',
      });
      writeSseFrame(res, { type: 'done', traceId });
      res.end();
    }
  }
}
