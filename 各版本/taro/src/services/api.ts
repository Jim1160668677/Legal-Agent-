/**
 * API服务层 - 使用fetch（H5环境）
 * 类型定义内联，避免依赖未构建的SDK包
 */

interface UserProfile {
  name?: string
  avatar?: string
  phone?: string
  email?: string
}

interface User {
  id: string
  username: string
  role: 'user' | 'lawyer' | 'admin'
  profile?: UserProfile
}

interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type: 'text' | 'image' | 'document' | 'law'
  metadata?: Record<string, any>
  createdAt: string
}

interface ChatSession {
  id: string
  intent?: string
  title?: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

interface KnowledgeResult {
  id: string
  title: string
  content: string
  source: 'law' | 'regulation' | 'case' | 'article'
  relevance: number
  citation: string
}

interface LegalRule {
  law: string
  article: string
  content: string
}

interface AnalysisPoint {
  fact: string
  rule: string
  reasoning: string
}

interface RiskFactor {
  name: string
  score: number
  description: string
}

interface Recommendation {
  type: 'action' | 'warning' | 'suggestion'
  content: string
  priority: 'high' | 'medium' | 'low'
}

interface IRACAnalysis {
  issue: string[]
  rule: LegalRule[]
  analysis: AnalysisPoint[]
  conclusion: string
}

interface RiskAssessment {
  level: 'high' | 'medium' | 'low'
  factors: RiskFactor[]
  suggestions: string[]
}

interface AnalysisResult {
  analysisId: string
  caseType: string
  irac: IRACAnalysis
  riskAssessment: RiskAssessment
  recommendations: Recommendation[]
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error: { code: string; message: string; details?: any } | null
  meta: { traceId: string; timestamp: string }
}

interface PaginatedResponse<T> {
  data: {
    items: T[]
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
  }
}

const DEFAULT_BASE_URL = 'https://api.legal-agent.com'

class ApiService {
  private token: string | null = null
  private refreshToken: string | null = null
  private user: User | null = null

  getAuthHeader(): Record<string, string> {
    const header: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) {
      header['Authorization'] = `Bearer ${this.token}`
    }
    header['X-Client-Type'] = 'h5'
    header['X-Client-Version'] = '1.0.0'
    return header
  }

  setToken(token: string, refreshToken?: string): void {
    this.token = token
    if (refreshToken) {
      this.refreshToken = refreshToken
      localStorage.setItem('refreshToken', refreshToken)
    }
    localStorage.setItem('token', token)
  }

  clearToken(): void {
    this.token = null
    this.refreshToken = null
    this.user = null
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
  }

  isAuthenticated(): boolean {
    return !!this.token
  }

  getUser(): User | null {
    return this.user
  }

  checkLoginStatus(): void {
    const token = localStorage.getItem('token')
    const refreshToken = localStorage.getItem('refreshToken')
    if (token) {
      this.token = token
      this.refreshToken = refreshToken || null
    }
  }

