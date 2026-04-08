import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface TopBarProps {
  onNewChat: () => void
  onToggleSidebar: () => void
  onOpenCommandPalette: () => void
  sidebarOpen?: boolean
  onToggleRightPanel?: () => void
  rightPanelOpen?: boolean
  hasSession?: boolean
  sessionTitle?: string
}

function TopBar({
  onNewChat,
  onToggleSidebar,
  onOpenCommandPalette,
  sidebarOpen,
  onToggleRightPanel,
  rightPanelOpen,
  hasSession,
  sessionTitle,
}: TopBarProps) {
  const { user, logout } = useAuth() as any
  const navigate = useNavigate()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [userMenuOpen])

  return (
    <div className="top-bar">
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
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        )}

        {/* Show brand only when sidebar is hidden */}
        {!sidebarOpen && (
          <span className="top-bar-brand">Cortex</span>
        )}

        {/* Show session title when in a session */}
        {hasSession && sessionTitle && (
          <span className="top-bar-session-title">{sessionTitle}</span>
        )}
      </div>

      <div className="top-bar-right">
        <button className="top-bar-icon-btn" onClick={onOpenCommandPalette} title="Search (Ctrl+K)">
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
        </button>

        <button className="top-bar-icon-btn" onClick={onNewChat} title="New chat (Alt+N)">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

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

        {/* Mobile-only profile button (desktop profile is in sidebar) */}
        {user && (
          <div className="user-menu-wrapper top-bar-mobile-only" ref={userMenuRef}>
            <button
              className="top-bar-avatar"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              title={user.email}
            >
              {user.avatar ? (
                <img src={user.avatar} alt="" className="top-bar-avatar-img" />
              ) : (
                (user.display_name || user.username || user.email || '?')[0].toUpperCase()
              )}
            </button>
            {userMenuOpen && (
              <div className="user-dropdown">
                {(user.display_name || user.username) && (
                  <div className="user-dropdown-name">{user.display_name || user.username}</div>
                )}
                <div className="user-dropdown-email">{user.email}</div>
                <div className="user-dropdown-divider" />
                <button
                  className="user-dropdown-item"
                  onClick={() => {
                    setUserMenuOpen(false)
                    navigate('/settings?tab=general')
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </button>
                <button
                  className="user-dropdown-item logout"
                  onClick={() => {
                    setUserMenuOpen(false)
                    logout()
                  }}
                >
                  <svg
                    width="14"
                    height="14"
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
                  Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default TopBar
