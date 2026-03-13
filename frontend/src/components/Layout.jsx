import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FRONTEND_URL } from '../config/api'
import './Layout.css'

function Layout({
  children,
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onShareSession,
  onNewChat,
  theme,
  onToggleTheme,
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('llm-council-sidebar-collapsed')
    return saved === 'true'
  })
  const [shareModal, setShareModal] = useState({ open: false, url: '', loading: false })
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('llm-council-sidebar-collapsed', sidebarCollapsed)
  }, [sidebarCollapsed])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarCollapsed((prev) => !prev)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        onNewChat()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNewChat])

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev)

  // Filter sessions based on search query
  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const title = (session.title || '').toLowerCase()
    const question = (session.question || '').toLowerCase()
    return title.includes(query) || question.includes(query)
  })

  const pinnedSessions = filteredSessions.filter((s) => s.is_pinned)
  const recentSessions = filteredSessions.filter((s) => !s.is_pinned)

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  const truncateQuestion = (question, maxLength = 35) => {
    if (!question) return 'Empty session'
    if (question.length <= maxLength) return question
    return question.substring(0, maxLength) + '...'
  }

  const handleShare = async (e, sessionId) => {
    e.stopPropagation()
    setShareModal({ open: true, url: '', loading: true })
    try {
      const data = await onShareSession(sessionId)
      const frontendUrl = `${FRONTEND_URL}/shared/${data.share_token}`
      setShareModal({ open: true, url: frontendUrl, loading: false })
    } catch (error) {
      setShareModal({ open: false, url: '', loading: false })
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareModal.url)
  }

  const startEditing = (e, session) => {
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title || session.question?.substring(0, 50) || '')
  }

  const saveEdit = async (e) => {
    e?.stopPropagation()
    if (editingId && editTitle.trim()) {
      await onRenameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }

  const cancelEdit = (e) => {
    e?.stopPropagation()
    setEditingId(null)
    setEditTitle('')
  }

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') saveEdit(e)
    else if (e.key === 'Escape') cancelEdit(e)
  }

  const handlePin = async (e, sessionId) => {
    e.stopPropagation()
    await onTogglePinSession(sessionId)
  }

  const isSettingsPage = location.pathname === '/settings'

  const renderSessionItem = (session) => (
    <div
      key={session.id}
      className={`sidebar-session ${session.id === currentSessionId ? 'active' : ''} ${session.is_pinned ? 'pinned' : ''}`}
      onClick={() => {
        if (editingId !== session.id) {
          onSelectSession(session.id)
          if (location.pathname !== '/') navigate('/')
        }
      }}
    >
      <div className="session-info">
        {editingId === session.id ? (
          <input
            type="text"
            className="session-edit-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="session-question">
            {truncateQuestion(session.title || session.question)}
          </span>
        )}
        {!sidebarCollapsed && (
          <div className="session-meta">
            <span className="session-date">{formatDate(session.created_at)}</span>
            {session.round_count > 1 && (
              <span className="session-rounds">{session.round_count} rounds</span>
            )}
          </div>
        )}
      </div>
      {!sidebarCollapsed && (
        <div className="session-actions">
          <button
            className={`session-pin ${session.is_pinned ? 'active' : ''}`}
            onClick={(e) => handlePin(e, session.id)}
            title={session.is_pinned ? 'Unpin' : 'Pin'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill={session.is_pinned ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={session.is_pinned ? '0' : '2'}
            >
              <path d="M16 4a1 1 0 0 1 .117 1.993L16 6h-.09l-1.18 6.5a3 3 0 0 1-1.23 1.878V18h1a1 1 0 0 1 0 2H9.5a1 1 0 1 1 0-2h1v-3.622a3 3 0 0 1-1.23-1.878L8.09 6H8a1 1 0 0 1 0-2h8z" />
            </svg>
          </button>
          <button className="session-edit" onClick={(e) => startEditing(e, session)} title="Rename">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="session-share"
            onClick={(e) => handleShare(e, session.id)}
            title="Share"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
          <button
            className="session-delete"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteSession(session.id)
            }}
            title="Delete"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {/* Top buttons when collapsed */}
        {sidebarCollapsed ? (
          <div className="sidebar-collapsed-content">
            <button
              className="sidebar-icon-btn toggle-btn"
              onClick={toggleSidebar}
              title="Expand sidebar (Ctrl+B)"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <button
              className="sidebar-icon-btn new-chat-icon"
              onClick={() => {
                onNewChat()
                if (location.pathname !== '/') navigate('/')
              }}
              title="New chat (Ctrl+N)"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              className={`sidebar-icon-btn settings-icon ${isSettingsPage ? 'active' : ''}`}
              onClick={() => navigate('/settings')}
              title="Settings"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            {/* Expanded sidebar content */}
            <div className="sidebar-header">
              <button
                className="sidebar-toggle-btn"
                onClick={toggleSidebar}
                title="Collapse sidebar (Ctrl+B)"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>
              <button
                className="sidebar-new-chat-btn"
                onClick={() => {
                  onNewChat()
                  if (location.pathname !== '/') navigate('/')
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New chat
              </button>
            </div>

            <div className="sidebar-search">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="search-clear" onClick={() => setSearchQuery('')}>
                  &times;
                </button>
              )}
            </div>

            <div className="sidebar-sessions">
              {filteredSessions.length === 0 ? (
                <p className="sidebar-empty">
                  {searchQuery ? 'No matching chats' : 'No chat history yet'}
                </p>
              ) : (
                <>
                  {pinnedSessions.length > 0 && (
                    <>
                      <div className="sidebar-section-header">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          stroke="currentColor"
                          strokeWidth="1"
                        >
                          <path d="M16 4a1 1 0 0 1 .117 1.993L16 6h-.09l-1.18 6.5a3 3 0 0 1-1.23 1.878V18h1a1 1 0 0 1 0 2H9.5a1 1 0 1 1 0-2h1v-3.622a3 3 0 0 1-1.23-1.878L8.09 6H8a1 1 0 0 1 0-2h8z" />
                        </svg>
                        <span>Pinned</span>
                      </div>
                      {pinnedSessions.map(renderSessionItem)}
                    </>
                  )}

                  {recentSessions.length > 0 && (
                    <>
                      {pinnedSessions.length > 0 && (
                        <div className="sidebar-section-header">
                          <span>Recent</span>
                        </div>
                      )}
                      {recentSessions.map(renderSessionItem)}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="sidebar-footer">
              <button
                className={`sidebar-footer-btn settings-btn ${isSettingsPage ? 'active' : ''}`}
                onClick={() => navigate('/settings')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </button>
            </div>
          </>
        )}
      </aside>

      {/* Main Content */}
      <main className="main-content">{children}</main>

      {/* Share Modal */}
      {shareModal.open && (
        <div
          className="share-modal-overlay"
          onClick={() => setShareModal({ open: false, url: '', loading: false })}
        >
          <div className="share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="share-modal-header">
              <h3>Share Session</h3>
              <button onClick={() => setShareModal({ open: false, url: '', loading: false })}>
                &times;
              </button>
            </div>
            <div className="share-modal-content">
              {shareModal.loading ? (
                <p>Generating share link...</p>
              ) : (
                <>
                  <p>Anyone with this link can view this session:</p>
                  <div className="share-url-container">
                    <input type="text" value={shareModal.url} readOnly />
                    <button onClick={copyToClipboard}>Copy</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Layout
