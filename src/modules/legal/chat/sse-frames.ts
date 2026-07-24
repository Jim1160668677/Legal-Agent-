/**
 * SSE 帧序列规范 + 免责声明（A1-W4）。
 *
 * 帧序列（A1 §十）：[chunk]* → [meta] → [disclaimer] → [done]
 *   - chunk：流式文本增量
 *   - meta：意图/路由/法条引用/usage（流式完成后发出，因 usage 需流式结束才知）
 *   - disclaimer：免责声明（法律合规强制注入，100% 附加）
 *   - done：结束帧（携带 traceId）
 *   - error：异常帧（降级或校验失败时替代 chunk 序列）
 *
 * SSE 编码：每帧 `data: <json>\n\n`，Content-Type: text/event-stream。
 * ResponseInterceptor 检测 text/event-stream 自动放行，不包装统一信封。
 *
 * 设计依据：A1 §十 SSE 帧序列；03 §四 免责声明合规要求。
 */
import type { Response } from 'express';
import type { IntentType, RouteTarget } from '../../../types/intent';
import type { LawRef } from '../../../types/llm';

/** SSE Content-Type（ResponseInterceptor 据此放行） */
export const SSE_CONTENT_TYPE = 'text/event-stream';

/** 强制免责声明（03 §四，每条响应尾部 100% 附加） */
export const DISCLAIMER_TEXT =
  '本回复由 AI 法律智能助手生成，仅供法律信息参考，不构成法律意见或律师建议。' +
  '具体法律问题请咨询执业律师或当地法律援助机构。';

/** 帧载荷联合类型 */
export type ChatFrame =
  | { type: 'chunk'; delta: string }
  | {
      type: 'meta';
      intent: IntentType;
      route: RouteTarget;
      source: 'rule' | 'faq' | 'llm' | 'tool' | 'guide';
      lawRefs: LawRef[];
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      fallbackUsed?: boolean;
    }
  | { type: 'disclaimer'; text: string }
  | { type: 'done'; traceId: string }
  | { type: 'error'; code: number; message: string };

/**
 * 写一帧 SSE 到 Express Response。
 * 每帧 `data: <json>\n\n`，立即 flush。
 */
export function writeSseFrame(res: Response, frame: ChatFrame): void {
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
}

/**
 * 初始化 SSE 响应头（必须在写第一帧前调用）。
 * 设置 Content-Type / Cache-Control / Connection，禁用 nginx buffering。
 */
export function initSseResponse(res: Response): void {
  res.setHeader('Content-Type', SSE_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

/** 便捷：写结束序列 meta → disclaimer → done */
export function writeSseClosing(
  res: Response,
  meta: Extract<ChatFrame, { type: 'meta' }>,
  traceId: string,
): void {
  writeSseFrame(res, meta);
  writeSseFrame(res, { type: 'disclaimer', text: DISCLAIMER_TEXT });
  writeSseFrame(res, { type: 'done', traceId });
  res.end();
}
