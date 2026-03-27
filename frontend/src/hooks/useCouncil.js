import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, API_BASE, API_KEY } from '../config/api'
import { roundToMessages } from '../utils'

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

// Module-level caches: avoid re-fetching on page navigation (component remounts)
let cachedModels = null
let cachedSessions = null

function useCouncil() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState('')
  const [appLoading, setAppLoading] = useState(!cachedModels)
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState(cachedSessions || [])
  const [sessionLoadError, setSessionLoadError] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [mode, setMode] = useState(() => {
    const savedMode = localStorage.getItem('llm-council-mode')
    return savedMode || 'formal'
  })
  const [availableModels, setAvailableModels] = useState(cachedModels || [])
  const [selectedModels, setSelectedModels] = useState(() => {
    const saved = localStorage.getItem('llm-council-selected-models')
    return saved ? JSON.parse(saved) : []
  })
  const [systemPrompt, setSystemPrompt] = useState(() => {
    return localStorage.getItem('llm-council-system-prompt') || ''
  })
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    return localStorage.getItem('llm-council-language') || ''
  })

  // AbortController ref — used to cancel in-flight SSE streams on unmount
  // or when the user starts a new request before the previous one finishes.
  const abortControllerRef = useRef(null)

  // Persist mode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('llm-council-mode', mode)
  }, [mode])

  // Persist selected models to localStorage when they change
  useEffect(() => {
    if (selectedModels.length > 0) {
      localStorage.setItem('llm-council-selected-models', JSON.stringify(selectedModels))
    }
  }, [selectedModels])

  // Persist system prompt to localStorage
  useEffect(() => {
    localStorage.setItem('llm-council-system-prompt', systemPrompt)
  }, [systemPrompt])

  // Persist selected language to localStorage
  useEffect(() => {
    localStorage.setItem('llm-council-language', selectedLanguage)
  }, [selectedLanguage])

  // Cleanup: abort any in-flight stream when the component using this hook unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Fetch available models on mount
  const fetchModels = useCallback(async () => {
    try {
      const res = await apiClient.get('/models')
      const models = res.data.models
      cachedModels = models
      setAvailableModels(models)

      const validModelIds = models.map((m) => m.id)
      const savedModels = localStorage.getItem('llm-council-selected-models')

      if (savedModels) {
        const parsed = JSON.parse(savedModels)
        const validSavedModels = parsed.filter((id) => validModelIds.includes(id))

        if (validSavedModels.length !== parsed.length) {
          console.log('Removed invalid cached model IDs')
          localStorage.setItem('llm-council-selected-models', JSON.stringify(validSavedModels))
        }

        if (validSavedModels.length === 0) {
          setSelectedModels(validModelIds)
          localStorage.setItem('llm-council-selected-models', JSON.stringify(validModelIds))
        } else {
          setSelectedModels(validSavedModels)
        }
      } else {
        setSelectedModels(validModelIds)
        localStorage.setItem('llm-council-selected-models', JSON.stringify(validModelIds))
      }
    } catch (error) {
      console.error('Error fetching models:', error)
    }
  }, [])

  // Fetch models immediately on mount — hide the app loader once done
  // Also set a max wait so the UI renders even if the backend is slow/down
  // Skip the loading phase entirely if models are already cached (page navigation)
  useEffect(() => {
    if (cachedModels) {
      setAppLoading(false)
      fetchModels() // refresh in background
      return
    }
    const maxWait = setTimeout(() => setAppLoading(false), 3000)
    fetchModels().finally(() => {
      clearTimeout(maxWait)
      setAppLoading(false)
    })
    return () => clearTimeout(maxWait)
  }, [fetchModels])

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
    if (!appLoading && !cachedSessions) {
      fetchSessions()
    }
  }, [appLoading, fetchSessions])

  const addMessage = (type, content, modelName = null, extras = {}) => {
    setMessages((prev) => [...prev, { type, content, modelName, timestamp: new Date(), ...extras }])
  }

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
      const loadedMessages = []

      if (session.rounds && session.rounds.length > 0) {
        for (const round of session.rounds) {
          loadedMessages.push(...roundToMessages(round))
        }
      }

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

  const loadSharedSession = async (shareToken) => {
    try {
      setLoading(true)
      setCurrentStep('Loading shared session...')
      const res = await apiClient.get(`/shared/${shareToken}`)
      const session = res.data.session

      const loadedMessages = []
      if (session.rounds && session.rounds.length > 0) {
        for (const round of session.rounds) {
          loadedMessages.push(...roundToMessages(round))
        }
      }

      setMessages(loadedMessages)
      setSessionId(null)
      return session
    } catch (error) {
      console.error('Error loading shared session:', error)
      throw error
    } finally {
      setLoading(false)
      setCurrentStep('')
    }
  }

  /**
   * Stream SSE events from the /session/{id}/stream endpoint.
   * Uses native fetch() since EventSource only supports GET.
   * Handles token-level streaming for real-time typing effect.
   */
  const streamCouncil = async (currentSessionId, targetModel = null) => {
    // Cancel any in-flight stream before starting a new one.
    // This prevents concurrent streams from interleaving tokens into the wrong messages.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    const headers = { 'Content-Type': 'application/json' }
    if (API_KEY) headers['X-API-Key'] = API_KEY

    const body = targetModel ? JSON.stringify({ target_model: targetModel }) : '{}'

    const response = await fetch(`${API_BASE}/session/${currentSessionId}/stream`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Stream failed' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()

    // Track streaming message indices by model_id so tokens append to the right message
    const streamingIndices = {}

    for await (const { event, data } of parseSSE(reader)) {
      switch (event) {
        case 'step':
          setCurrentStep(data.message)
          if (data.step === 'responses') {
            addMessage('system', 'Gathering responses from the council...')
          } else if (data.step === 'synthesis') {
            addMessage('system', 'Claude Sonnet 4.6 is reviewing all responses...')
          } else if (data.step === 'eli5') {
            addMessage('system', 'Generating explanations at multiple complexity levels...')
          }
          break

        // --- Token-level formal mode events ---
        case 'response_start':
          setCurrentStep(`${data.model_name} is typing...`)
          setMessages((prev) => {
            const idx = prev.length
            streamingIndices[data.model_id] = idx
            return [
              ...prev,
              {
                type: 'council',
                content: '',
                modelName: data.model_name,
                streaming: true,
                timestamp: new Date(),
              },
            ]
          })
          break

        case 'response_token':
          setMessages((prev) => {
            const idx = streamingIndices[data.model_id]
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              content: updated[idx].content + data.token,
            }
            return updated
          })
          break

        case 'response_end':
          setMessages((prev) => {
            const idx = streamingIndices[data.model_id]
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              streaming: false,
              responseTime: data.response_time_ms,
            }
            return updated
          })
          delete streamingIndices[data.model_id]
          break

        case 'error_response':
          addMessage('error', `Error: ${data.error}`, data.model_name)
          break

        // --- ELI5 Ladder events ---
        case 'eli5_level_start':
          setCurrentStep(`Generating ${data.label} explanation...`)
          setMessages((prev) => {
            streamingIndices[data.level] = prev.length
            return [
              ...prev,
              {
                type: 'eli5',
                content: '',
                modelName: data.model_name,
                level: data.level,
                levelLabel: data.label,
                streaming: true,
                timestamp: new Date(),
              },
            ]
          })
          break

        case 'eli5_level_token':
          setMessages((prev) => {
            const idx = streamingIndices[data.level]
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], content: updated[idx].content + data.token }
            return updated
          })
          break

        case 'eli5_level_end':
          setMessages((prev) => {
            const idx = streamingIndices[data.level]
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              streaming: false,
              responseTime: data.response_time_ms,
            }
            return updated
          })
          delete streamingIndices[data.level]
          break

        // --- Token-level synthesis events ---
        case 'synthesis_start':
          setMessages((prev) => {
            streamingIndices['__synthesis__'] = prev.length
            return [
              ...prev,
              {
                type: 'chairman',
                content: '',
                modelName: 'Claude Sonnet 4.6 (Head)',
                streaming: true,
                timestamp: new Date(),
              },
            ]
          })
          break

        case 'synthesis_token':
          setMessages((prev) => {
            const idx = streamingIndices['__synthesis__']
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              content: updated[idx].content + data.token,
            }
            return updated
          })
          break

        case 'synthesis_end':
          setMessages((prev) => {
            const idx = streamingIndices['__synthesis__']
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], streaming: false }
            return updated
          })
          delete streamingIndices['__synthesis__']
          break

        // --- Token-level chat mode events ---
        case 'chat_message_start':
          setCurrentStep(`${data.model_name} is typing...`)
          setMessages((prev) => {
            streamingIndices[data.model_id] = prev.length
            return [
              ...prev,
              {
                type: 'chat',
                content: '',
                modelName: data.model_name,
                streaming: true,
                timestamp: new Date(),
              },
            ]
          })
          break

        case 'chat_message_token':
          setMessages((prev) => {
            const idx = streamingIndices[data.model_id]
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              content: updated[idx].content + data.token,
            }
            return updated
          })
          break

        case 'chat_message_end':
          setMessages((prev) => {
            const idx = streamingIndices[data.model_id]
            if (idx === undefined) return prev
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              content: data.content,
              replyTo: data.reply_to,
              responseTime: data.response_time_ms,
              streaming: false,
            }
            return updated
          })
          delete streamingIndices[data.model_id]
          break

        // --- Legacy (non-streaming) fallbacks ---
        case 'response':
          setMessages((prev) => [
            ...prev,
            {
              type: 'council',
              content: data.response,
              modelName: data.model_name,
              responseTime: data.response_time_ms,
              timestamp: new Date(),
            },
          ])
          break

        case 'synthesis':
          addMessage('chairman', data.content, 'Claude Sonnet 4.6 (Head)')
          break

        case 'chat_message':
          setCurrentStep(`${data.model_name} is typing...`)
          setMessages((prev) => [
            ...prev,
            {
              type: 'chat',
              content: data.content,
              modelName: data.model_name,
              replyTo: data.reply_to,
              responseTime: data.response_time_ms,
              timestamp: new Date(),
            },
          ])
          break

        case 'error':
          addMessage('error', data.message || 'An error occurred')
          break

        case 'done':
          break
      }
    }

    // Stream finished normally — clear the ref so we don't abort a completed stream
    abortControllerRef.current = null
  }

  const startCouncil = async () => {
    if (!question.trim()) return

    const userQuestion = question
    setQuestion('')
    setLoading(true)

    addMessage('user', userQuestion)

    try {
      let currentSessionId = sessionId
      let activeMode = mode

      // If we have an existing session, continue it; otherwise create new
      if (currentSessionId) {
        setCurrentStep('Continuing conversation...')
        const continueRes = await apiClient.post(`/session/${currentSessionId}/continue`, {
          question: userQuestion,
        })
        const session = continueRes.data.session
        activeMode = session.rounds[0]?.mode || mode
      } else {
        setCurrentStep('Creating session...')
        const base = systemPrompt.trim()
        const effectiveSystemPrompt = selectedLanguage
          ? base
            ? `Respond in ${selectedLanguage}.\n\n${base}`
            : `Respond in ${selectedLanguage}.`
          : base || null
        const createRes = await apiClient.post('/query', {
          question: userQuestion,
          mode: mode,
          selected_models: selectedModels.length > 0 ? selectedModels : null,
          system_prompt: effectiveSystemPrompt,
        })
        currentSessionId = createRes.data.session.id
        setSessionId(currentSessionId)
        activeMode = mode
      }

      if (activeMode === 'chat') {
        // Build mention regex dynamically from available models instead of hardcoding names
        const modelNames = availableModels.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        const mentionRegex = modelNames.length > 0 ? new RegExp(`@(${modelNames.join('|')})`) : null
        const mentionMatch = mentionRegex ? userQuestion.match(mentionRegex) : null
        const targetModel = mentionMatch ? mentionMatch[1] : null
        setCurrentStep(targetModel ? `${targetModel} is typing...` : 'Models are typing...')
        await streamCouncil(currentSessionId, targetModel)
      } else {
        setCurrentStep('Council is thinking...')
        await streamCouncil(currentSessionId)
      }

      await fetchSessions()
    } catch (error) {
      // Don't show error messages for intentionally aborted streams
      // (e.g. user submitted a new question or navigated away)
      if (error.name === 'AbortError') return
      console.error('Error:', error)
      addMessage('error', error.response?.data?.detail || error.message)
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
  }

  const toggleModel = (modelId) => {
    setSelectedModels((prev) => {
      if (prev.includes(modelId)) {
        if (prev.length <= 1) return prev
        return prev.filter((id) => id !== modelId)
      }
      return [...prev, modelId]
    })
  }

  const selectAllModels = () => {
    const allSelected =
      availableModels.length > 0 && availableModels.every((m) => selectedModels.includes(m.id))

    if (allSelected) {
      const chairman = availableModels.find((m) => m.is_chairman)
      setSelectedModels(chairman ? [chairman.id] : [availableModels[0]?.id])
    } else {
      setSelectedModels(availableModels.map((m) => m.id))
    }
  }

  const exportSession = async () => {
    if (!sessionId) return

    try {
      const res = await apiClient.get(`/session/${sessionId}`)
      const session = res.data.session

      let markdown = `# LLM Council Session\n\n`
      markdown += `**Title:** ${session.title || 'Untitled'}\n\n`
      markdown += `---\n\n`

      for (let i = 0; i < session.rounds.length; i++) {
        const round = session.rounds[i]
        markdown += `## Round ${i + 1}\n\n`
        markdown += `### Question\n\n${round.question}\n\n`

        if (round.chat_messages && round.chat_messages.length > 0) {
          markdown += `### Group Chat\n\n`
          for (const msg of round.chat_messages) {
            const replyTag = msg.reply_to ? ` *(replying to @${msg.reply_to})*` : ''
            markdown += `**${msg.model_name}**${replyTag}: ${msg.content}\n\n`
          }
        }

        if (round.responses && round.responses.length > 0) {
          markdown += `### Council Responses\n\n`
          for (const resp of round.responses) {
            if (!resp.error) {
              markdown += `#### ${resp.model_name}\n\n${resp.response}\n\n`
            }
          }
        }

        if (round.final_synthesis) {
          markdown += `### Chairman's Synthesis\n\n${round.final_synthesis}\n\n`
        }

        markdown += `---\n\n`
      }

      markdown += `\n*Exported from LLM Council*`

      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `llm-council-${session.title?.slice(0, 30).replace(/[^a-z0-9]/gi, '-') || sessionId}.md`
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
    appLoading,
    hasMessages,
    sessionId,
    sessions,
    mode,
    setMode,
    availableModels,
    selectedModels,
    toggleModel,
    selectAllModels,
    systemPrompt,
    setSystemPrompt,
    selectedLanguage,
    setSelectedLanguage,
    startCouncil,
    startNewChat,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    fetchSessions,
    shareSession,
    unshareSession,
    getShareInfo,
    loadSharedSession,
    exportSession,
    sessionLoadError,
    isLoadingSession,
  }
}

export default useCouncil
