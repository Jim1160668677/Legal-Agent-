/**
 * 法律智能体 SDK 单元测试（对齐当前 LegalAgentClient 实现）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LegalAgentClient, { ApiError } from '../index'
import type { ChatFrame } from '../types'

// ==================== 测试工具 ====================

/** 构造 SSE 响应体流 */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function jsonResponse(body: unknown, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
    body: null,
    ...init,
  } as unknown as Response
}

/** 以数组形式消费 chat 异步生成器 */
async function collectFrames(generator: AsyncGenerator<ChatFrame>): Promise<ChatFrame[]> {
  const frames: ChatFrame[] = []
  for await (const frame of generator) {
    frames.push(frame)
  }
  return frames
}

const CHAT_SSE = [
  'event: chunk\ndata: {"type":"chunk","delta":"你好"}\n\n',
  'event: meta\ndata: {"type":"meta","sessionId":"s1"}\n\n',
  'event: done\ndata: {"type":"done","messageId":"m1"}\n\n',
]

describe('LegalAgentClient', () => {
  let client: LegalAgentClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new LegalAgentClient({ baseUrl: 'https://api.test.com/' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('构造函数', () => {
    it('应创建客户端实例（baseUrl 尾部斜杠被去除）', () => {
      expect(client).toBeInstanceOf(LegalAgentClient)
    })

    it('应接受自定义配置', () => {
      const c = new LegalAgentClient({
        baseUrl: 'https://custom.com',
        timeout: 5000,
        appVersion: '2.0.0',
        clientType: 'mini',
      })
      expect(c).toBeInstanceOf(LegalAgentClient)
    })
  })

  describe('认证状态', () => {
    it('isLoggedIn 初始应返回 false', () => {
      expect(client.isLoggedIn()).toBe(false)
    })

    it('setTokens 后 isLoggedIn 返回 true', () => {
      client.setTokens('access-token', 'refresh-token')
      expect(client.isLoggedIn()).toBe(true)
      expect(client.getToken()).toBe('access-token')
    })

    it('clearTokens 应清除认证信息', () => {
      client.setTokens('a', 'r')
      client.clearTokens()
      expect(client.isLoggedIn()).toBe(false)
      expect(client.getToken()).toBeNull()
    })
  })

  describe('login', () => {
    it('应调用 POST /v1/auth/login 并解析统一响应', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          code: 0,
          data: { accessToken: 'at', refreshToken: 'rt', userId: 'u1', isNewUser: false },
          traceId: 't1',
        }),
      )
      const result = await client.login('phone', '13800138000')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.userId).toBe('u1')
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.test.com/v1/auth/login')
      expect(init.method).toBe('POST')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        provider: 'phone',
        externalId: '13800138000',
      })
    })
  })

  describe('refreshAuthToken', () => {
    it('无 refreshToken 时应返回 4011 错误', async () => {
      const result = await client.refreshAuthToken()
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe(4011)
    })
  })

  describe('logout', () => {
    it('应调用 POST /v1/auth/logout 并在 finally 清除 token', async () => {
      client.setTokens('a', 'r')
      fetchMock.mockResolvedValue(jsonResponse({ code: 0, data: {} }))
      await client.logout()
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.test.com/v1/auth/logout')
      expect(client.isLoggedIn()).toBe(false)
    })

    it('即使请求失败也应清除 token', async () => {
      client.setTokens('a', 'r')
      fetchMock.mockRejectedValue(new Error('network'))
      await expect(client.logout()).rejects.toThrow()
      expect(client.isLoggedIn()).toBe(false)
    })
  })

  describe('listAgents', () => {
    it('应调用 GET /v1/agents 并解析结果', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          code: 0,
          data: { agents: [{ id: '1', name: '合同审查', description: '', avatar: '', exposure: 'L-Read' }] },
        }),
      )
      const result = await client.listAgents()
      expect(result.ok).toBe(true)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.test.com/v1/agents')
    })
  })

  describe('chatFrames（SSE）', () => {
    it('应解析 SSE 帧为数组', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        body: sseStream(CHAT_SSE),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      const frames = await client.chatFrames({ message: '你好' })
      expect(frames.map((f) => f.type)).toEqual(['chunk', 'meta', 'done'])
    })

    it('SSE 请求应携带 text/event-stream Accept 头', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        body: sseStream(['event: done\ndata: {"type":"done","messageId":"m1"}\n\n']),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      await collectFrames(client.chat({ message: 'hi' }))
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect((init.headers as Record<string, string>)['Accept']).toBe('text/event-stream')
    })
  })

  describe('错误处理', () => {
    it('fetch 网络异常时应抛出 ApiError(5001)', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
      await expect(client.listAgents()).rejects.toMatchObject({ code: 5001, name: 'ApiError' })
    })

    it('HTTP 非 2xx 时应抛出 ApiError(status)', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as unknown as Response)
      await expect(client.listAgents()).rejects.toMatchObject({ code: 404 })
    })

    it('401 且无 refreshToken 时应抛出 ApiError(4011)', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as unknown as Response)
      await expect(client.listAgents()).rejects.toMatchObject({ code: 4011 })
    })

    it('401 时应先刷新 token 再重试原请求', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
        } as unknown as Response)
        .mockResolvedValueOnce(
          jsonResponse({
            code: 0,
            data: { accessToken: 'new-at', refreshToken: 'new-rt', userId: 'u1', isNewUser: false },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ code: 0, data: { agents: [] } }))
      client.setTokens('expired-at', 'rt')
      const result = await client.listAgents()
      expect(result.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })
})

describe('ApiError', () => {
  it('应创建正确的错误信息', () => {
    const error = new ApiError(404, 'Not Found')
    expect(error.code).toBe(404)
    expect(error.message).toBe('Not Found')
    expect(error.name).toBe('ApiError')
  })

  it('应继承 Error 并包含 stack', () => {
    const error = new ApiError(500, 'Server Error')
    expect(error).toBeInstanceOf(Error)
    expect(error.stack).toBeDefined()
  })
})
