/**
 * 全局响应拦截器（A1-W1）。
 *
 * 把成功响应包装为统一信封：{ code: 0, message: 'ok', traceId, data }。
 * 设计依据：A1 §三 common/interceptors + A5 §七统一响应格式。
 *
 * 注：SSE 流式响应（Content-Type: text/event-stream）不包装，直接放行。
 */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import type { Request, Response as ExpressResponse } from 'express';
import { randomUUID } from 'crypto';

interface SuccessEnvelope<T> {
  code: 0;
  message: 'ok';
  traceId: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const http = context.switchToHttp();
    const res = http.getResponse<ExpressResponse>();
    const req = http.getRequest<Request>();
    const traceId = (req.headers['x-trace-id'] as string) ?? randomUUID();

    // SSE 流式响应不包装
    const isSse = res.getHeader('Content-Type') === 'text/event-stream';
    if (isSse) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // SSE 流式响应已在 handler 中直接写入 res，headers 已发送，跳过包装
        if (res.headersSent) {
          return data;
        }
        // 响应头注入 traceId（便于调用方程序化追踪）
        res.header('X-Trace-Id', traceId);
        return { code: 0, message: 'ok', traceId, data } as SuccessEnvelope<T>;
      }),
    );
  }
}
