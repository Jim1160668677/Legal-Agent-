/**
 * HarmonyOS SDK - HTTP client for Legal Agent API
 */
import http from '@ohos.net.http';
import {
  API_BASE_URL,
  TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  USER_INFO_STORAGE_KEY,
  LOGIN_TIMEOUT,
  MESSAGE_TIMEOUT,
  TOKEN_REFRESH_OFFSET
} from '../utils/Constants';
import { User, LoginResult } from '../models/User';
import { ChatMessage, ChatMessageRequest, ChatMessageResponse, ApiError } from '../models/ChatMessage';
import { ChatSession, SessionListResponse, CreateSessionResponse, DeleteSessionResponse } from '../models/ChatSession';
import { KnowledgeItem, KnowledgeRetrieveRequest, KnowledgeRetrieveResponse, KnowledgeType } from '../models/KnowledgeResult';
import { AnalysisRequest, AnalysisResult } from '../models/AnalysisResult';

export interface ApiConfig {
  baseUrl: string;
  timeout?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: ApiError | null;
  meta: ResponseMeta;
}

export interface ResponseMeta {
  traceId: string;
  timestamp: string;
  requestId?: string;
}

/** SSE事件类型 */
export type SSEEvent = 'message' | 'done' | 'error' | 'law_ref';

export interface SSEMessage {
  event: SSEEvent;
  data: string;
}

/**
 * 法律智能体SDK
 */
export class LegalAgentSDK {
  private baseUrl: string;
  private token: string | null = null;
  private refreshToken: string | null = null;
  private userInfo: User | null = null;
  private tokenExpiry: number = 0;
  private httpClient: http.HttpRequest;

  constructor(config?: ApiConfig) {
    this.baseUrl = config?.baseUrl ?? API_BASE_URL;
    this.httpClient = http.createHttpRequest();
    this.initAuth();
  }

  /** 初始化认证状态 */
  private async initAuth(): Promise<void> {
    try {
      this.token = await this.getStorageValue(TOKEN_STORAGE_KEY);
      this.refreshToken = await this.getStorageValue(REFRESH_TOKEN_STORAGE_KEY);
      const userInfoStr = await this.getStorageValue(USER_INFO_STORAGE_KEY);
      if (userInfoStr) {
        this.userInfo = JSON.parse(userInfoStr) as User;
      }
    } catch (error) {
      console.error('初始化认证状态失败:', error);
    }
  }

  /** 从本地存储读取值 */
  private async getStorageValue(key: string): Promise<string | null> {
    try {
      const prefs = await import('@ohos.preference').then(m => m.preference);
      const store = await prefs.getPreferences(key);
      const value = await store.get(key, '') as string;
      return value || null;
    } catch (error) {
      // 降级到globalStorage
      try {
        const storage = await import('@ohos.storage').then(m => m.default);
        return await storage.get(key, '') as string || null;
      } catch (_e) {
        return null;
      }
    }
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  getUserInfo(): User | null {
    return this.userInfo;
  }

  isLoggedIn(): boolean {
    return this.token !== null && this.token.length > 0;
  }

  /**
   * 用户登录
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const req = http.createHttpRequest();
    const response = await req.request(`${this.baseUrl}/v1/auth/login`, {
      method: http.Method.POST,
      header: {
        'Content-Type': 'application/json',
      },
      extraData: JSON.stringify({ username, password }),
      connectTimeout: LOGIN_TIMEOUT,
      readTimeout: LOGIN_TIMEOUT,
    } as http.RequestOptions);

    if (response.statusCode === 200) {
      const data = JSON.parse(response.data as string) as ApiResponse<LoginResult>;
      if (data.success) {
        this.token = data.data.accessToken;
        this.refreshToken = data.data.refreshToken;
        this.userInfo = data.data.user;
        this.tokenExpiry = Date.now() + data.data.expiresIn * 1000;
        await this.saveStorageValue(TOKEN_STORAGE_KEY, data.data.accessToken);
        await this.saveStorageValue(REFRESH_TOKEN_STORAGE_KEY, data.data.refreshToken);
        await this.saveStorageValue(USER_INFO_STORAGE_KEY, JSON.stringify(data.data.user));
        return data.data;
      }
    }
    throw new Error(`登录失败: ${response.statusCode}`);
  }

  /**
   * 刷新Token
   */
  async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('没有可用的refreshToken');
    }
    const req = http.createHttpRequest();
    const response = await req.request(`${this.baseUrl}/v1/auth/refresh`, {
      method: http.Method.POST,
      header: {
        'Content-Type': 'application/json',
      },
      extraData: JSON.stringify({ refreshToken: this.refreshToken }),
      connectTimeout: LOGIN_TIMEOUT,
      readTimeout: LOGIN_TIMEOUT,
    } as http.RequestOptions);

