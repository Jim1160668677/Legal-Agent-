/**
 * 聊天 Store
 */
import { create } from 'zustand'
import type { ChatSession, ChatMessage } from '@legal-agent/sdk'

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  isLoading: boolean
  isTyping: boolean

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string) => void
  addMessage: (message: ChatMessage) => void
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void
  setLoading: (loading: boolean) => void
  setTyping: (typing: boolean) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  isTyping: false,

  setSessions: (sessions) => set({ sessions }),
  
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId, messages: [] }),
  
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  
  updateMessage: (messageId, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      ),
    })),
  
  setLoading: (isLoading) => set({ isLoading }),
  setTyping: (isTyping) => set({ isTyping }),
  clearMessages: () => set({ messages: [] }),
}))
