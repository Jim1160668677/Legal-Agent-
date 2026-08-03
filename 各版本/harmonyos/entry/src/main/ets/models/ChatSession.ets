/**
 * 会话模型
 */
export interface ChatSession {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
}

export interface CreateSessionRequest {
  title?: string;
}

export interface CreateSessionResponse {
  success: boolean;
  data: ChatSession;
  error: ApiError | null;
}

export interface SessionListResponse {
  success: boolean;
  data: ChatSession[];
  total: number;
  page: number;
  pageSize: number;
  error: ApiError | null;
}

export interface DeleteSessionResponse {
  success: boolean;
  data: null;
  error: ApiError | null;
}
