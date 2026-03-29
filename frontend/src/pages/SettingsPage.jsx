import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { TopBar, Sidebar, CommandPalette } from '../components'
import Settings from './Settings'
import useCouncil from '../hooks/useCouncil'
import useTheme from '../hooks/useTheme'
import '../App.css'

function SettingsPage() {
  const navigate = useNavigate()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const { sidebarOpen, toggleSidebar, closeSidebarOnMobile } = useOutletContext()
  const {
    sessionId,
    sessions,
    mode,
    setMode,
    availableModels,
    selectedModels,
    toggleModel,
    selectAllModels,
    startNewChat,
    loadSession,
    deleteSession,
    renameSession,
    togglePinSession,
    shareSession,
    exportSession,
  } = useCouncil()

  const { theme, toggleTheme } = useTheme()

  // Keyboard shortcuts for command palette
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K or Ctrl+/ for command palette
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === '/')) {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])

  return (
    <div className="chat-app">
      <TopBar
        onNewChat={() => {
          startNewChat()
          navigate('/')
        }}
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
              onNewChat={() => {
                startNewChat()
                navigate('/')
              }}
            />
          </>
        )}

        <div className="chat-content">
          <Settings
            theme={theme}
            onToggleTheme={toggleTheme}
            mode={mode}
            onModeChange={setMode}
            availableModels={availableModels}
            selectedModels={selectedModels}
            onToggleModel={toggleModel}
            onSelectAllModels={selectAllModels}
          />
        </div>
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        sessions={sessions}
        onNewChat={() => {
          startNewChat()
          navigate('/')
        }}
        onExport={exportSession}
        currentSessionId={sessionId}
      />
    </div>
  )
}

export default SettingsPage
