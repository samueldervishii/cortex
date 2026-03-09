import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '../config/api'
import { roundToMessages } from '../utils'

function useCouncil() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState('')
  const [appLoading, setAppLoading] = useState(true)
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionLoadError, setSessionLoadError] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [mode, setMode] = useState(() => {
    // Load mode from localStorage or default to 'formal'
    const savedMode = localStorage.getItem('llm-council-mode')
    return savedMode || 'formal'
  })
  const [availableModels, setAvailableModels] = useState([])
  const [selectedModels, setSelectedModels] = useState(() => {
    // Load selected models from localStorage
    const saved = localStorage.getItem('llm-council-selected-models')
    return saved ? JSON.parse(saved) : []
  })
  const [folders, setFolders] = useState([])

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

  // Fetch available models on mount
  const fetchModels = useCallback(async () => {
    try {
      const res = await apiClient.get('/models')
      const models = res.data.models
      setAvailableModels(models)

      const validModelIds = models.map((m) => m.id)
      const savedModels = localStorage.getItem('llm-council-selected-models')

      if (savedModels) {
        // Filter out any invalid/old model IDs from cache
        const parsed = JSON.parse(savedModels)
        const validSavedModels = parsed.filter((id) => validModelIds.includes(id))

        if (validSavedModels.length !== parsed.length) {
          // Some models were invalid, update localStorage
          console.log('Removed invalid cached model IDs')
          localStorage.setItem('llm-council-selected-models', JSON.stringify(validSavedModels))
        }

        // If all cached models were invalid, select all available
        if (validSavedModels.length === 0) {
          setSelectedModels(validModelIds)
          localStorage.setItem('llm-council-selected-models', JSON.stringify(validModelIds))
        } else {
          setSelectedModels(validSavedModels)
        }
      } else {
        // No saved models, select all by default
        setSelectedModels(validModelIds)
        localStorage.setItem('llm-council-selected-models', JSON.stringify(validModelIds))
      }
    } catch (error) {
      console.error('Error fetching models:', error)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppLoading(false)
      fetchModels()
    }, 2000)
    return () => clearTimeout(timer)
  }, [fetchModels])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiClient.get('/sessions')
      setSessions(res.data.sessions)
    } catch (error) {
      console.error('Error fetching sessions:', error)
    }
  }, [])

  const fetchFolders = useCallback(async () => {
    try {
      const res = await apiClient.get('/folders')
      setFolders(res.data.folders)
    } catch (error) {
      console.error('Error fetching folders:', error)
    }
  }, [])

  const createFolder = async (name, color = null, icon = null) => {
    try {
      const res = await apiClient.post('/folders', { name, color, icon })
      await fetchFolders()
      return res.data.folder
    } catch (error) {
      console.error('Error creating folder:', error)
      throw error
    }
  }

  const updateFolder = async (folderId, updates) => {
    try {
      await apiClient.patch(`/folders/${folderId}`, updates)
      await fetchFolders()
    } catch (error) {
      console.error('Error updating folder:', error)
      throw error
    }
  }

  const deleteFolder = async (folderId) => {
    try {
      await apiClient.delete(`/folders/${folderId}`)
      await fetchFolders()
      await fetchSessions() // Refresh sessions as they may have been moved out of folder
    } catch (error) {
      console.error('Error deleting folder:', error)
      throw error
    }
  }

  const moveSessionToFolder = async (targetSessionId, targetFolderId) => {
    try {
      await apiClient.patch(`/session/${targetSessionId}/folder`, { folder_id: targetFolderId })
      await fetchSessions()
    } catch (error) {
      console.error('Error moving session to folder:', error)
      throw error
    }
  }

  useEffect(() => {
    if (!appLoading) {
      fetchSessions()
      fetchFolders()
    }
  }, [appLoading, fetchSessions, fetchFolders])

  const addMessage = (type, content, modelName = null, extras = {}) => {
    setMessages((prev) => [...prev, { type, content, modelName, timestamp: new Date(), ...extras }])
  }

  const loadSession = async (id) => {
    const startTime = Date.now()
    const minLoadingTime = 2000 // Show loader for minimum 15 seconds (FOR TESTING)

    try {
      setIsLoadingSession(true)
      setSessionLoadError(null)
      setLoading(true)
      setCurrentStep('Loading session...')

      // Create a timeout promise (30 seconds for Render cold starts)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 30000)
      )

      // Race between the API call and the timeout
      const res = await Promise.race([apiClient.get(`/session/${id}`), timeoutPromise])

      const session = res.data.session

      setSessionId(session.id)
      const loadedMessages = []

      // Load all rounds
      if (session.rounds && session.rounds.length > 0) {
        for (const round of session.rounds) {
          loadedMessages.push(...roundToMessages(round))
        }
      }

      // Ensure minimum loading time for better UX
      const elapsedTime = Date.now() - startTime
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime)

      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime))
      }

      setMessages(loadedMessages)
      setSidebarOpen(false)
      setSessionLoadError(null)
    } catch (error) {
      console.error('Error loading session:', error)

      // Ensure minimum loading time even for errors
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
      // Find current pin status
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
      setSessionId(null) // Read-only mode
      return session
    } catch (error) {
      console.error('Error loading shared session:', error)
      throw error
    } finally {
      setLoading(false)
      setCurrentStep('')
    }
  }

  const startCouncil = async () => {
    if (!question.trim()) return

    const userQuestion = question
    setQuestion('')
    setLoading(true)

    addMessage('user', userQuestion)

    try {
      let currentSessionId = sessionId

      // Determine the mode to use
      let activeMode = mode

      // If we have an existing session, continue it; otherwise create new
      if (currentSessionId) {
        setCurrentStep('Continuing conversation...')
        const continueRes = await apiClient.post(`/session/${currentSessionId}/continue`, {
          question: userQuestion,
        })
        // Get the mode from the session (inherit from first round)
        const session = continueRes.data.session
        activeMode = session.rounds[0]?.mode || mode
      } else {
        setCurrentStep('Creating session...')
        const createRes = await apiClient.post('/query', {
          question: userQuestion,
          mode: mode,
          selected_models: selectedModels.length > 0 ? selectedModels : null,
        })
        currentSessionId = createRes.data.session.id
        setSessionId(currentSessionId)
        activeMode = mode
      }

      if (activeMode === 'chat') {
        // Detect @mention in user message to target a specific model
        const mentionMatch = userQuestion.match(/@(Claude Sonnet 4\.6|Claude Haiku 4\.5|GPT OSS 120B|GPT OSS 20B|Qwen 3 32B)/)
        const targetModel = mentionMatch ? mentionMatch[1] : null

        // Chat mode: use run-all for group chat
        setCurrentStep(targetModel ? `${targetModel} is typing...` : 'Models are typing...')

        const requestBody = targetModel ? { target_model: targetModel } : {}
        const chatRes = await apiClient.post(`/session/${currentSessionId}/run-all`, requestBody)
        const session = chatRes.data.session
        const currentRound = session.rounds[session.rounds.length - 1]

        // Each round's chat_messages contains only the messages from that round
        // For targeted @mentions, it's just 1 message; for full rounds, all model responses
        const newMessages = currentRound.chat_messages

        // Add new chat messages one by one with delay for visual effect
        for (let i = 0; i < newMessages.length; i++) {
          const chatMsg = newMessages[i]
          setCurrentStep(`${chatMsg.model_name} is typing...`)

          // Small delay between messages for natural feel
          await new Promise((resolve) => setTimeout(resolve, 400))

          setMessages((prev) => [
            ...prev,
            {
              type: 'chat',
              content: chatMsg.content,
              modelName: chatMsg.model_name,
              replyTo: chatMsg.reply_to,
              responseTime: chatMsg.response_time_ms,
              timestamp: new Date(),
            },
          ])
        }
      } else {
        // Formal mode: traditional 3-step process
        setCurrentStep('Council is thinking...')
        addMessage('system', 'Gathering responses from the council...')

        const responsesRes = await apiClient.post(`/session/${currentSessionId}/responses`)
        const session = responsesRes.data.session
        const currentRound = session.rounds[session.rounds.length - 1]

        for (const resp of currentRound.responses) {
          if (resp.error) {
            addMessage('error', `Error: ${resp.error}`, resp.model_name)
          } else {
            addMessage('council', resp.response, resp.model_name, {
              responseTime: resp.response_time_ms,
            })
          }
        }

        setCurrentStep('Council is reviewing...')
        await apiClient.post(`/session/${currentSessionId}/reviews`)

        setCurrentStep('Council Head is deciding...')
        addMessage('system', 'Claude Sonnet 4.6 is reviewing all responses...')

        const synthesisRes = await apiClient.post(`/session/${currentSessionId}/synthesize`)
        const finalSession = synthesisRes.data.session
        const finalRound = finalSession.rounds[finalSession.rounds.length - 1]

        addMessage('chairman', finalRound.final_synthesis, 'Claude Sonnet 4.6 (Head)')
      }

      // Refresh sessions list
      await fetchSessions()
    } catch (error) {
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

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev)
  }

  const toggleModel = (modelId) => {
    setSelectedModels((prev) => {
      if (prev.includes(modelId)) {
        // Don't allow deselecting if only one model left
        if (prev.length <= 1) return prev
        return prev.filter((id) => id !== modelId)
      }
      return [...prev, modelId]
    })
  }

  const selectAllModels = () => {
    // Check if all models are currently selected
    const allSelected =
      availableModels.length > 0 && availableModels.every((m) => selectedModels.includes(m.id))

    if (allSelected) {
      // Deselect all (but keep at least one - the chairman)
      const chairman = availableModels.find((m) => m.is_chairman)
      setSelectedModels(chairman ? [chairman.id] : [availableModels[0]?.id])
    } else {
      // Select all
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

      // Create and download file
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
    sidebarOpen,
    mode,
    setMode,
    availableModels,
    selectedModels,
    toggleModel,
    selectAllModels,
    startCouncil,
    startNewChat,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    toggleSidebar,
    fetchSessions,
    shareSession,
    unshareSession,
    getShareInfo,
    loadSharedSession,
    exportSession,
    sessionLoadError,
    isLoadingSession,
    // Folder management
    folders,
    createFolder,
    updateFolder,
    deleteFolder,
    moveSessionToFolder,
  }
}

export default useCouncil
