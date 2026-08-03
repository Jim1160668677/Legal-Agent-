/**
 * 聊天消息模型
 */
export interface LawReference {
  id: string;
  title: string;
  article: string;
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sessionId: string;
  lawRefs?: LawReference[];
  images?: string[];
  /** 流式响应时标识是否为部分消息 */
  isStreamChunk?: boolean;
  /** 消息状态：sending/sent/failed */
  status?: 'sending' | 'sent' | 'failed';
}

export interface ChatMessageRequest {
  sessionId?: string;
  content: string;
  messageType?: 'text' | 'image' | 'mixed';
  images?: string[];
  stream?: boolean;
}

export interface ChatMessageResponse {
  success: boolean;
  data: ChatMessage;
  error: ApiError | null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
}
