/**
 * 聊天状态管理
 */
import { create } from 'zustand'
import { getApiService } from '../services/api'

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

interface PaginatedResponse<T> {
  data: {
    items: T[]
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
  }
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  isLoading: boolean
  isTyping: boolean
  isStreaming: boolean
  setCurrentSession: (sessionId: string) => void
  loadSessions: () => Promise<void>
  createSession: (intent?: string) => Promise<ChatSession>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  isTyping: false,
  isStreaming: false,

  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId, messages: [] }),

  loadSessions: async () => {
    set({ isLoading: true })
    try {
      const apiService = getApiService()
      const res = await apiService.listSessions(1, 50)
      set({ sessions: res.data.items, isLoading: false })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  createSession: async (intent?: string) => {
    const apiService = getApiService()
    const session = await apiService.createSession(intent)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      messages: [],
    }))
    return session
  },

  sendMessage: async (sessionId, content) => {
    const apiService = getApiService()
    set({ isTyping: true, isStreaming: true })

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sessionId,
      role: 'user',
      content,
      type: 'text',
      createdAt: new Date().toISOString(),
    }
    set({ messages: [...get().messages, userMessage] })

    const assistantMessageId = `assistant-${Date.now()}`
    let assistantContent = ''

    set({
      messages: [
        ...get().messages,
        {
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          content: '',
          type: 'text',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    await apiService.sendStreamMessage(
      sessionId,
      content,
      (chunk) => {
        assistantContent += chunk
        set({
          messages: get().messages.map((m) =>
            m.id === assistantMessageId ? { ...m, content: assistantContent } : m
          ),
        })
      },
      (message) => {
        set({
          messages: get().messages.map((m) => (m.id === assistantMessageId ? message : m)),
          isTyping: false,
          isStreaming: false,
        })
      },
      (error) => {
        set({ isTyping: false, isStreaming: false })
        console.error('流式响应错误:', error)
      }
    )
  },

  deleteSession: async (sessionId) => {
    const apiService = getApiService()
    await apiService.deleteSession(sessionId)
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      messages: state.messages.filter((m) => m.sessionId !== sessionId),
      currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
    }))
  },
}))
