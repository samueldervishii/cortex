import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, API_BASE, API_KEY, getAccessToken } from '../config/api'
import { useUsage } from '../contexts/UsageContext'
import { getSelectedModelId } from '../components/ModelSelector'

/**
 * Parse SSE events from a ReadableStream.
 * Yields { event, data } objects for each SSE event.
 */
async function* parseSSE(reader) {
  const decoder = new TextDecoder()
  let buffer = ''
  // IMPORTANT: these must live outside the read loop. SSE events can span
  // multiple TCP chunks (e.g. the event: and data: lines arriving in
  // different reads). If we reset per chunk, we lose the event name and
  // silently drop tokens — the visible response appears truncated even
  // though the backend persisted the full text.
  let currentEvent = null
  let currentData = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6)
      } else if (line === '' && currentEvent && currentData) {
        try {
          yield { event: currentEvent, data: JSON.parse(currentData) }
        } catch {
          yield { event: currentEvent, data: currentData }
        }
        currentEvent = null
        currentData = null
      }
    }
  }
}

// Module-level cache: avoid re-fetching on page navigation (component remounts)
let cachedSessions = null

/** Clear the module-level session cache (call on logout). */
export function clearSessionCache() {
  cachedSessions = null
}

function useCouncil() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState(cachedSessions || [])
  const [sessionLoadError, setSessionLoadError] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [quotedText, setQuotedText] = useState('')
  const { applyLiveUpdate: applyUsageUpdate, refreshCurrent: refreshUsageCurrent } = useUsage()

  // AbortController ref — used to cancel in-flight SSE streams on unmount
  // or when the user starts a new request before the previous one finishes.
  const abortControllerRef = useRef(null)

  // Monotonic counter to detect stale loadSession responses
  const loadRequestIdRef = useRef(0)

  // Typewriter smoothing: Anthropic sends tokens in bursts; we buffer them
  // and reveal characters at a steady rate via requestAnimationFrame so the
  // message appears to "type" smoothly regardless of network/model jitter.
  const typeBufferRef = useRef('')
  const streamingIndexRef = useRef(null)
  const drainRafRef = useRef(null)
  const lastFrameRef = useRef(0)

  const drainStep = useCallback((now) => {
    const dt = Math.min(100, now - lastFrameRef.current)
    lastFrameRef.current = now

    const buf = typeBufferRef.current
    if (buf.length === 0 || streamingIndexRef.current === null) {
      drainRafRef.current = null
      return
    }

    // Baseline ~240 cps, accelerates if the buffer is backing up so we
    // catch up during long bursts without ever lagging the real stream.
    const baseRate = 240
    const overflow = Math.max(0, buf.length - 40)
    const rate = baseRate + overflow * 12
    const chars = Math.max(1, Math.round((rate * dt) / 1000))

    const reveal = buf.slice(0, chars)
    typeBufferRef.current = buf.slice(chars)

    setMessages((prev) => {
      const idx = streamingIndexRef.current
      if (idx === null || idx >= prev.length) return prev
      const updated = [...prev]
      updated[idx] = { ...updated[idx], content: updated[idx].content + reveal }
      return updated
    })

    drainRafRef.current = requestAnimationFrame(drainStep)
  }, [])

  const queueTypeChars = useCallback(
    (chars) => {
      if (!chars) return
      typeBufferRef.current += chars
      if (drainRafRef.current === null) {
        lastFrameRef.current = performance.now()
        drainRafRef.current = requestAnimationFrame(drainStep)
      }
    },
    [drainStep]
  )

  // Cleanup: abort any in-flight stream when the component using this hook unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (drainRafRef.current !== null) {
        cancelAnimationFrame(drainRafRef.current)
        drainRafRef.current = null
      }
    }
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiClient.get('/sessions')
      cachedSessions = res.data.sessions
      setSessions(res.data.sessions)
    } catch (error) {
      console.error('Error fetching sessions:', error)
    }
  }, [])

  // Fetch sessions on mount — use cache if available (page navigation)
  useEffect(() => {
    if (!cachedSessions) {
      fetchSessions()
    }
  }, [fetchSessions])

  const loadSession = async (id) => {
    // Increment request counter — if another loadSession fires before this
    // one resolves, the stale response will be discarded.
    const requestId = ++loadRequestIdRef.current
    const startTime = Date.now()
    const minLoadingTime = 2000

    try {
      setIsLoadingSession(true)
      setSessionLoadError(null)
      setLoading(true)
      setCurrentStep('Loading session...')

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 30000)
      )

      const res = await Promise.race([apiClient.get(`/session/${id}`), timeoutPromise])

      // Stale response guard: a newer loadSession was triggered while waiting
      if (requestId !== loadRequestIdRef.current) return

      const session = res.data.session

      setSessionId(session.id)

      // Load messages from the session's messages array
      const loadedMessages = (session.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.model_id && { modelId: msg.model_id }),
        ...(msg.model_name && { modelName: msg.model_name }),
        ...(msg.response_time_ms && { responseTime: msg.response_time_ms }),
        ...(msg.is_artifact && { isArtifact: true }),
        ...(msg.file && { file: { filename: msg.file.filename, size: msg.file.size } }),
        ...(msg.citations && msg.citations.length > 0 && { citations: msg.citations }),
      }))

      const elapsedTime = Date.now() - startTime
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime)

      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime))
      }

      setMessages(loadedMessages)
      setSessionLoadError(null)
    } catch (error) {
      // Discard errors from stale requests
      if (requestId !== loadRequestIdRef.current) return
      console.error('Error loading session:', error)

      const elapsedTime = Date.now() - startTime
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime)

      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime))
      }

      if (error.message === 'timeout') {
        setSessionLoadError('The server is taking too long to respond. Please try again later.')
      } else {
        setSessionLoadError(
          error.response?.data?.detail || 'Something went wrong. Please check again later.'
        )
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoadingSession(false)
        setLoading(false)
        setCurrentStep('')
      }
    }
  }

  const deleteSession = async (id) => {
    try {
      await apiClient.delete(`/session/${id}`)
      await fetchSessions()
      if (sessionId === id) {
        startNewChat()
      }
    } catch (error) {
      console.error('Error deleting session:', error)
    }
  }

  const renameSession = async (id, newTitle) => {
    try {
      await apiClient.patch(`/session/${id}`, { title: newTitle })
      await fetchSessions()
    } catch (error) {
      console.error('Error renaming session:', error)
      throw error
    }
  }

  const togglePinSession = async (id) => {
    try {
      const session = sessions.find((s) => s.id === id)
      const newPinned = !session?.is_pinned
      await apiClient.patch(`/session/${id}`, { is_pinned: newPinned })
      await fetchSessions()
    } catch (error) {
      console.error('Error toggling pin:', error)
      throw error
    }
  }

  const branchSession = async (fromSessionId, messageIndex) => {
    try {
      const res = await apiClient.post(`/session/${fromSessionId}/branch`, {
        message_index: messageIndex,
      })
      const newSession = res.data.session
      await fetchSessions()
      // Load the new branched session
      setSessionId(newSession.id)
      const loadedMessages = (newSession.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.model_id && { modelId: msg.model_id }),
        ...(msg.model_name && { modelName: msg.model_name }),
        ...(msg.response_time_ms && { responseTime: msg.response_time_ms }),
        ...(msg.is_artifact && { isArtifact: true }),
        ...(msg.file && { file: { filename: msg.file.filename, size: msg.file.size } }),
        ...(msg.citations && msg.citations.length > 0 && { citations: msg.citations }),
      }))
      setMessages(loadedMessages)
      return newSession.id
    } catch (error) {
      console.error('Error branching session:', error)
      throw error
    }
  }

  const shareSession = async (id) => {
    try {
      const res = await apiClient.post(`/session/${id}/share`)
      return res.data
    } catch (error) {
      console.error('Error sharing session:', error)
      throw error
    }
  }

  const unshareSession = async (id) => {
    try {
      await apiClient.delete(`/session/${id}/share`)
    } catch (error) {
      console.error('Error unsharing session:', error)
      throw error
    }
  }

  const getShareInfo = async (id) => {
    try {
      const res = await apiClient.get(`/session/${id}/share-info`)
      return res.data
    } catch (error) {
      console.error('Error getting share info:', error)
      throw error
    }
  }

  /**
   * Stream SSE events from the /session/{id}/stream endpoint.
   * Uses native fetch() since EventSource only supports GET.
   * Handles token-level streaming for real-time typing effect.
   */
  const streamResponse = async (currentSessionId) => {
    // Cancel any in-flight stream before starting a new one.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    const headers = { 'Content-Type': 'application/json' }
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (API_KEY) headers['X-API-Key'] = API_KEY

    const response = await fetch(`${API_BASE}/session/${currentSessionId}/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model_id: getSelectedModelId() }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Stream failed' }))
      // On 429 (usage limit), pull fresh usage so the Settings bar jumps to 100%
      if (response.status === 429) {
        refreshUsageCurrent()
      }
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()

    // Reset typewriter state for this new stream
    typeBufferRef.current = ''
    streamingIndexRef.current = null
    if (drainRafRef.current !== null) {
      cancelAnimationFrame(drainRafRef.current)
      drainRafRef.current = null
    }

    let isArtifact = false

    for await (const { event, data } of parseSSE(reader)) {
      switch (event) {
        case 'web_search':
          setCurrentStep('Searching the web...')
          break

        case 'thinking':
          setCurrentStep('Thinking deeply...')
          break

        case 'artifact_hint':
          isArtifact = true
          break

        case 'message_start':
          setMessages((prev) => {
            streamingIndexRef.current = prev.length
            return [
              ...prev,
              {
                role: 'assistant',
                content: '',
                streaming: true,
                isArtifact,
                ...(data.model_id && { modelId: data.model_id }),
                ...(data.model_name && { modelName: data.model_name }),
              },
            ]
          })
          break

        case 'token':
          setCurrentStep('')
          queueTypeChars(data.content || data.token || '')
          break

        case 'message_end': {
          // Snapshot state into LOCAL consts before queueing setMessages.
          // Functional state updates run asynchronously at render time, so
          // if we read `streamingIndexRef.current` inside the closure, it
          // would already be null (we clear it below) and the update would
          // no-op, leaving the visible message truncated — while the
          // backend has the full response saved. That's exactly the
          // "cuts off mid-sentence but shows fully on reload" symptom.
          const idx = streamingIndexRef.current
          const remainingBuffer = typeBufferRef.current
          typeBufferRef.current = ''
          if (drainRafRef.current !== null) {
            cancelAnimationFrame(drainRafRef.current)
            drainRafRef.current = null
          }
          streamingIndexRef.current = null

          const finalContent = data.content
          const responseTimeMs = data.response_time_ms
          setMessages((prev) => {
            if (idx === null || idx >= prev.length) return prev
            const updated = [...prev]
            const existing = updated[idx]
            updated[idx] = {
              ...existing,
              // Prefer the backend's canonical full response; otherwise
              // append whatever was still in the typewriter buffer.
              content: finalContent || existing.content + remainingBuffer,
              streaming: false,
              ...(responseTimeMs && { responseTime: responseTimeMs }),
            }
            return updated
          })
          break
        }

        case 'error':
          setMessages((prev) => [
            ...prev,
            { role: 'error', content: data.message || 'An error occurred' },
          ])
          break

        case 'done':
          if (data && data.usage) {
            applyUsageUpdate(data.usage)
          }
          break
      }
    }

    // Stream finished normally — clear the ref so we don't abort a completed stream
    abortControllerRef.current = null
  }

  const startChat = async () => {
    if (!question.trim()) return

    // If the user selected text in a prior assistant message and hit Reply,
    // prepend it as a markdown blockquote so the model sees what they're
    // replying to. Clear the quote after use.
    const userQuestion = quotedText
      ? `> ${quotedText.split('\n').join('\n> ')}\n\n${question}`
      : question
    setQuestion('')
    setQuotedText('')
    setLoading(true)

    setMessages((prev) => [...prev, { role: 'user', content: userQuestion }])
    setCurrentStep('Thinking...')

    try {
      let currentSessionId = sessionId

      if (currentSessionId) {
        // Continue existing session
        await apiClient.post(`/session/${currentSessionId}/continue`, {
          question: userQuestion,
        })
      } else {
        // Create new session
        const createRes = await apiClient.post('/session', {
          question: userQuestion,
        })
        currentSessionId = createRes.data.session.id
        setSessionId(currentSessionId)
      }

      await streamResponse(currentSessionId)

      await fetchSessions()
    } catch (error) {
      // Don't show error messages for intentionally aborted streams
      if (error.name === 'AbortError') return
      console.error('Error:', error)
      setMessages((prev) => [
        ...prev,
        { role: 'error', content: error.response?.data?.detail || error.message },
      ])
    } finally {
      setLoading(false)
      setCurrentStep('')
    }
  }

  const sendFileMessage = async (file, messageText) => {
    setQuestion('')
    setLoading(true)

    const userText = messageText || `I've uploaded a file: ${file.name}. Please analyze it.`

    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: userText,
        file: { filename: file.name, size: file.size },
      },
    ])
    setCurrentStep('Thinking...')

    try {
      let currentSessionId = sessionId

      if (!currentSessionId) {
        // Create an empty session first
        const createRes = await apiClient.post('/session', { question: userText })
        currentSessionId = createRes.data.session.id
        setSessionId(currentSessionId)

        // Replace the auto-created plain message with the file message
        // by removing the first message and uploading with file
        const formData = new FormData()
        formData.append('file', file)
        formData.append('question', userText)
        formData.append('replace_last', 'true')

        await apiClient.post(`/session/${currentSessionId}/upload-file`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } else {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('question', userText)

        await apiClient.post(`/session/${currentSessionId}/upload-file`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }

      await streamResponse(currentSessionId)
      await fetchSessions()
    } catch (error) {
      if (error.name === 'AbortError') return
      console.error('Error:', error)
      setMessages((prev) => [
        ...prev,
        { role: 'error', content: error.response?.data?.detail || error.message },
      ])
    } finally {
      setLoading(false)
      setCurrentStep('')
    }
  }

  const startNewChat = () => {
    // Cancel any in-flight stream so it doesn't append into the new chat
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setMessages([])
    setQuestion('')
    setLoading(false)
    setCurrentStep('')
    setSessionId(null)
    setSessionLoadError(null)
    setIsLoadingSession(false)
  }

  const exportSession = async () => {
    if (!sessionId) return

    try {
      const res = await apiClient.get(`/session/${sessionId}`)
      const session = res.data.session

      let markdown = `# Chat Session\n\n`
      markdown += `**Title:** ${session.title || 'Untitled'}\n\n`
      markdown += `---\n\n`

      for (const msg of session.messages || []) {
        if (msg.role === 'user') {
          markdown += `### You\n\n${msg.content}\n\n`
        } else if (msg.role === 'assistant') {
          const label = msg.model_name || 'Assistant'
          markdown += `### ${label}\n\n${msg.content}\n\n`
        }
      }

      markdown += `\n*Exported from Cortex*`

      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chat-${session.title?.slice(0, 30).replace(/[^a-z0-9]/gi, '-') || sessionId}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting session:', error)
    }
  }

  const hasMessages = messages.length > 0

  return {
    question,
    setQuestion,
    messages,
    loading,
    currentStep,
    hasMessages,
    sessionId,
    sessions,
    startChat,
    sendFileMessage,
    startNewChat,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    fetchSessions,
    branchSession,
    shareSession,
    unshareSession,
    getShareInfo,
    exportSession,
    sessionLoadError,
    isLoadingSession,
    quotedText,
    setQuotedText,
  }
}

export default useCouncil
