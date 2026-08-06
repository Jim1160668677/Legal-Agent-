/**
 * 法律智能体多平台统一SDK - 核心客户端
 * 基于后端实际API响应格式：{ code: 0, message: 'ok', traceId, data }
 *
 * API端点对齐后端：
 *   POST /v1/chat          SSE流式对话
 *   POST /v1/auth/login    外部身份登录
 *   POST /v1/auth/refresh  刷新token
 *   GET  /v1/agents        列出Agent
 *   GET  /v1/knowledge     知识库查询
 *   POST /v1/documents     文书生成
 *   GET  /v1/jobs/:jobId   任务状态查询
 *   POST /v1/vision/recognize  视觉识别
 */

import type {
  ApiErrorResponse,
  AuthResult,
  ChatDto,
  ChatFrame,
  DocumentGenerateDto,
  DocumentGenerateResult,
  DocumentRecord,
  DocumentTemplate,
  ExternalProvider,
  JobStatusResult,
  KnowledgeListResult,
  LegalAgentConfig,
  ProviderStatus,
  VisionRecognizeDto,
  VisionRecognizeResult,
} from './types.js';

/** 统一HTTP请求结果 */
type RequestResult<T> =
  | { ok: true; data: T; traceId: string }
  | { ok: false; error: ApiErrorResponse };

/** 解析统一响应 */
function parseResponse<T>(res: unknown): RequestResult<T> {
  if (!res || typeof res !== 'object') {
    return { ok: false, error: { code: 5001, message: '无效响应', traceId: '', data: null } };
  }
  const r = res as Record<string, unknown>;
  if ('code' in r && r.code === 0) {
    return { ok: true, data: r.data as T, traceId: (r.traceId as string) ?? '' };
  }
  return { ok: false, error: res as ApiErrorResponse };
}

/**
 * 法律智能体客户端
 *
 * @example
 * ```typescript
 * const client = new LegalAgentClient({ baseUrl: 'https://api.example.com' });
 *
 * // 登录
 * const auth = await client.login('phone', '13800138000');
 *
 * // 对话
 * const frames = client.chat('帮我写一份劳动合同');
 * for await (const frame of frames) {
 *   if (frame.type === 'chunk') console.log(frame.delta);
 * }
 * ```
 */
