/**
 * Chat 端点 DTO（A1-W4）。
 *
 * 沿用 AuthController 约定：纯 class + 定断言，校验在控制器内手动执行
 * （项目未引入 class-validator，避免新增依赖；ValidationPipe 对无装饰器 DTO 透传）。
 *
 * 设计依据：A1 §十 ChatController；06 §二 /v1/chat 请求体。
 */

/** POST /v1/chat 请求体 */
export class ChatDto {
  /** 用户输入（必填，非空，上限 4000 字防止 prompt 滥用） */
  message!: string;
  /** 会话 ID（可选；缺省由服务端按 traceId 派生，便于多轮记忆） */
  sessionId?: string;
}

/** message 字段校验上限 */
export const CHAT_MESSAGE_MAX_LEN = 4000;
