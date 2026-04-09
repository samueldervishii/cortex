import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { apiClient } from '../config/api'
import { clearSessionCache } from '../hooks/useCouncil'

interface User {
  id: string
  email: string
  display_name: string
  username: string
  avatar: string
  field_of_work: string
  personal_preferences: string
}

interface ProfileData {
  display_name: string
  username: string
  field_of_work?: string
  personal_preferences?: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  networkError: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  updateProfile: (data: ProfileData) => Promise<void>
  regenerateAvatar: () => Promise<string>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'cortex-access-token'
const REFRESH_KEY = 'cortex-refresh-token'

function userFromResponse(data: any): User {
  return {
    id: data.id,
    email: data.email,
    display_name: data.display_name || '',
    username: data.username || '',
    avatar: data.avatar || '',
    field_of_work: data.field_of_work || '',
    personal_preferences: data.personal_preferences || '',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [networkError, setNetworkError] = useState(false)

  const storeTokens = (accessToken: string, refreshToken: string) => {
    localStorage.setItem(TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_KEY, refreshToken)
  }

  const clearTokens = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }

  const logout = useCallback(() => {
    localStorage.clear()
    clearSessionCache()
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
        setUser(userFromResponse(res.data))
      } catch (err: any) {
        if (err?.isNetworkError) {
          // Server unreachable — don't clear tokens, user may be offline
          setNetworkError(true)
        } else {
          // Token expired — try refresh
          const refreshToken = localStorage.getItem(REFRESH_KEY)
          if (refreshToken) {
            try {
              const res = await apiClient.post('/auth/refresh', { refresh_token: refreshToken })
              storeTokens(res.data.access_token, res.data.refresh_token)
              const meRes = await apiClient.get('/auth/me')
              setUser(userFromResponse(meRes.data))
            } catch (refreshErr: any) {
              if (refreshErr?.isNetworkError) {
                setNetworkError(true)
              } else {
                clearTokens()
              }
            }
          } else {
            clearTokens()
          }
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
    setUser(userFromResponse(meRes.data))
  }

  const register = async (email: string, password: string) => {
    const res = await apiClient.post('/auth/register', { email, password })
    storeTokens(res.data.access_token, res.data.refresh_token)
    const meRes = await apiClient.get('/auth/me')
    setUser(userFromResponse(meRes.data))
  }

  const updateProfile = async (data: ProfileData) => {
    const res = await apiClient.patch('/auth/profile', {
      display_name: data.display_name,
      username: data.username,
      field_of_work: data.field_of_work ?? '',
      personal_preferences: data.personal_preferences ?? '',
    })
    setUser(userFromResponse(res.data))
  }

  const regenerateAvatar = async () => {
    const res = await apiClient.post('/auth/avatar/regenerate')
    setUser(userFromResponse(res.data))
    return res.data.avatar
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
    clearSessionCache()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        networkError,
        login,
        register,
        logout,
        updateProfile,
        regenerateAvatar,
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
