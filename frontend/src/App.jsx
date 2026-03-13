import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AppLoader,
  TopBar,
  WelcomeScreen,
  ChatMessages,
  ChatSkeleton,
  Sidebar,
  CommandPalette,
  IncognitoChat,
  PWAInstallPrompt,
} from './components'
import useCouncil from './hooks/useCouncil'
import useTheme from './hooks/useTheme'
import { apiClient } from './config/api'
import './App.css'

function App() {
  const { sessionId: urlSessionId } = useParams()
  const navigate = useNavigate()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const {
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
    shareSession,
    exportSession,
    sessionLoadError,
    isLoadingSession,
    // System prompt
    systemPrompt,
    setSystemPrompt,
    // Folder management
    folders,
    createFolder,
    updateFolder,
    deleteFolder,
    moveSessionToFolder,
  } = useCouncil()

  const { theme, toggleTheme } = useTheme()
  const [userSettings, setUserSettings] = useState({ enabled_beta_features: [], branching_enabled: true, custom_prompts_enabled: true })
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' })
  const [isIncognitoOpen, setIsIncognitoOpen] = useState(false)
  const [konamiActive, setKonamiActive] = useState(false)
  const konamiBuffer = useRef([])

  // Konami Code easter egg
  const KONAMI_CODE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']

  const handleKonami = useCallback(() => {
    setKonamiActive(true)
    setSystemPrompt('Respond as a dramatic pirate captain. Use pirate slang, say "arrr" and "ye", reference treasure, the sea, and your ship. Be theatrical but still answer the question. Keep it fun!')
    setTimeout(() => setKonamiActive(false), 30000) // Lasts 30 seconds
  }, [setSystemPrompt])

  useEffect(() => {
    const handleKonamiKey = (e) => {
      konamiBuffer.current.push(e.key)
      konamiBuffer.current = konamiBuffer.current.slice(-10)
      if (konamiBuffer.current.length === 10 &&
          konamiBuffer.current.every((k, i) => k === KONAMI_CODE[i])) {
        handleKonami()
        konamiBuffer.current = []
      }
    }
    window.addEventListener('keydown', handleKonamiKey)
    return () => window.removeEventListener('keydown', handleKonamiKey)
  }, [handleKonami])

  // Load user settings on mount and trigger auto-delete cleanup
  useEffect(() => {
    const loadUserSettings = async () => {
      try {
        const res = await apiClient.get('/settings')
        setUserSettings(res.data.settings)
      } catch (error) {
        console.error('Failed to load user settings:', error)
      }
    }

    const runAutoDeleteCleanup = async () => {
      try {
        // Only run cleanup once per day to avoid deleting recently-unpinned sessions
        const lastCleanup = localStorage.getItem('lastAutoDeleteCleanup')
        const oneDayMs = 24 * 60 * 60 * 1000
        if (lastCleanup && Date.now() - parseInt(lastCleanup, 10) < oneDayMs) {
          return
        }
        await apiClient.post('/sessions/cleanup')
        localStorage.setItem('lastAutoDeleteCleanup', Date.now().toString())
      } catch (error) {
        // Silently ignore cleanup errors - not critical for user experience
        console.debug('Auto-delete cleanup:', error.response?.data?.message || 'skipped')
      }
    }

    loadUserSettings()
    runAutoDeleteCleanup()
  }, [])

  // Handle new chat navigation
  const handleNewChat = () => {
    startNewChat()
    navigate('/')
  }

  // Handle branch session
  const handleBranch = async (fromRoundIndex = null) => {
    if (!sessionId) return
    try {
      const res = await apiClient.post(`/session/${sessionId}/branch`, {
        from_round_index: fromRoundIndex,
      })
      // Navigate to new branched session (response has session inside)
      const newSessionId = res.data.session?.id || res.data.id
      navigate(`/sessions/${newSessionId}`)
      loadSession(newSessionId)
    } catch (error) {
      console.error('Failed to branch session:', error)
      setErrorModal({
        open: true,
        title: 'Failed to Create Branch',
        message:
          error.response?.data?.detail ||
          'An error occurred while creating the branch. Please try again.',
      })
    }
  }

  // Handle branch from sidebar (specific session)
  const handleBranchFromSidebar = async (targetSessionId) => {
    try {
      const res = await apiClient.post(`/session/${targetSessionId}/branch`, {
        from_round_index: null, // Branch from current state
      })
      const newSessionId = res.data.session?.id || res.data.id
      navigate(`/sessions/${newSessionId}`)
      loadSession(newSessionId)
      toggleSidebar() // Close sidebar after branching
    } catch (error) {
      console.error('Failed to branch session:', error)
      setErrorModal({
        open: true,
        title: 'Failed to Create Branch',
        message:
          error.response?.data?.detail ||
          'An error occurred while creating the branch. Please try again.',
      })
    }
  }

  // Load session from URL if present
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId && !appLoading) {
      loadSession(urlSessionId)
    }
  }, [urlSessionId, appLoading])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K or Cmd+K for command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }
      // Ctrl+/ or Cmd+/ for command palette (alternative)
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }
      // Alt+N for new chat
      if (e.altKey && e.key === 'n') {
        e.preventDefault()
        handleNewChat()
        return
      }
      // Ctrl+\ or Cmd+\ for toggle sidebar (like VS Code)
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
      // Alt+S as alternative for sidebar
      if (e.altKey && e.key === 's') {
        e.preventDefault()
        toggleSidebar()
      }
      // Alt+I for incognito mode
      if (e.altKey && e.key === 'i') {
        e.preventDefault()
        setIsIncognitoOpen(true)
      }
    }
    // Use capture phase to ensure we get the event before browser
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleNewChat, toggleSidebar])

  if (appLoading) {
    return <AppLoader />
  }

  return (
    <div className="chat-app">
      {sidebarOpen && (
        <>
          <div className="sidebar-overlay" onClick={toggleSidebar} />
          <Sidebar
            sessions={sessions}
            currentSessionId={sessionId}
            onDeleteSession={deleteSession}
            onRenameSession={renameSession}
            onTogglePinSession={togglePinSession}
            onShareSession={shareSession}
            onBranchSession={handleBranchFromSidebar}
            branchingEnabled={userSettings.branching_enabled !== false}
            onClose={toggleSidebar}
            onNewChat={() => {
              handleNewChat()
              toggleSidebar()
            }}
            folders={folders}
            onCreateFolder={createFolder}
            onUpdateFolder={updateFolder}
            onDeleteFolder={deleteFolder}
            onMoveSessionToFolder={moveSessionToFolder}
          />
        </>
      )}

      <TopBar
        onNewChat={handleNewChat}
        onToggleSidebar={toggleSidebar}
        sessionId={sessionId}
        onShare={shareSession}
        onExport={exportSession}
        onBranch={handleBranch}
        branchingEnabled={userSettings.branching_enabled !== false}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenIncognito={() => setIsIncognitoOpen(true)}
      />

      {isLoadingSession ? (
        <ChatSkeleton />
      ) : sessionLoadError ? (
        <div className="session-load-error">
          <h2>Something went wrong</h2>
          <p>{sessionLoadError}</p>
          <button onClick={handleNewChat}>Go to Home</button>
        </div>
      ) : !hasMessages ? (
        <WelcomeScreen
          question={question}
          onQuestionChange={setQuestion}
          onSubmit={startCouncil}
          loading={loading}
          {...(userSettings.custom_prompts_enabled !== false && {
            systemPrompt,
            onSystemPromptChange: setSystemPrompt,
          })}
        />
      ) : (
        <ChatMessages
          messages={messages}
          loading={loading}
          currentStep={currentStep}
          question={question}
          onQuestionChange={setQuestion}
          onSubmit={startCouncil}
          mode={mode}
          {...(userSettings.custom_prompts_enabled !== false && {
            systemPrompt,
            onSystemPromptChange: setSystemPrompt,
          })}
        />
      )}

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        sessions={sessions}
        onNewChat={handleNewChat}
        onExport={exportSession}
        currentSessionId={sessionId}
      />

      {errorModal.open && (
        <div
          className="delete-modal-overlay"
          onClick={() => setErrorModal({ open: false, title: '', message: '' })}
        >
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-icon error">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3>{errorModal.title}</h3>
            <p>{errorModal.message}</p>
            <div className="delete-modal-actions">
              <button
                className="delete-cancel"
                onClick={() => setErrorModal({ open: false, title: '', message: '' })}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <IncognitoChat
        isOpen={isIncognitoOpen}
        onClose={() => setIsIncognitoOpen(false)}
        availableModels={availableModels}
        selectedModels={selectedModels}
      />

      <PWAInstallPrompt />

      {konamiActive && (
        <div className="konami-toast">
          <span className="konami-icon">&#x1F3F4;&#x200D;&#x2620;&#xFE0F;</span>
          Pirate Mode Activated! Arrr!
        </div>
      )}
    </div>
  )
}

export default App
