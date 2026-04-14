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
  QuoteReplyPopup,
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
    hasMoreSessions,
    loadingMoreSessions,
    loadMoreSessions,
    ghostMode,
    startChat,
    sendFileMessage,
    startNewChat,
    startGhostChat,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    branchSession,
    shareSession,
    exportSession,
    sessionLoadError,
    isLoadingSession,
    quotedText,
    setQuotedText,
  } = useCouncil() as any

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [selectionPopup, setSelectionPopup] = useState<{
    top: number
    left: number
    text: string
  } | null>(null)

  // Listen for text selection inside assistant messages and show a "Reply"
  // popup anchored above the selection. Selections outside of a message body
  // are ignored — we only react to prose the user is clearly quoting from.
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setSelectionPopup(null)
        return
      }
      const text = sel.toString().trim()
      if (!text) {
        setSelectionPopup(null)
        return
      }

      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
      // Only trigger for selections inside an assistant message body
      // (not artifact cards, which have their own copy/download controls).
      const inside = el?.closest('.message.assistant .message-content')
      if (!inside) {
        setSelectionPopup(null)
        return
      }

      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setSelectionPopup(null)
        return
      }
      setSelectionPopup({
        top: rect.top + window.scrollY - 44,
        left: rect.left + window.scrollX + rect.width / 2,
        text,
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectionPopup(null)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleQuoteReply = useCallback(() => {
    if (!selectionPopup) return
    setQuotedText(selectionPopup.text)
    setSelectionPopup(null)
    window.getSelection()?.removeAllRanges()
  }, [selectionPopup, setQuotedText])

  const handleClearQuote = useCallback(() => {
    setQuotedText('')
  }, [setQuotedText])

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

  // Stable refs: these functions are passed down to memoized components,
  // so they must keep the same identity across keystroke re-renders or the
  // whole message list re-parses markdown on every character.
  const handleNewChat = useCallback(() => {
    startNewChat()
    navigate('/')
  }, [startNewChat, navigate])

  const handleToggleGhost = useCallback(() => {
    if (ghostMode) {
      // Exit ghost mode → back to a normal blank chat screen
      startNewChat()
      navigate('/')
    } else {
      startGhostChat()
      navigate('/')
    }
  }, [ghostMode, startNewChat, startGhostChat, navigate])

  const handleBranch = useCallback(
    async (messageIndex: number) => {
      if (!sessionId) return
      try {
        const newId = await branchSession(sessionId, messageIndex)
        navigate(`/sessions/${newId}`)
      } catch {
        // Error already logged in hook
      }
    },
    [sessionId, branchSession, navigate]
  )

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
    <div
      className={`chat-app ${sidebarOpen ? 'sidebar-visible' : ''} ${rightPanelOpen ? 'right-panel-visible' : ''}`}
    >
      <div className="chat-body">
        {sidebarOpen && <div className="sidebar-overlay" onClick={toggleSidebar} />}
        <Sidebar
          isOpen={sidebarOpen}
          sessions={sessions}
          currentSessionId={sessionId}
          hasMoreSessions={hasMoreSessions}
          loadingMoreSessions={loadingMoreSessions}
          onLoadMoreSessions={loadMoreSessions}
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
            ghostMode={ghostMode}
            onToggleGhost={handleToggleGhost}
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
              ghostMode={ghostMode}
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
              quotedText={quotedText}
              onClearQuote={handleClearQuote}
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

      {selectionPopup && (
        <QuoteReplyPopup
          top={selectionPopup.top}
          left={selectionPopup.left}
          onReply={handleQuoteReply}
        />
      )}

      <PWAInstallPrompt />
    </div>
  )
}

export default App
