/**
 * LoggerService —— 结构化 JSON 日志（A1-W2）。
 *
 * 包装 nestjs-pino 注入的 PinoLogger，统一字段对齐 02 §8.1：
 *   ts / level / traceId / userId / func / intent / route / durationMs / llmCalled / cacheHit / msg
 *
 * traceId/userId/func 等从 RequestContext（AsyncLocalStorage）自动取，
 * 业务侧调用 logger.info('xxx') 无需显式传 traceId。
 *
 * 设计依据：A1 §6.4 Logger；性能考虑用 Pino（优于 Winston）。
 */
import type { LoggerService as NestLoggerService } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { requestContext } from '../../../common/context/request-context';

export interface LogMeta {
  userId?: string;
  func?: string;
  intent?: string;
  route?: string;
  durationMs?: number;
  llmCalled?: boolean;
  cacheHit?: boolean;
  [k: string]: unknown;
}

@Injectable()
export class AppLoggerService implements NestLoggerService {
  constructor(private readonly pino: PinoLogger) {}

  /** 把 RequestContext 字段合并到 meta，调用底层 pino logger */
  private emit(
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
    msg: string,
    meta: LogMeta,
  ): void {
    const ctx = requestContext.get();
    const merged: LogMeta = {
      traceId: ctx?.traceId,
      userId: meta.userId ?? ctx?.userId,
      func: meta.func ?? ctx?.func,
      intent: meta.intent ?? ctx?.intent,
      route: meta.route ?? ctx?.route,
      ...meta,
    };
    // PinoLogger 已暴露 fatal/error/warn/info/debug/trace，第二参为 merge context
    const fn = this.pino[level].bind(this.pino);
    fn(merged, msg);
  }

  fatal(msg: string, meta: LogMeta = {}): void {
    this.emit('fatal', msg, meta);
  }
  error(msg: string, meta: LogMeta = {}): void {
    this.emit('error', msg, meta);
  }
  warn(msg: string, meta: LogMeta = {}): void {
    this.emit('warn', msg, meta);
  }
  info(msg: string, meta: LogMeta = {}): void {
    this.emit('info', msg, meta);
  }
  debug(msg: string, meta: LogMeta = {}): void {
    this.emit('debug', msg, meta);
  }
  trace(msg: string, meta: LogMeta = {}): void {
    this.emit('trace', msg, meta);
  }

  // NestLoggerService 接口方法（Nest 内部 Logger 钩子依赖此签名）
  log(message: string, meta: LogMeta = {}): void {
    this.info(message, meta);
  }
}
