import { Ghost } from 'lucide-react'

interface TopBarProps {
  onNewChat: () => void
  onToggleSidebar: () => void
  sidebarOpen?: boolean
  onToggleRightPanel?: () => void
  rightPanelOpen?: boolean
  hasSession?: boolean
  sessionTitle?: string
  ghostMode?: boolean
  onToggleGhost?: () => void
}

function TopBar({
  onToggleSidebar,
  sidebarOpen,
  onToggleRightPanel,
  rightPanelOpen,
  hasSession,
  sessionTitle,
  ghostMode,
  onToggleGhost,
}: TopBarProps) {
  return (
    <div className={`top-bar ${ghostMode ? 'ghost-mode' : ''}`}>
      <div className="top-bar-left">
        {!sidebarOpen && (
          <button className="menu-btn" onClick={onToggleSidebar} title="Open sidebar">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      <div className="top-bar-center">
        {ghostMode ? (
          <span className="top-bar-ghost-label">
            <Ghost size={14} /> Temporary Chat
          </span>
        ) : hasSession && sessionTitle ? (
          <span className="top-bar-session-title">{sessionTitle}</span>
        ) : (
          <span className="top-bar-brand">
            <img src="/logo.svg" alt="" width="22" height="22" />
            Cortex
          </span>
        )}
      </div>

      <div className="top-bar-right">
        {onToggleGhost && (
          <button
            className={`top-bar-icon-btn ${ghostMode ? 'active' : ''}`}
            onClick={onToggleGhost}
            title={ghostMode ? 'Exit temporary chat' : 'Start temporary chat'}
            aria-pressed={ghostMode}
          >
            <Ghost size={16} />
          </button>
        )}
        {onToggleRightPanel && (
          <button
            className={`top-bar-icon-btn ${rightPanelOpen ? 'active' : ''}`}
            onClick={onToggleRightPanel}
            title="Context panel"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

export default TopBar
