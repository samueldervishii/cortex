import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import versionData from '../../../version.json'

export const API_BASE: string = import.meta.env.VITE_API_BASE
export const API_KEY: string = import.meta.env.VITE_API_KEY || ''
export const FRONTEND_URL: string = import.meta.env.VITE_FRONTEND_URL || window.location.origin
export const FRONTEND_VERSION: string = versionData.version

const TOKEN_KEY = 'etude-access-token'
const REFRESH_KEY = 'etude-refresh-token'

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
//
// Refresh-token rotation is single-use on the server: each successful
// /auth/refresh call invalidates the prior refresh token. Without
// cross-tab coordination, two tabs each hitting a 401 at the same moment
// will both fire /auth/refresh with the SAME refresh token; the second
// request looks like a replay attack to the server, which invalidates
// the entire token family and logs the user out of every tab.
//
// We coordinate across tabs using the Web Locks API, which is the
// standards-track solution for "only one tab does this at a time"
// (Chrome 69+, Firefox 96+, Safari 15.4+). When a tab grabs the lock,
// it first checks whether localStorage already advanced past the access
// token it knew about — if so, another tab refreshed while we were
// queued and we just reuse the new token instead of burning ours.
//
// In-page Promise dedup (`refreshPromise`) is still useful for the
// common case of multiple in-flight requests within the SAME tab all
// hitting 401 simultaneously — it short-circuits before the lock.
let refreshPromise: Promise<string> | null = null

const hasWebLocks =
  typeof navigator !== 'undefined' && typeof (navigator as any).locks?.request === 'function'

async function performRefresh(): Promise<string> {
  // Snapshot the access token we know about. If after winning the lock
  // localStorage shows a different access token, another tab already
  // refreshed; we adopt their result rather than re-spending our
  // (now-rotated, server-invalidated) refresh token.
  const snapshotAccess = localStorage.getItem(TOKEN_KEY)

  const exchange = async (): Promise<string> => {
    const currentAccess = localStorage.getItem(TOKEN_KEY)
    if (currentAccess && currentAccess !== snapshotAccess) {
      return currentAccess
    }
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    if (!refreshToken) throw new Error('No refresh token')
    const { data } = await axios.post(`${API_BASE}/auth/refresh`, {
      refresh_token: refreshToken,
    })
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    return data.access_token as string
  }

  if (hasWebLocks) {
    return (navigator as any).locks.request('etude-token-refresh', exchange)
  }
  return exchange()
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Network / unreachable server — detect this BEFORE the auth-endpoint
    // early return so login/register pages also get the isNetworkError flag
    // (otherwise ERR_CONNECTION_REFUSED shows a vague "Something went wrong").
    if (!error.response && (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED')) {
      const networkError = new Error(
        error.code === 'ECONNABORTED'
          ? 'The server is taking too long to respond. Please try again.'
          : 'Please check your internet connection or try again.'
      ) as any
      networkError.isNetworkError = true
      networkError.originalError = error
      return Promise.reject(networkError)
    }

    // Don't retry auth endpoints or already-retried requests
    if (!originalRequest || originalRequest._retry || originalRequest.url?.startsWith('/auth/')) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401) {
      originalRequest._retry = true

      try {
        if (!refreshPromise) {
          refreshPromise = performRefresh()
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

    return Promise.reject(error)
  }
)

// Cross-tab logout/login propagation: when one tab clears the access
// token (manual logout, refresh failure) other tabs should not keep
// making requests with their stale in-memory state. The `storage` event
// fires in every OTHER tab when localStorage is mutated.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== TOKEN_KEY) return
    // Token cleared in another tab -> session ended; bounce to /login if
    // we're not already there.
    if (e.newValue === null && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  })
}

/** Helper: get current access token for non-axios calls (e.g. SSE fetch) */
export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
