/**
 * 认证 Store
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@legal-agent/sdk'

interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  login: (user: User, token: string, refreshToken: string) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,

      login: (user, token, refreshToken) =>
        set({ user, token, refreshToken, isAuthenticated: true }),

      logout: () =>
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
        }),

      updateUser: (user) =>
        set((state) => ({ user: state.user ? { ...state.user, ...user } : null })),
    }),
    {
      name: 'legal-agent-auth',
    }
  )
)
