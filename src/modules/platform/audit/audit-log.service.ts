/**
 * AuditLog —— 异步非阻塞审计日志（A1-W2）。
 *
 * 职责（A1 §6.3）：
 *   - write(event, detail, ctx)：写 audit_log 集合
 *   - 用 setImmediate 异步写入，主流程增量 < 5ms
 *   - traceId/userId 从 RequestContext 自动取（调用方可覆盖）
 *
 * 事件枚举（06 §二 + 03 §4.4）：
 *   user_login / chat_send / agent_invoke / degradation / compliance_blocked /
 *   agent_pii_violation / llm_call / document_export / ...
 *
 * 设计依据：A1 §6.3；05 audit_log schema；03 §4.4 违规审计。
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, type AuditLogDocument } from '../../../infra/database/schemas/dialog.schema';
import { requestContext } from '../../../common/context/request-context';
import { AppLoggerService } from '../logger/logger.service';

/** 审计事件类型（扩展自 06 错误码体系相关业务事件） */
export type AuditEvent =
  | 'user_login'
  | 'user_logout'
  | 'chat_send'
  | 'agent_invoke'
  | 'degradation'
  | 'compliance_blocked'
  | 'agent_pii_violation'
  | 'llm_call'
  | 'document_generate'
  | 'document_export'
  | 'knowledge_update'
  | 'feature_flag_change'
  | 'admin_operation'
  // v2.3 阶段十：律师审核评估闭环审计事件（17 §9）
  | 'lawyer_review_submit'
  | 'answer_scored'
  | 'annotation_reflowed'
  // v2.4：视觉模型调用审计（图像识别多模型主备切换）
  | 'vision_call';

export interface AuditWriteOptions {
  /** 覆盖 traceId（默认从 RequestContext 取） */
  traceId?: string;
  /** 覆盖 userId（默认从 RequestContext 取） */
  userId?: string;
  /** 入口功能名 */
  func?: string;
  /** 客户端 IP */
  ip?: string;
  /** 结果：success / failure / blocked */
  result?: 'success' | 'failure' | 'blocked';
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLogDocument>,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 异步写审计日志。调用方立即返回，不阻塞主流程。
   *
   * 用 setImmediate 把 mongoose 写入推出当前事件循环；
   * 写入失败仅记 logger.error，不抛错（审计不能影响主流程）。
   */
  write(event: AuditEvent, detail: Record<string, unknown>, opts: AuditWriteOptions = {}): void {
    const ctx = requestContext.get();
    const ts = new Date();
    // TTL 180 天（schema 已声明 expires:15552000，这里显式设置 expireAt）
    const expireAt = new Date(ts.getTime() + 180 * 24 * 3600 * 1000);

    const doc = {
      ts,
      traceId: opts.traceId ?? ctx?.traceId,
      userId: opts.userId ?? ctx?.userId,
      event,
      func: opts.func ?? ctx?.func,
      ip: opts.ip,
      detail,
      result: opts.result ?? 'success',
      expireAt,
    };

    setImmediate(() => {
      this.model
        .create(doc)
        .then(() => {
          /* 写入成功，静默 */
        })
        .catch((err: unknown) => {
          // 审计写入失败仅记录日志，不影响业务
          this.logger.error('audit_log write failed', {
            event,
            traceId: doc.traceId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });
  }

  /**
   * 同步写审计日志（仅用于必须确认写入的关键事件，如合规违规）。
   * 普通事件请用 write（异步）。
   */
  async writeSync(
    event: AuditEvent,
    detail: Record<string, unknown>,
    opts: AuditWriteOptions = {},
  ): Promise<void> {
    const ctx = requestContext.get();
    const ts = new Date();
    const expireAt = new Date(ts.getTime() + 180 * 24 * 3600 * 1000);

    await this.model.create({
      ts,
      traceId: opts.traceId ?? ctx?.traceId,
      userId: opts.userId ?? ctx?.userId,
      event,
      func: opts.func ?? ctx?.func,
      ip: opts.ip,
      detail,
      result: opts.result ?? 'success',
      expireAt,
    });
  }
}
