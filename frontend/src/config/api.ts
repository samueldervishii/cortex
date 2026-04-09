import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import versionData from '../../../version.json'

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
export const API_KEY: string = import.meta.env.VITE_API_KEY || ''
export const FRONTEND_URL: string = import.meta.env.VITE_FRONTEND_URL || window.location.origin
export const FRONTEND_VERSION: string = versionData.version

const TOKEN_KEY = 'cortex-access-token'
const REFRESH_KEY = 'cortex-refresh-token'

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// --- Request interceptor: attach Bearer token ---
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// --- Response interceptor: auto-refresh on 401 ---
let refreshPromise: Promise<string> | null = null

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Don't retry auth endpoints or already-retried requests
    if (!originalRequest || originalRequest._retry || originalRequest.url?.startsWith('/auth/')) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401) {
      originalRequest._retry = true

      try {
        // Deduplicate concurrent refresh calls
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const refreshToken = localStorage.getItem(REFRESH_KEY)
            if (!refreshToken) throw new Error('No refresh token')
            const { data } = await axios.post(`${API_BASE}/auth/refresh`, {
              refresh_token: refreshToken,
            })
            localStorage.setItem(TOKEN_KEY, data.access_token)
            localStorage.setItem(REFRESH_KEY, data.refresh_token)
            return data.access_token as string
          })()
        }

        const newToken = await refreshPromise
        refreshPromise = null
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return apiClient(originalRequest)
      } catch {
        refreshPromise = null
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REFRESH_KEY)
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }

    // Network error (server unreachable, no internet)
    if (!error.response && error.code === 'ERR_NETWORK') {
      const networkError = new Error('Please check your internet connection.') as any
      networkError.isNetworkError = true
      networkError.originalError = error
      return Promise.reject(networkError)
    }

    return Promise.reject(error)
  }
)

/** Helper: get current access token for non-axios calls (e.g. SSE fetch) */
export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
