/**
 * WebSocket 客户端测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebSocketClient } from '../index'

describe('WebSocketClient', () => {
  let wsClient: WebSocketClient

  beforeEach(() => {
    // Mock WebSocket
    global.WebSocket = vi.fn().mockImplementation(() => ({
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
    }))
    
    wsClient = new WebSocketClient('ws://test.com')
  })

  describe('连接管理', () => {
    it('应该创建 WebSocket 实例', () => {
      wsClient.connect()
      expect(global.WebSocket).toHaveBeenCalledWith('ws://test.com')
    })

    it('应该发送消息', () => {
      const mockWs = { send: vi.fn() } as any
      ;(global.WebSocket as any).mockReturnValue(mockWs)
      
      wsClient.connect()
      wsClient.send({ type: 'test' })
      
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
    it('应该触发 connect 事件', () => {
      const mockOnConnect = vi.fn()
      wsClient.on('ws:connected', mockOnConnect)
      
      wsClient.connect()
      
      const mockWs = (global.WebSocket as any).mock.results[0].value
      mockWs.onopen?.({} as any)
      
      expect(mockOnConnect).toHaveBeenCalled()
    })

    it('应该触发 error 事件', () => {
      const mockOnError = vi.fn()
      wsClient.on('ws:error', mockOnError)
      
      wsClient.connect()
      
      const mockWs = (global.WebSocket as any).mock.results[0].value
      mockWs.onerror?.({} as any)
      
      expect(mockOnError).toHaveBeenCalled()
    })
  })

  describe('心跳机制', () => {
    it('应该启动心跳定时器', () => {
      const mockSetInterval = vi.fn()
      global.setInterval = mockSetInterval
      
      wsClient.connect()
      
      expect(mockSetInterval).toHaveBeenCalled()
    })
  })
})
