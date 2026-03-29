import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { apiClient } from '../config/api'

interface User {
  id: string
  email: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'llm-council-access-token'
const REFRESH_KEY = 'llm-council-refresh-token'

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
    clearTokens()
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
        setUser({ id: res.data.id, email: res.data.email })
      } catch {
        // Token expired — try refresh
        const refreshToken = localStorage.getItem(REFRESH_KEY)
        if (refreshToken) {
          try {
            const res = await apiClient.post('/auth/refresh', { refresh_token: refreshToken })
            storeTokens(res.data.access_token, res.data.refresh_token)
            const meRes = await apiClient.get('/auth/me')
            setUser({ id: meRes.data.id, email: meRes.data.email })
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
    setUser({ id: meRes.data.id, email: meRes.data.email })
  }

  const register = async (email: string, password: string) => {
    const res = await apiClient.post('/auth/register', { email, password })
    storeTokens(res.data.access_token, res.data.refresh_token)
    const meRes = await apiClient.get('/auth/me')
    setUser({ id: meRes.data.id, email: meRes.data.email })
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
