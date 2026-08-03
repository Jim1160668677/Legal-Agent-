/**
 * Chat 端点 DTO（A1-W4）。
 *
 * 配合全局 ValidationPipe（whitelist + forbidNonWhitelisted + transform），
 * 所有字段均带 class-validator 装饰器。
 *
 * 设计依据：A1 §十 ChatController；06 §二 /v1/chat 请求体。
 */
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

/** message 字段校验上限 */
export const CHAT_MESSAGE_MAX_LEN = 4000;

/** POST /v1/chat 请求体 */
export class ChatDto {
  /** 用户输入（必填，非空，上限 4000 字防止 prompt 滥用） */
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHAT_MESSAGE_MAX_LEN)
  message!: string;

  /** 会话 ID（可选；缺省由服务端按 traceId 派生，便于多轮记忆） */
  @IsOptional()
  @IsString()
  sessionId?: string;
}