  private async request<T>(options: {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: any
  }): Promise<T> {
    const res = await fetch(`${DEFAULT_BASE_URL}${options.url}`, {
      method: options.method || 'GET',
      headers: this.getAuthHeader(),
      body: options.data ? JSON.stringify(options.data) : undefined,
    })
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status}`)
    }
    const apiRes = (await res.json()) as ApiResponse<T>
    if (!apiRes.success) {
      throw new Error(apiRes.error?.message || '请求失败')
    }
    return apiRes.data
  }

  async login(username: string, password: string): Promise<{ user: User; token: string; refreshToken: string }> {
    const res = await fetch(`${DEFAULT_BASE_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) throw new Error('登录失败')
    const apiRes = (await res.json()) as ApiResponse<{ user: User; accessToken: string; refreshToken: string }>
    if (!apiRes.success) throw new Error(apiRes.error?.message || '登录失败')
    const { accessToken, refreshToken, user } = apiRes.data
    this.setToken(accessToken, refreshToken)
    this.user = user
    return { user, token: accessToken, refreshToken }
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${DEFAULT_BASE_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: this.getAuthHeader(),
      })
    } finally {
      this.clearToken()
    }
  }

  async refreshAuthToken(): Promise<string> {
    if (!this.refreshToken) throw new Error('无刷新token')
    const res = await fetch(`${DEFAULT_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    })
    if (!res.ok) throw new Error('Token刷新失败')
    const apiRes = (await res.json()) as ApiResponse<{ accessToken: string; refreshToken: string }>
    const { accessToken, refreshToken: newRefreshToken } = apiRes.data
    this.setToken(accessToken, newRefreshToken)
    return accessToken
  }

  async createSession(intent?: string): Promise<ChatSession> {
    return this.request<ChatSession>({ url: '/v1/chat/sessions', method: 'POST', data: { intent } })
  }

  async sendMessage(sessionId: string, content: string, type: 'text' | 'image' | 'document' = 'text'): Promise<ChatMessage> {
    return this.request<ChatMessage>({
      url: `/v1/chat/sessions/${sessionId}/messages`,
      method: 'POST',
      data: { content, messageType: type },
    })
  }

  async getMessages(sessionId: string, page = 1, pageSize = 20): Promise<PaginatedResponse<ChatMessage>> {
    return this.request<PaginatedResponse<ChatMessage>>({
      url: `/v1/chat/sessions/${sessionId}/messages`,
      method: 'GET',
      data: { page, pageSize },
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await fetch(`${DEFAULT_BASE_URL}/v1/chat/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader(),
    })
  }

  async listSessions(page = 1, pageSize = 20): Promise<PaginatedResponse<ChatSession>> {
    return this.request<PaginatedResponse<ChatSession>>({
      url: '/v1/chat/sessions',
      method: 'GET',
      data: { page, pageSize },
    })
  }

  async retrieveKnowledge(
    query: string,
    options?: { category?: string; level?: 'national' | 'local'; year?: number; topK?: number }
  ): Promise<{ results: KnowledgeResult[]; total: number; tookMs: number }> {
    return this.request({
      url: '/v1/knowledge/retrieve',
      method: 'POST',
      data: { query, filters: options, topK: options?.topK || 10 },
    })
  }

  async analyzeCase(
    caseType: string,
    facts: string,
    options?: { evidence?: any[]; requirements?: Record<string, any> }
  ): Promise<AnalysisResult> {
    return this.request({
      url: '/v1/cases/analyze',
      method: 'POST',
      data: { caseType, facts, evidence: options?.evidence, requirements: options?.requirements },
    })
  }

  async getAnalysis(analysisId: string): Promise<AnalysisResult> {
    return this.request<AnalysisResult>({ url: `/v1/cases/analyze/${analysisId}` })
  }

  async sendStreamMessage(
    sessionId: string,
    content: string,
    onChunk: (chunk: string) => void,
    onComplete: (message: ChatMessage) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    if (!this.token) {
      onError(new Error('未登录'))
      return
    }
    try {
      const response = await fetch(`${DEFAULT_BASE_URL}/v1/chat/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: {
          ...this.getAuthHeader(),
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ content }),
      })
      if (!response.ok) throw new Error('请求失败')
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'chunk') {
                onChunk(parsed.content)
              } else if (parsed.type === 'done') {
                onComplete(parsed.message as ChatMessage)
              } else if (parsed.type === 'error') {
                onError(new Error(parsed.message))
              }
            } catch {
              onChunk(data)
            }
          }
        }
      }
    } catch (e) {
      onError(e instanceof Error ? e : new Error('流式响应失败'))
    }
  }

  async getUserProfile(): Promise<User> {
    return this.request<User>({ url: '/v1/users/profile' })
  }

  async updateUserProfile(data: Partial<User>): Promise<User> {
    return this.request<User>({ url: '/v1/users/profile', method: 'PUT', data })
  }
}

let apiService: ApiService | null = null
export function getApiService(): ApiService {
  if (!apiService) apiService = new ApiService()
  return apiService
}
export default ApiService
