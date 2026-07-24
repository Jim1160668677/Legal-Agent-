/**
 * RequestContext —— 基于 AsyncLocalStorage 的请求上下文（A1-W2）。
 *
 * 在中间件层注入 traceId/userId/func/intent/route，全链路（Service/Repository/Logger）
 * 无需显式传参即可读取，确保审计、日志、限流拿得到 traceId。
 *
 * 设计依据：A1 §6.4 Logger（AsyncLocalStorage 传递 traceId）+ 02 §8.1 日志字段。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContextData {
  /** 请求级唯一追踪 ID（贯穿日志/审计/SSE 帧） */
  traceId: string;
  /** 已鉴权用户 ID（未登录为 undefined） */
  userId?: string;
  /** 调用方角色（user/ops/audit/admin） */
  role?: string;
  /** 入口功能名（chat/document_generate/...） */
  func?: string;
  /** 意图识别结果（IntentRouter 后填入） */
  intent?: string;
  /** 路由目标（rule/knowledge/llm/tool/reasoning/general_qa） */
  route?: string;
  /** 请求开始时间戳（ms），用于计算 durationMs */
  startedAt: number;
}

class RequestContextStore {
  private readonly als = new AsyncLocalStorage<RequestContextData>();

  /** 中间件入口：创建并进入上下文 */
  run<T>(data: RequestContextData, fn: () => T): T {
    return this.als.run(data, fn);
  }

  /** 取当前上下文（无上下文返回 undefined，不抛错） */
  get(): RequestContextData | undefined {
    return this.als.getStore();
  }

  /** 只读 traceId，无上下文时现场生成（异常路径兜底） */
  getTraceId(): string {
    return this.als.getStore()?.traceId ?? randomUUID();
  }

  /** 在已存在上下文中追加/覆盖字段（不创建新上下文） */
  amend(patch: Partial<Omit<RequestContextData, 'traceId' | 'startedAt'>>): void {
    const cur = this.als.getStore();
    if (!cur) return;
    Object.assign(cur, patch);
  }
}

export const requestContext = new RequestContextStore();

/**
 * 中间件入口的便捷工厂：从 express Request 解析 traceId（优先取 X-Trace-Id 头）。
 */
export function createRequestContext(req: {
  headers: Record<string, string | string[] | undefined>;
}): RequestContextData {
  const headerTraceId = req.headers['x-trace-id'];
  const traceId = (typeof headerTraceId === 'string' && headerTraceId) || randomUUID();
  return { traceId, startedAt: Date.now() };
}