    if (response.statusCode === 200) {
      const data = JSON.parse(response.data as string) as ApiResponse<LoginResult>;
      if (data.success) {
        this.token = data.data.accessToken;
        if (data.data.refreshToken) {
          this.refreshToken = data.data.refreshToken;
        }
        this.tokenExpiry = Date.now() + data.data.expiresIn * 1000;
        await this.saveStorageValue(TOKEN_STORAGE_KEY, data.data.accessToken);
        await this.saveStorageValue(REFRESH_TOKEN_STORAGE_KEY, data.data.refreshToken ?? '');
        return data.data.accessToken;
      }
    }
    throw new Error('Token刷新失败');
  }

  /**
   * 用户登出
   */
  async logout(): Promise<void> {
    if (this.token) {
      try {
        const req = http.createHttpRequest();
        await req.request(`${this.baseUrl}/v1/auth/logout`, {
          method: http.Method.POST,
          header: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          extraData: '{}',
          connectTimeout: LOGIN_TIMEOUT,
          readTimeout: LOGIN_TIMEOUT,
        } as http.RequestOptions);
      } catch (error) {
        console.error('登出API调用失败:', error);
      }
    }
    this.token = null;
    this.refreshToken = null;
    this.userInfo = null;
    this.tokenExpiry = 0;
    await this.clearStorageValue(TOKEN_STORAGE_KEY);
    await this.clearStorageValue(REFRESH_TOKEN_STORAGE_KEY);
    await this.clearStorageValue(USER_INFO_STORAGE_KEY);
  }

  /**
   * 创建新会话
   */
  async createSession(title?: string): Promise<ChatSession> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    const response = await req.request(`${this.baseUrl}/v1/chat/sessions`, {
      method: http.Method.POST,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      extraData: JSON.stringify({ title }),
      connectTimeout: MESSAGE_TIMEOUT,
      readTimeout: MESSAGE_TIMEOUT,
    } as http.RequestOptions);

    if (response.statusCode === 200 || response.statusCode === 201) {
      const data = JSON.parse(response.data as string) as ApiResponse<ChatSession>;
      if (data.success) {
        return data.data;
      }
    }
    throw new Error('创建会话失败');
  }

  /**
   * 获取会话列表
   */
  async getSessionList(page: number = 1, pageSize: number = 20): Promise<SessionListResponse> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    const response = await req.request(
      `${this.baseUrl}/v1/chat/sessions?page=${page}&pageSize=${pageSize}`,
      {
        method: http.Method.GET,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        connectTimeout: MESSAGE_TIMEOUT,
        readTimeout: MESSAGE_TIMEOUT,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      const data = JSON.parse(response.data as string) as ApiResponse<ChatSession[]>;
      return {
        success: data.success,
        data: data.data ?? [],
        total: data.data?.length ?? 0,
        page,
        pageSize,
        error: data.error,
      };
    }
    throw new Error('获取会话列表失败');
  }

  /**
   * 获取会话消息列表
   */
  async getSessionMessages(sessionId: string, page: number = 1, pageSize: number = 20): Promise<ApiResponse<ChatMessage[]>> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    const response = await req.request(
      `${this.baseUrl}/v1/chat/sessions/${sessionId}/messages?page=${page}&pageSize=${pageSize}`,
      {
        method: http.Method.GET,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        connectTimeout: MESSAGE_TIMEOUT,
        readTimeout: MESSAGE_TIMEOUT,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      return JSON.parse(response.data as string) as ApiResponse<ChatMessage[]>;
    }
    throw new Error('获取消息列表失败');
  }

  /**
   * 发送消息（非流式）
   */
  async sendMessage(sessionId: string, content: string): Promise<ChatMessageResponse> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    const response = await req.request(
      `${this.baseUrl}/v1/chat/sessions/${sessionId}/messages`,
      {
        method: http.Method.POST,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        extraData: JSON.stringify({ content, messageType: 'text' }),
        connectTimeout: MESSAGE_TIMEOUT,
        readTimeout: MESSAGE_TIMEOUT,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      return JSON.parse(response.data as string) as ChatMessageResponse;
    }
    throw new Error(`发送消息失败: ${response.statusCode}`);
  }

  /**
   * 发送消息（流式SSE响应）
   */
  async sendMessageStream(
    sessionId: string,
    content: string,
    onEvent: (event: SSEMessage) => void
  ): Promise<void> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    
    // 使用get方法配合流式响应
    const response = await req.request(
      `${this.baseUrl}/v1/chat/sessions/${sessionId}/messages`,
      {
        method: http.Method.POST,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'text/event-stream',
        },
        extraData: JSON.stringify({ content, messageType: 'text', stream: true }),
        connectTimeout: MESSAGE_TIMEOUT,
        readTimeout: MESSAGE_TIMEOUT * 3,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      const rawData = response.data as string;
      const lines = rawData.split('\n');
      let currentEvent = 'message';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          currentData = line.substring(5).trim();
          if (currentData) {
            onEvent({ event: currentEvent as SSEEvent, data: currentData });
          }
        } else if (line === '' && currentData) {
          // 空行表示一个完整事件结束
          onEvent({ event: currentEvent as SSEEvent, data: currentData });
          currentData = '';
        }
      }
    } else {
      throw new Error(`流式消息发送失败: ${response.statusCode}`);
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    const response = await req.request(
      `${this.baseUrl}/v1/chat/sessions/${sessionId}`,
      {
        method: http.Method.DELETE,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        connectTimeout: MESSAGE_TIMEOUT,
        readTimeout: MESSAGE_TIMEOUT,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      return JSON.parse(response.data as string) as DeleteSessionResponse;
    }
    throw new Error('删除会话失败');
  }

  /**
   * 知识检索
   */
  async retrieveKnowledge(
    query: string,
    topK: number = 10,
    category?: KnowledgeType
  ): Promise<KnowledgeRetrieveResponse> {
    await this.ensureTokenValid();
    const params = new URLSearchParams({ query, topK: topK.toString() });
    if (category) {
      params.append('category', category);
    }
    
    const req = http.createHttpRequest();
    const response = await req.request(
      `${this.baseUrl}/v1/knowledge/retrieve?${params.toString()}`,
      {
        method: http.Method.POST,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        extraData: '{}',
        connectTimeout: MESSAGE_TIMEOUT,
        readTimeout: MESSAGE_TIMEOUT,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      const data = JSON.parse(response.data as string) as ApiResponse<KnowledgeItem[]>;
      return {
        success: data.success,
        data: data.data ?? [],
        total: data.data?.length ?? 0,
        query,
        searchTime: Date.now(),
        error: data.error,
      };
    }
    throw new Error('知识检索失败');
  }

  /**
   * 案件分析
   */
  async analyzeCase(request: AnalysisRequest): Promise<AnalysisResult> {
    await this.ensureTokenValid();
    const req = http.createHttpRequest();
    const response = await req.request(
      `${this.baseUrl}/v1/cases/analyze`,
      {
        method: http.Method.POST,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        extraData: JSON.stringify(request),
        connectTimeout: MESSAGE_TIMEOUT * 3,
        readTimeout: MESSAGE_TIMEOUT * 3,
      } as http.RequestOptions
    );

    if (response.statusCode === 200) {
      const data = JSON.parse(response.data as string) as ApiResponse<AnalysisResult>;
      if (data.success) {
        return data.data;
      }
    }
    throw new Error('案件分析失败');
  }

  /**
   * 确保Token有效，必要时自动刷新
   */
  private async ensureTokenValid(): Promise<void> {
    if (!this.token) {
      throw new Error('未登录');
    }
    // 如果Token即将过期（提前5分钟），自动刷新
    if (this.tokenExpiry > 0 && this.tokenExpiry - Date.now() < TOKEN_REFRESH_OFFSET) {
      try {
        await this.refreshAccessToken();
      } catch (error) {
        // Token刷新失败，清除认证状态
        await this.logout();
        throw new Error('登录已过期，请重新登录');
      }
    }
  }

  private async saveStorageValue(key: string, value: string): Promise<void> {
    try {
      const prefs = await import('@ohos.preference').then(m => m.preference);
      const store = await prefs.getPreferences(key);
      await store.put(key, value);
      await store.flush();
    } catch (error) {
      try {
        const storage = await import('@ohos.storage').then(m => m.default);
        await storage.set(key, value);
      } catch (_e) {
        console.error('保存存储值失败:', error);
      }
    }
  }

  private async clearStorageValue(key: string): Promise<void> {
    try {
      const prefs = await import('@ohos.preference').then(m => m.preference);
      const store = await prefs.getPreferences(key);
      await store.delete(key);
      await store.flush();
    } catch (error) {
      try {
        const storage = await import('@ohos.storage').then(m => m.default);
        await storage.remove(key);
      } catch (_e) {
        console.error('清除存储值失败:', error);
      }
    }
  }
}
