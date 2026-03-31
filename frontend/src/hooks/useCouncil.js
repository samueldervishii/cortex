import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, API_BASE, API_KEY, getAccessToken } from '../config/api'

/**
 * Parse SSE events from a ReadableStream.
 * Yields { event, data } objects for each SSE event.
 */
async function* parseSSE(reader) {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    let currentEvent = null
    let currentData = null

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

function useCouncil() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState(cachedSessions || [])
  const [sessionLoadError, setSessionLoadError] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)

  // AbortController ref — used to cancel in-flight SSE streams on unmount
  // or when the user starts a new request before the previous one finishes.
  const abortControllerRef = useRef(null)

  // Cleanup: abort any in-flight stream when the component using this hook unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
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
      }))

      const elapsedTime = Date.now() - startTime
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime)

      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime))
      }

      setMessages(loadedMessages)
      setSessionLoadError(null)
    } catch (error) {
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
      setIsLoadingSession(false)
      setLoading(false)
      setCurrentStep('')
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
      body: '{}',
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Stream failed' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()

    // Index of the streaming assistant message
    let streamingIndex = null
    let isArtifact = false

    for await (const { event, data } of parseSSE(reader)) {
      switch (event) {
        case 'artifact_hint':
          isArtifact = true
          break

        case 'message_start':
          setCurrentStep('')
          setMessages((prev) => {
            streamingIndex = prev.length
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
          setMessages((prev) => {
            if (streamingIndex === null) return prev
            const updated = [...prev]
            updated[streamingIndex] = {
              ...updated[streamingIndex],
              content: updated[streamingIndex].content + (data.content || data.token || ''),
            }
            return updated
          })
          break

        case 'message_end':
          setMessages((prev) => {
            if (streamingIndex === null) return prev
            const updated = [...prev]
            updated[streamingIndex] = {
              ...updated[streamingIndex],
              content: data.content || updated[streamingIndex].content,
              streaming: false,
              ...(data.response_time_ms && { responseTime: data.response_time_ms }),
            }
            return updated
          })
          streamingIndex = null
          break

        case 'error':
          setMessages((prev) => [
            ...prev,
            { role: 'error', content: data.message || 'An error occurred' },
          ])
          break

        case 'done':
          break
      }
    }

    // Stream finished normally — clear the ref so we don't abort a completed stream
    abortControllerRef.current = null
  }

  const startChat = async () => {
    if (!question.trim()) return

    const userQuestion = question
    setQuestion('')
    setLoading(true)

    setMessages((prev) => [...prev, { role: 'user', content: userQuestion }])

    try {
      let currentSessionId = sessionId

      if (currentSessionId) {
        // Continue existing session
        setCurrentStep('Continuing conversation...')
        await apiClient.post(`/session/${currentSessionId}/continue`, {
          question: userQuestion,
        })
      } else {
        // Create new session
        setCurrentStep('Creating session...')
        const createRes = await apiClient.post('/session', {
          question: userQuestion,
        })
        currentSessionId = createRes.data.session.id
        setSessionId(currentSessionId)
      }

      setCurrentStep('Assistant is typing...')
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

    try {
      let currentSessionId = sessionId

      if (!currentSessionId) {
        // Create an empty session first
        setCurrentStep('Creating session...')
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

      setCurrentStep('')
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
    shareSession,
    unshareSession,
    getShareInfo,
    exportSession,
    sessionLoadError,
    isLoadingSession,
  }
}

export default useCouncil
