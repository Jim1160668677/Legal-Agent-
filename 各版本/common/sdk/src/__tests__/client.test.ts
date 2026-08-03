/**
 * 法律智能体 SDK 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LegalAgentClient, ApiErrorClass, WebSocketClient, type ApiConfig } from '../index'

// Mock axios
const mockAxios = {
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  defaults: { headers: { common: {} } },
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxios),
  },
}))

describe('LegalAgentClient', () => {
  let client: LegalAgentClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new LegalAgentClient({
      baseUrl: 'http://test-api.com',
    })
  })

  describe('构造函数', () => {
    it('应该创建客户端实例', () => {
      expect(client).toBeInstanceOf(LegalAgentClient)
    })

    it('应该接受自定义配置', () => {
      const customClient = new LegalAgentClient({
        baseUrl: 'http://custom.com',
        timeout: 60000,
        apiKey: 'test-key',
      })
      expect(customClient).toBeInstanceOf(LegalAgentClient)
    })
  })

  describe('认证方法', () => {
    it('isAuthenticated 初始应该返回 false', () => {
      expect(client.isAuthenticated()).toBe(false)
    })

    it('setToken 应该设置 token 并更新 headers', () => {
      client.setToken('test-jwt-token')
      expect(mockAxios.defaults.headers.common['Authorization']).toBe('Bearer test-jwt-token')
    })

    it('setToken 应该同时设置 refreshToken', () => {
      client.setToken('access-token', 'refresh-token')
      expect(client.isAuthenticated()).toBe(true)
    })

    it('clearToken 应该清除所有认证信息', () => {
      client.setToken('test-token')
      client.clearToken()
      expect(client.isAuthenticated()).toBe(false)
      expect(mockAxios.defaults.headers.common['Authorization']).toBeUndefined()
    })

    it('getUser 在未登录时应该返回 null', () => {
      expect(client.getUser()).toBeNull()
    })
  })

  describe('API方法存在性', () => {
    it('应该有 login 方法', () => {
      expect(typeof client.login).toBe('function')
    })

    it('应该有 logout 方法', () => {
      expect(typeof client.logout).toBe('function')
    })

    it('应该有 refreshAuthToken 方法', () => {
      expect(typeof client.refreshAuthToken).toBe('function')
    })

    it('应该有 createSession 方法', () => {
      expect(typeof client.createSession).toBe('function')
    })

    it('应该有 sendMessage 方法', () => {
      expect(typeof client.sendMessage).toBe('function')
    })

    it('应该有 getMessages 方法', () => {
      expect(typeof client.getMessages).toBe('function')
    })

    it('应该有 listSessions 方法', () => {
      expect(typeof client.listSessions).toBe('function')
    })

    it('应该有 deleteSession 方法', () => {
      expect(typeof client.deleteSession).toBe('function')
    })

    it('应该有 retrieveKnowledge 方法', () => {
      expect(typeof client.retrieveKnowledge).toBe('function')
    })

    it('应该有 analyzeCase 方法', () => {
      expect(typeof client.analyzeCase).toBe('function')
    })

    it('应该有 getAnalysis 方法', () => {
      expect(typeof client.getAnalysis).toBe('function')
    })

    it('应该有 createDocumentTask 方法', () => {
      expect(typeof client.createDocumentTask).toBe('function')
    })

    it('应该有 recognizeIntent 方法', () => {
      expect(typeof client.recognizeIntent).toBe('function')
    })

    it('应该有 createWebSocket 方法', () => {
      expect(typeof client.createWebSocket).toBe('function')
    })
  })

  describe('事件发射', () => {
    it('应该在登录时发射 auth:login 事件', async () => {
      const mockLoginResponse = {
        data: {
          data: {
            accessToken: 'test-token',
            refreshToken: 'refresh-token',
            user: { id: '1', username: 'test', role: 'user' as const },
          },
        },
      }
      mockAxios.post.mockResolvedValue(mockLoginResponse)

      const authHandler = vi.fn()
      client.on('auth:login', authHandler)

      await client.login('test', 'test123')
      expect(authHandler).toHaveBeenCalledWith({ id: '1', username: 'test', role: 'user' })
    })

    it('应该在登出时发射 auth:logout 事件', async () => {
      mockAxios.post.mockResolvedValue({ data: { success: true, data: {} } })

      const logoutHandler = vi.fn()
      client.on('auth:logout', logoutHandler)

      client.clearToken()
      await client.logout()
      expect(logoutHandler).toHaveBeenCalled()
    })
  })

  describe('请求拦截器', () => {
    it('应该自动添加 X-Client-Type 请求头', async () => {
      mockAxios.post.mockResolvedValue({ data: { success: true, data: {} } })

      await client.login('test', 'test123')

      const callArgs = mockAxios.post.mock.calls[0]
      expect(callArgs[0]).toBe('/v1/auth/login')
    })
  })
})

describe('ApiErrorClass', () => {
  it('应该创建正确的错误信息', () => {
    const error = new ApiErrorClass({
      code: 'AUTH_001',
      message: 'Token过期',
    })

    expect(error.code).toBe('AUTH_001')
    expect(error.message).toBe('Token过期')
    expect(error.name).toBe('ApiError')
  })

  it('应该包含详细信息', () => {
    const error = new ApiErrorClass({
      code: 'VALID_001',
      message: '参数校验失败',
      details: { field: 'username' },
    })

    expect(error.details).toEqual({ field: 'username' })
  })

  it('应该有 stack 属性', () => {
    const error = new ApiErrorClass({
      code: 'SYS_001',
      message: '系统错误',
    })

    expect(error.stack).toBeDefined()
    expect(typeof error.stack).toBe('string')
  })

  it('应该继承 Error', () => {
    const error = new ApiErrorClass({ code: 'TEST', message: 'test' })
    expect(error).toBeInstanceOf(Error)
  })
})

describe('WebSocketClient', () => {
  let wsClient: WebSocketClient

  beforeEach(() => {
    // Mock WebSocket
    const mockSend = vi.fn()
    const mockClose = vi.fn()
    global.WebSocket = vi.fn().mockImplementation(() => ({
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      readyState: 1, // OPEN
      send: mockSend,
      close: mockClose,
    }))
    wsClient = new WebSocketClient('ws://test.com')
  })

  describe('连接管理', () => {
    it('应该创建 WebSocket 实例', () => {
      wsClient.connect()
      expect(global.WebSocket).toHaveBeenCalledWith('ws://test.com')
    })

    it('应该发送消息', () => {
      wsClient.connect()
      wsClient.send({ type: 'test' })
      const mockWs = (global.WebSocket as any).mock.results[0].value
      expect(mockWs.send).toHaveBeenCalled()
    })

    it('应该处理 WebSocket 关闭', () => {
      wsClient.connect()
      wsClient.close()
      const mockWs = (global.WebSocket as any).mock.results[0].value
      expect(mockWs.close).toHaveBeenCalled()
    })
  })

  describe('事件处理', () => {
    it('应该触发 connected 事件', () => {
      const handler = vi.fn()
      wsClient.on('ws:connected', handler)

      wsClient.connect()
      const mockWs = (global.WebSocket as any).mock.results[0].value
      mockWs.onopen?.({} as any)

      expect(handler).toHaveBeenCalled()
    })

    it('应该触发 error 事件', () => {
      const handler = vi.fn()
      wsClient.on('ws:error', handler)

      wsClient.connect()
      const mockWs = (global.WebSocket as any).mock.results[0].value
      mockWs.onerror?.({} as any)

      expect(handler).toHaveBeenCalled()
    })

    it('应该触发 disconnected 事件', () => {
      const handler = vi.fn()
      wsClient.on('ws:disconnected', handler)

      wsClient.connect()
      const mockWs = (global.WebSocket as any).mock.results[0].value
      mockWs.onclose?.({} as any)

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('心跳机制', () => {
    it('应该启动心跳定时器', () => {
      const mockSetInterval = vi.fn()
      global.setInterval = mockSetInterval

      wsClient.connect()
      expect(mockSetInterval).toHaveBeenCalled()
    })

    it('停止后应该清除定时器', () => {
      const mockSetInterval = vi.fn()
      const mockClearInterval = vi.fn()
      global.setInterval = mockSetInterval
      global.clearInterval = mockClearInterval

      wsClient.connect()
      wsClient.close()
      expect(mockClearInterval).toHaveBeenCalled()
    })
  })
})

describe('类型定义验证', () => {
  it('ChatMessage 类型应该包含必要字段', () => {
    const message = {
      id: '1',
      sessionId: 's1',
      role: 'user' as const,
      content: '你好',
      type: 'text' as const,
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(message).toMatchObject({
      id: expect.any(String),
      sessionId: expect.any(String),
      role: expect.any(String),
      content: expect.any(String),
      type: expect.any(String),
      createdAt: expect.any(String),
    })
  })

  it('ChatSession 类型应该包含必要字段', () => {
    const session = {
      id: 's1',
      messages: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    expect(session).toMatchObject({
      id: expect.any(String),
      messages: expect.any(Array),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('AnalysisResult 类型应该包含 IRAC 结构', () => {
    const result = {
      analysisId: 'a1',
      caseType: 'contract',
      irac: {
        issue: ['争议焦点'],
        rule: [{ law: '民法典', article: '第577条', content: '...' }],
        analysis: [{ fact: '事实', rule: '规则', reasoning: '推理' }],
        conclusion: '结论',
      },
      riskAssessment: {
        level: 'medium' as const,
        factors: [],
        suggestions: [],
      },
      recommendations: [],
    }
    expect(result).toHaveProperty('irac')
    expect(result.irac).toHaveProperty('conclusion')
    expect(result).toHaveProperty('riskAssessment')
  })
})
