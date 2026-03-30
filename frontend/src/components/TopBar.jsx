import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import ProfileModal from './ProfileModal'

function TopBar({ onNewChat, onToggleSidebar, onOpenCommandPalette }) {
  const { user, logout } = useAuth()
  const { showToast } = useToast()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const userMenuRef = useRef(null)
  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [userMenuOpen])

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

        {user && (
          <div className="user-menu-wrapper" ref={userMenuRef}>
            <button
              className="top-bar-action user-btn"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              title={user.email}
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="button-text">
                {user.display_name || user.username || user.email}
              </span>
              <svg
                className="chevron-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
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
                    setProfileOpen(true)
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

      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onToast={showToast}
      />
    </div>
  )
}

export default TopBar
