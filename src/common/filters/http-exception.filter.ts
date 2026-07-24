/**
 * 全局异常过滤器（A1-W1）。
 *
 * 把所有异常转换为统一信封：{ code, message, traceId, data: null }。
 * 设计依据：A1 §三 common/filters + §八错误码体系。
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

interface ErrorEnvelope {
  code: number;
  message: string;
  traceId: string;
  data: null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = (req.headers['x-trace-id'] as string) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 5001;
    let message = '内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        code = typeof r.code === 'number' ? r.code : status * 10;
        message = typeof r.message === 'string' ? r.message : exception.message;
      } else {
        message = exception.message;
        code = status * 10;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const envelope: ErrorEnvelope = { code, message, traceId, data: null };

    this.logger.error(
      `[${traceId}] ${req.method} ${req.url} → ${status} code=${code} msg=${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    res.status(status).header('X-Trace-Id', traceId).json(envelope);
  }
}
