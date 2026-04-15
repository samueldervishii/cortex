import { Link } from 'react-router-dom'
import { GhostIcon as Ghost } from '@phosphor-icons/react/Ghost'
import { NotePencilIcon as NotePencil } from '@phosphor-icons/react/NotePencil'
import { SidebarIcon as Sidebar } from '@phosphor-icons/react/Sidebar'
import { TextIndentIcon as TextIndent } from '@phosphor-icons/react/TextIndent'

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
  onNewChat,
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
            <TextIndent size={18} weight="regular" />
          </button>
        )}
        {hasSession && (
          <button
            className="menu-btn top-bar-new-chat"
            onClick={onNewChat}
            title="New chat"
            aria-label="Start a new chat"
          >
            <NotePencil size={18} weight="regular" />
          </button>
        )}
      </div>

      <div className="top-bar-center">
        {ghostMode ? (
          <span className="top-bar-ghost-label">
            <Ghost size={14} weight="regular" /> Temporary Chat
          </span>
        ) : hasSession && sessionTitle ? (
          <span className="top-bar-session-title">{sessionTitle}</span>
        ) : (
          <Link to="/" className="top-bar-brand-link" aria-label="Go to home">
            <span className="top-bar-brand">
              <img src="/logo.svg" alt="" width="22" height="22" />
              Cortex
            </span>
          </Link>
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
            <Ghost size={16} weight={ghostMode ? 'fill' : 'regular'} />
          </button>
        )}
        {onToggleRightPanel && (
          <button
            className={`top-bar-icon-btn ${rightPanelOpen ? 'active' : ''}`}
            onClick={onToggleRightPanel}
            title="Context panel"
          >
            <Sidebar size={16} weight="regular" mirrored />
          </button>
        )}
      </div>
    </div>
  )
}

export default TopBar
