/**
 * 认证状态管理
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getApiService } from '../services/api'

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

interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateUser: (user: Partial<User>) => void
  checkStatus: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (username, password) => {
        set({ isLoading: true })
        try {
          const apiService = getApiService()
          const result = await apiService.login(username, password)
          set({
            user: result.user,
            token: result.token,
            refreshToken: result.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      logout: async () => {
        const apiService = getApiService()
        try {
          await apiService.logout()
        } finally {
          set({
            user: null,
            token: null,
            refreshToken: null,
            isAuthenticated: false,
          })
        }
      },

      updateUser: (user) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...user } : null,
        })),

      checkStatus: () => {
        const apiService = getApiService()
        apiService.checkLoginStatus()
        if (apiService.isAuthenticated()) {
          set({ isAuthenticated: true, token: apiService['token'] })
        }
      },
    }),
    {
      name: 'legal-agent-auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      }),
    }
  )
)
