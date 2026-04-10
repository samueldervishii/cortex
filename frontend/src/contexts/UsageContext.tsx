import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiClient } from '../config/api'
import { useAuth } from './AuthContext'

export interface UsageCurrent {
  bucket_start: string | null
  bucket_end: string | null
  resets_in_seconds: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  message_count: number
  artifact_count: number
  file_upload_count: number
}

export interface UsageHistory {
  days: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  message_count: number
  artifact_count: number
  file_upload_count: number
}

interface UsageContextValue {
  current: UsageCurrent | null
  history: UsageHistory | null
  loading: boolean
  refreshCurrent: () => Promise<void>
  refreshHistory: (days?: number) => Promise<void>
  applyLiveUpdate: (payload: UsageCurrent) => void
}

const UsageContext = createContext<UsageContextValue | null>(null)

const EMPTY_CURRENT: UsageCurrent = {
  bucket_start: null,
  bucket_end: null,
  resets_in_seconds: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  message_count: 0,
  artifact_count: 0,
  file_upload_count: 0,
}

export function UsageProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [current, setCurrent] = useState<UsageCurrent | null>(null)
  const [history, setHistory] = useState<UsageHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshCurrent = useCallback(async () => {
    try {
      const res = await apiClient.get('/usage/current')
      setCurrent(res.data.usage || EMPTY_CURRENT)
    } catch {
      // Swallow — usage is non-critical
    }
  }, [])

  const refreshHistory = useCallback(async (days: number = 30) => {
    try {
      setLoading(true)
      const res = await apiClient.get(`/usage/history?days=${days}`)
      setHistory(res.data.history)
    } catch {
      // Swallow
    } finally {
      setLoading(false)
    }
  }, [])

  const applyLiveUpdate = useCallback((payload: UsageCurrent) => {
    if (!payload) return
    setCurrent(payload)
  }, [])

  // Hydrate on login / mount
  useEffect(() => {
    if (!isAuthenticated) {
      setCurrent(null)
      setHistory(null)
      return
    }
    refreshCurrent()
  }, [isAuthenticated, refreshCurrent])

  // Tick the countdown every second so "resets in" feels live without
  // hammering the API. Only runs while a bucket is active.
  useEffect(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current)
      tickerRef.current = null
    }
    if (!current || !current.bucket_end) return

    tickerRef.current = setInterval(() => {
      setCurrent((prev) => {
        if (!prev || !prev.bucket_end) return prev
        const remaining = Math.max(0, prev.resets_in_seconds - 1)
        return { ...prev, resets_in_seconds: remaining }
      })
    }, 1000)

    return () => {
      if (tickerRef.current) {
        clearInterval(tickerRef.current)
        tickerRef.current = null
      }
    }
  }, [current?.bucket_end])

  return (
    <UsageContext.Provider
      value={{ current, history, loading, refreshCurrent, refreshHistory, applyLiveUpdate }}
    >
      {children}
    </UsageContext.Provider>
  )
}

export function useUsage() {
  const ctx = useContext(UsageContext)
  if (!ctx) throw new Error('useUsage must be used within UsageProvider')
  return ctx
}
