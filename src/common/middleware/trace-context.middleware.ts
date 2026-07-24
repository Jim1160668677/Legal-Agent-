/**
 * TraceContextMiddleware —— 在请求最早期注入 RequestContext（A1-W2）。
 *
 * 职责：
 * 1. 解析 / 生成 traceId（优先取客户端 X-Trace-Id 头）
 * 2. 把 RequestContext 写入 AsyncLocalStorage，全链路可读
 * 3. 在响应头回写 X-Trace-Id，便于调用方程序化追踪
 *
 * 设计依据：A1 §6.4 Logger；02 §8.1 traceId 贯穿。
 *
 * 注：此中间件必须在所有业务中间件之前注册（main.ts 中 app.use 顺序）。
 */
import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createRequestContext, requestContext } from '../context/request-context';

@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const ctx = createRequestContext(req);
    res.setHeader('X-Trace-Id', ctx.traceId);

    // 在 ALS 上下文内执行后续链路；next 可能异步抛错，express 会走 error handler
    requestContext.run(ctx, () => next());
  }
}
