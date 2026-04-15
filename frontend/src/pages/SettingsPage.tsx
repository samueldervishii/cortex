import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { TopBar, Sidebar, CommandPalette } from '../components'
import Settings from './Settings'
import useCouncil from '../hooks/useCouncil'
import '../App.css'

function SettingsPage() {
  const navigate = useNavigate()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const { sidebarOpen, toggleSidebar, closeSidebarOnMobile } = useOutletContext<any>()
  const {
    sessionId,
    sessions,
    startNewChat,
    deleteSession,
    renameSession,
    togglePinSession,
    shareSession,
    exportSession,
  } = useCouncil() as any

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          onNewChat={() => {
            startNewChat()
            navigate('/')
          }}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        <div className="chat-content">
          <TopBar
            onNewChat={() => {
              startNewChat()
              navigate('/')
            }}
          />
          <Settings />
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
