import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import {
  ArtifactPanel,
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
import './App.css'

function App() {
  const { sessionId: urlSessionId } = useParams()
  const navigate = useNavigate()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const {
    sidebarOpen,
    toggleSidebar,
    closeSidebarOnMobile,
    rightPanelOpen,
    setRightPanelOpen,
    toggleRightPanel,
  } = useOutletContext<any>()
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
    branchSession,
    shareSession,
    exportSession,
    sessionLoadError,
    isLoadingSession,
  } = useCouncil() as any

  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Get current session title for top bar
  const currentSession = sessions.find((s: any) => s.id === sessionId)
  const sessionTitle = currentSession?.title || currentSession?.question?.substring(0, 50) || ''

  useEffect(() => {
    const runAutoDeleteCleanup = async () => {
      try {
        const lastCleanup = localStorage.getItem('lastAutoDeleteCleanup')
        const oneDayMs = 24 * 60 * 60 * 1000
        if (lastCleanup && Date.now() - parseInt(lastCleanup, 10) < oneDayMs) {
          return
        }
        await (await import('./config/api')).apiClient.post('/sessions/cleanup')
        localStorage.setItem('lastAutoDeleteCleanup', Date.now().toString())
      } catch (error: any) {
        console.debug('Auto-delete cleanup:', error.response?.data?.message || 'skipped')
      }
    }
    runAutoDeleteCleanup()
  }, [])

  const handleNewChat = () => {
    startNewChat()
    navigate('/')
  }

  const handleBranch = async (messageIndex: number) => {
    if (!sessionId) return
    try {
      const newId = await branchSession(sessionId, messageIndex)
      navigate(`/sessions/${newId}`)
    } catch {
      // Error already logged in hook
    }
  }

  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      loadSession(urlSessionId)
    }
  }, [urlSessionId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')
      ) {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleNewChat, toggleSidebar])

  return (
    <div className={`chat-app ${sidebarOpen ? 'sidebar-visible' : ''} ${rightPanelOpen ? 'right-panel-visible' : ''}`}>
      <div className="chat-body">
        {sidebarOpen && <div className="sidebar-overlay" onClick={toggleSidebar} />}
        <Sidebar
          isOpen={sidebarOpen}
          sessions={sessions}
          currentSessionId={sessionId}
          onDeleteSession={deleteSession}
          onRenameSession={renameSession}
          onTogglePinSession={togglePinSession}
          onShareSession={shareSession}
          onClose={toggleSidebar}
          onCloseMobile={closeSidebarOnMobile}
          onNewChat={handleNewChat}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        <div className="chat-content">
          <TopBar
            onNewChat={handleNewChat}
            onToggleSidebar={toggleSidebar}
            sidebarOpen={sidebarOpen}
            onToggleRightPanel={toggleRightPanel}
            rightPanelOpen={rightPanelOpen}
            hasSession={!!sessionId}
            sessionTitle={sessionTitle}
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
              onBranch={handleBranch}
            />
          )}
        </div>

        <ArtifactPanel
          sessionId={sessionId}
          isOpen={rightPanelOpen}
          onClose={() => setRightPanelOpen(false)}
        />
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
