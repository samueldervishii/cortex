import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import {
  TopBar,
  WelcomeScreen,
  ChatMessages,
  ChatSkeleton,
  Sidebar,
  CommandPalette,
  PWAInstallPrompt,
} from './components'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal'
import useCouncil from './hooks/useCouncil'
import useTheme from './hooks/useTheme'
import { apiClient } from './config/api'
import './App.css'

function App() {
  const { sessionId: urlSessionId } = useParams()
  const navigate = useNavigate()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const { sidebarOpen, toggleSidebar, closeSidebarOnMobile } = useOutletContext()
  const {
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
    shareSession,
    exportSession,
    sessionLoadError,
    isLoadingSession,
  } = useCouncil()

  const { theme, toggleTheme } = useTheme()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Load user settings on mount and trigger auto-delete cleanup
  useEffect(() => {
    const runAutoDeleteCleanup = async () => {
      try {
        const lastCleanup = localStorage.getItem('lastAutoDeleteCleanup')
        const oneDayMs = 24 * 60 * 60 * 1000
        if (lastCleanup && Date.now() - parseInt(lastCleanup, 10) < oneDayMs) {
          return
        }
        await apiClient.post('/sessions/cleanup')
        localStorage.setItem('lastAutoDeleteCleanup', Date.now().toString())
      } catch (error) {
        console.debug('Auto-delete cleanup:', error.response?.data?.message || 'skipped')
      }
    }
    runAutoDeleteCleanup()
  }, [])

  const handleNewChat = () => {
    startNewChat()
    navigate('/')
  }

  // Load session from URL if present
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      loadSession(urlSessionId)
    }
  }, [urlSessionId])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }
      if (e.altKey && e.key === 'n') {
        e.preventDefault()
        handleNewChat()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
      if (e.altKey && e.key === 's') {
        e.preventDefault()
        toggleSidebar()
      }
      if (
        e.key === '?' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      ) {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleNewChat, toggleSidebar])

  return (
    <div className="chat-app">
      <TopBar
        onNewChat={handleNewChat}
        onToggleSidebar={toggleSidebar}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      <div className="chat-body">
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
              onClose={toggleSidebar}
              onCloseMobile={closeSidebarOnMobile}
              onNewChat={handleNewChat}
            />
          </>
        )}

        <div className="chat-content">
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
              onSubmit={startChat}
              onFileUpload={sendFileMessage}
              loading={loading}
            />
          ) : (
            <ChatMessages
              messages={messages}
              loading={loading}
              currentStep={currentStep}
              question={question}
              onQuestionChange={setQuestion}
              onSubmit={startChat}
              onFileUpload={sendFileMessage}
              sessionId={sessionId}
            />
          )}
        </div>
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        sessions={sessions}
        onNewChat={handleNewChat}
        onExport={exportSession}
        currentSessionId={sessionId}
      />

      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <PWAInstallPrompt />
    </div>
  )
}

export default App
