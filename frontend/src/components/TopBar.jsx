import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function TopBar({
  onNewChat,
  onToggleSidebar,
  onOpenCommandPalette,
  onOpenIncognito,
  onOpenRightPanel,
  showContextButton = false,
}) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const isRootPath = location.pathname === '/'
  const showGlobalActions =
    isRootPath ||
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/status')

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <button className="menu-btn" onClick={onToggleSidebar}>
          &#9776;
        </button>
        <button className="new-chat-btn" onClick={onNewChat}>
          + New Chat
        </button>
      </div>

      <div className="top-bar-right">
        {isRootPath && (
          <button
            className="top-bar-action incognito-btn"
            onClick={onOpenIncognito}
            title="Incognito chat (not saved)"
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
              <path d="M9 10h.01" />
              <path d="M15 10h.01" />
              <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
            </svg>
            <span className="button-text">Incognito</span>
          </button>
        )}

        {showGlobalActions && (
          <button
            className="top-bar-action search-btn"
            onClick={onOpenCommandPalette}
            title="Search (Ctrl+K)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span className="search-hint">
              <kbd>Ctrl</kbd> <kbd>K</kbd>
            </span>
          </button>
        )}

        {showGlobalActions && showContextButton && (
          <button
            className="top-bar-action panel-btn"
            onClick={onOpenRightPanel}
            title="Session context (system prompt &amp; language)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="8" y1="12" x2="20" y2="12" />
              <line x1="12" y1="18" x2="20" y2="18" />
              <circle cx="2" cy="6" r="2" fill="currentColor" stroke="none" />
              <circle cx="4" cy="12" r="2" fill="currentColor" stroke="none" />
              <circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" />
            </svg>
            <span className="button-text">Context</span>
          </button>
        )}

        {user && (
          <button
            className="top-bar-action user-btn"
            onClick={logout}
            title={`${user.email} — Log out`}
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
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="button-text">Log out</span>
          </button>
        )}
      </div>
    </div>
  )
}

export default TopBar