export class LegalAgentClient {
  private readonly config: Required<LegalAgentConfig>;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(config: LegalAgentConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      timeout: config.timeout ?? 30000,
      appVersion: config.appVersion ?? '1.0.0',
      clientType: config.clientType ?? 'web',
    };
  }

  // ==================== 认证 ====================

  /**
   * 外部身份登录
   * @param provider 身份提供方：phone / wechat / email
   * @param externalId 手机号 / openid / 邮箱
   * @param role 可选角色（管理员可指定）
   */
  async login(
    provider: ExternalProvider,
    externalId: string,
    role?: string,
  ): Promise<RequestResult<AuthResult>> {
    const res = await this.request('/auth/login', {
      method: 'POST',
      body: { provider, externalId, role },
      needAuth: false,
    });
    return parseResponse<AuthResult>(res);
  }

  /** 刷新访问令牌 */
  async refreshAuthToken(): Promise<RequestResult<AuthResult>> {
    if (!this.refreshToken) {
      return {
        ok: false,
        error: { code: 4011, message: '无refreshToken', traceId: '', data: null },
      };
    }
    const res = await this.request('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: this.refreshToken },
      needAuth: false,
    });
    return parseResponse<AuthResult>(res);
  }

  /** 登出 */
  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST', body: {} });
    } finally {
      this.clearTokens();
    }
  }

  /** 设置token */
  setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  /** 清除token */
  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  /** 是否已登录 */
  isLoggedIn(): boolean {
    return !!this.accessToken;
  }

  /** 获取当前token */
  getToken(): string | null {
    return this.accessToken;
  }

  // ==================== 聊天（SSE流式）====================

  /**
   * 发送消息并获取SSE流式响应
   *
   * 帧序列：[chunk]* → [meta] → [disclaimer] → [done]
   */
  async *chat(dto: ChatDto): AsyncGenerator<ChatFrame, void, unknown> {
    const body: Record<string, unknown> = { message: dto.message };
    if (dto.sessionId) body.sessionId = dto.sessionId;

    const res = await this.fetchSse('/chat', {
      method: 'POST',
      body,
    });

    yield* this.parseSseFrames(res);
  }

  /**
   * 以数组形式获取完整SSE响应（便于非流式场景）
   */
  async chatFrames(dto: ChatDto): Promise<ChatFrame[]> {
    const frames: ChatFrame[] = [];
    for await (const frame of this.chat(dto)) {
      frames.push(frame);
    }
    return frames;
  }

  // ==================== Agent查询 ====================

  /** 列出对外可见的Agent */
  async listAgents(): Promise<RequestResult<{ agents: import('./types').AgentCard[] }>> {
    const res = await this.request('/agents', { method: 'GET' });
    return parseResponse(res);
  }

  // ==================== 知识库 ====================

  /** 知识库列表 */
  async listKnowledge(opts?: {
    type?: string;
    category?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<RequestResult<KnowledgeListResult>> {
    const params = new URLSearchParams();
    if (opts?.type) params.set('type', opts.type);
    if (opts?.category) params.set('category', opts.category);
    if (opts?.keyword) params.set('keyword', opts.keyword);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));

    const res = await this.request(`/knowledge?${params.toString()}`, { method: 'GET' });
    return parseResponse<KnowledgeListResult>(res);
  }

  /** 知识库分类聚合 */
  async listKnowledgeCategories(): Promise<RequestResult<import('./types').KnowledgeCategoryInfo[]>> {
    const res = await this.request('/knowledge/categories', { method: 'GET' });
    return parseResponse(res);
  }

  // ==================== 文书生成 ====================

  /** 列出可用文书模板 */
  async listDocumentTemplates(): Promise<RequestResult<DocumentTemplate[]>> {
    const res = await this.request('/documents/templates', { method: 'GET' });
    return parseResponse(res);
  }

  /** 同步生成文书 */
  async generateDocument(
    dto: DocumentGenerateDto,
  ): Promise<RequestResult<DocumentGenerateResult>> {
    const res = await this.request('/documents', { method: 'POST', body: dto });
    return parseResponse<DocumentGenerateResult>(res);
  }

  /** 异步生成文书（返回jobId） */
  async generateDocumentAsync(
    dto: DocumentGenerateDto,
  ): Promise<RequestResult<{ jobId: string; status: 'pending' }>> {
    const res = await this.request('/documents/async', { method: 'POST', body: dto });
    return parseResponse(res);
  }

  /** 查询文书详情 */
  async getDocument(docId: string): Promise<RequestResult<DocumentRecord>> {
    const res = await this.request(`/documents/${docId}`, { method: 'GET' });
    return parseResponse<DocumentRecord>(res);
  }

  /** 列出当前用户文书 */
  async listMyDocuments(opts?: { page?: number; pageSize?: number }): Promise<
    RequestResult<{
      items: DocumentRecord[];
      total: number;
      page: number;
      pageSize: number;
    }>
  > {
    const params = new URLSearchParams();
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
    const res = await this.request(`/documents?${params.toString()}`, { method: 'GET' });
    return parseResponse(res);
  }

  /** 导出文书 */
  async exportDocument(
    docId: string,
    format: 'docx' | 'pdf' = 'docx',
    filename?: string,
  ): Promise<RequestResult<import('./types').ExportResult>> {
    const res = await this.request(`/documents/${docId}/export`, {
      method: 'POST',
      body: { format, filename },
    });
    return parseResponse(res);
  }

  /** 获取文书下载URL */
  async getDocumentDownloadUrl(
    docId: string,
    expiresInSec = 3600,
  ): Promise<RequestResult<{ fileId: string; downloadUrl: string; expires: number }>> {
    const res = await this.request(
      `/documents/${docId}/download?expiresInSec=${expiresInSec}`,
      { method: 'GET' },
    );
    return parseResponse(res);
  }

  // ==================== 任务查询 ====================

  /** 查询异步任务状态 */
  async getJobStatus(jobId: string): Promise<RequestResult<JobStatusResult>> {
    const res = await this.request(`/jobs/${jobId}`, { method: 'GET' });
    return parseResponse<JobStatusResult>(res);
  }

  // ==================== 视觉识别 ====================

  /** 图像识别 */
  async recognizeImage(
    dto: VisionRecognizeDto,
  ): Promise<RequestResult<VisionRecognizeResult>> {
    const res = await this.request('/vision/recognize', { method: 'POST', body: dto });
    return parseResponse<VisionRecognizeResult>(res);
  }

  /** 视觉模型健康状态 */
  async getVisionHealth(): Promise<RequestResult<{ providers: ProviderStatus[] }>> {
    const res = await this.request('/vision/health', { method: 'GET' });
    return parseResponse(res);
  }

  // ==================== 内部方法 ====================

  /** 通用HTTP请求 */
  private async request(
    path: string,
    opts: { method: string; body?: unknown; needAuth?: boolean },
  ): Promise<unknown> {
    const { method, body, needAuth = true } = opts;
    const url = `${this.config.baseUrl}/v1${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Type': this.config.clientType,
      'X-Client-Version': this.config.appVersion,
    };

    if (needAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeout),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      throw new ApiError(5001, message);
    }

    // Token过期，尝试自动刷新
    if (response.status === 401 && needAuth) {
      const refreshed = await this.tryRefreshToken();
      if (!refreshed) {
        throw new ApiError(4011, 'Token expired, please login again');
      }
      // 重试原请求
      return this.request(path, opts);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(response.status, text || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /** SSE流式请求 */
  private async fetchSse(
    path: string,
    opts: { method: string; body: Record<string, unknown> },
  ): Promise<ReadableStream<Uint8Array>> {
    const { method, body } = opts;
    const url = `${this.config.baseUrl}/v1${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Client-Type': this.config.clientType,
      'X-Client-Version': this.config.appVersion,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout * 3), // SSE给3倍超时
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(response.status, text || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new ApiError(5001, 'Response body is null');
    }

    return response.body;
  }

  /** 解析SSE帧 */
  private async *parseSseFrames(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<ChatFrame> {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            currentData = line.slice(5).trim();
          } else if (line === '' && currentData) {
            // 完整帧
            try {
              const frame = JSON.parse(currentData) as ChatFrame;
              yield frame;
            } catch {
              // 非JSON帧，忽略
            }
            currentData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** 尝试刷新token */
  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken) return false;
    const res = await this.request('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: this.refreshToken },
      needAuth: false,
    });
    const parsed = parseResponse<AuthResult>(res);
    if (parsed.ok) {
      this.accessToken = parsed.data.accessToken;
      this.refreshToken = parsed.data.refreshToken;
      return true;
    }
    return false;
  }
}

/** API错误类 */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 默认导出 */
export default LegalAgentClient;
