import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { apiClient } from '../config/api'

interface User {
  id: string
  email: string
  display_name: string
  username: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  updateProfile: (displayName: string, username: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'cortex-access-token'
const REFRESH_KEY = 'cortex-refresh-token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const storeTokens = (accessToken: string, refreshToken: string) => {
    localStorage.setItem(TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_KEY, refreshToken)
  }

  const clearTokens = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }

  const logout = useCallback(() => {
    // Clear everything from localStorage
    localStorage.clear()
    document.documentElement.setAttribute('data-theme', 'light')
    setUser(null)
  }, [])

  // On mount, check if we have a valid token
  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem(TOKEN_KEY)
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        const res = await apiClient.get('/auth/me')
        setUser({
          id: res.data.id,
          email: res.data.email,
          display_name: res.data.display_name || '',
          username: res.data.username || '',
        })
      } catch {
        // Token expired — try refresh
        const refreshToken = localStorage.getItem(REFRESH_KEY)
        if (refreshToken) {
          try {
            const res = await apiClient.post('/auth/refresh', { refresh_token: refreshToken })
            storeTokens(res.data.access_token, res.data.refresh_token)
            const meRes = await apiClient.get('/auth/me')
            setUser({
              id: meRes.data.id,
              email: meRes.data.email,
              display_name: meRes.data.display_name || '',
              username: meRes.data.username || '',
            })
          } catch {
            clearTokens()
          }
        } else {
          clearTokens()
        }
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [])

  const login = async (email: string, password: string) => {
    const res = await apiClient.post('/auth/login', { email, password })
    storeTokens(res.data.access_token, res.data.refresh_token)
    const meRes = await apiClient.get('/auth/me')
    setUser({
      id: meRes.data.id,
      email: meRes.data.email,
      display_name: meRes.data.display_name || '',
      username: meRes.data.username || '',
    })
  }

  const register = async (email: string, password: string) => {
    const res = await apiClient.post('/auth/register', { email, password })
    storeTokens(res.data.access_token, res.data.refresh_token)
    const meRes = await apiClient.get('/auth/me')
    setUser({
      id: meRes.data.id,
      email: meRes.data.email,
      display_name: meRes.data.display_name || '',
      username: meRes.data.username || '',
    })
  }

  const updateProfile = async (displayName: string, username: string) => {
    const res = await apiClient.patch('/auth/profile', { display_name: displayName, username })
    setUser({
      id: res.data.id,
      email: res.data.email,
      display_name: res.data.display_name || '',
      username: res.data.username || '',
    })
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await apiClient.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
  }

  const deleteAccount = async (password: string) => {
    await apiClient.delete('/auth/account', { data: { password } })
    clearTokens()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        updateProfile,
        changePassword,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
