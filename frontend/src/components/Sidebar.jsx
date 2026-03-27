import { useState, useEffect, useRef, memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Pin,
  Edit2,
  Share2,
  X,
  Search as SearchIcon,
  Settings as SettingsIcon,
  MoreVertical,
} from 'lucide-react'
import { FRONTEND_URL } from '../config/api'

function Sidebar({
  sessions,
  currentSessionId,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onShareSession,
  onBranchSession,
  onClose,
  onNewChat,
  branchingEnabled = false,
}) {
  const [shareModal, setShareModal] = useState({ open: false, url: '', loading: false })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, sessionId: null, title: '' })
  const [showToast, setShowToast] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [openMenuId, setOpenMenuId] = useState(null)
  const [visibleCount, setVisibleCount] = useState(10)

  const searchInputRef = useRef(null)
  const editInputRef = useRef(null)
  const menuRef = useRef(null)
  const location = useLocation()

  // Reset pagination when search changes
  useEffect(() => {
    setVisibleCount(10)
  }, [searchQuery])

  // Filter sessions based on search query
  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const title = (session.title || '').toLowerCase()
    const question = (session.question || '').toLowerCase()
    return title.includes(query) || question.includes(query)
  })

  // Separate pinned and unpinned
  const pinnedSessions = filteredSessions.filter((s) => s.is_pinned)
  const recentSessions = filteredSessions.filter((s) => !s.is_pinned)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Ctrl+F to focus search (only when sidebar is open)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        searchInputRef.current?.focus()
      }
      if (e.key === 'Escape' && searchQuery) {
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [searchQuery])

  const toggleMenu = (e, sessionId) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenMenuId(openMenuId === sessionId ? null : sessionId)
  }

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

  const truncateQuestion = (question, maxLength = 30) => {
    if (!question) return 'Empty session'
    if (question.length <= maxLength) return question
    return question.substring(0, maxLength) + '...'
  }

  const handleShare = async (e, sessionId) => {
    e.preventDefault()
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
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const startEditing = (e, session) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title || session.question?.substring(0, 50) || '')
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  const saveEdit = async (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (editingId && editTitle.trim()) {
      await onRenameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }

  const cancelEdit = (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    setEditingId(null)
    setEditTitle('')
  }

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      saveEdit(e)
    } else if (e.key === 'Escape') {
      cancelEdit(e)
    }
  }

  const handlePin = async (e, sessionId) => {
    e.preventDefault()
    e.stopPropagation()
    await onTogglePinSession(sessionId)
  }

  const confirmDelete = (e, session) => {
    e.preventDefault()
    e.stopPropagation()
    setDeleteConfirm({
      open: true,
      sessionId: session.id,
      title: session.title || session.question || 'this chat',
    })
  }

  const handleDelete = async () => {
    if (deleteConfirm.sessionId) {
      await onDeleteSession(deleteConfirm.sessionId)
      setDeleteConfirm({ open: false, sessionId: null, title: '' })
    }
  }

  const cancelDelete = () => {
    setDeleteConfirm({ open: false, sessionId: null, title: '' })
  }

  const renderSessionItem = (session) => (
    <Link
      key={session.id}
      to={`/sessions/${session.id}`}
      className={`sidebar-session ${session.id === currentSessionId ? 'active' : ''} ${session.is_pinned ? 'pinned' : ''}`}
      onClick={(e) => {
        if (editingId === session.id) {
          e.preventDefault()
        }
      }}
    >
      <div className="session-info">
        {editingId === session.id ? (
          <input
            ref={editInputRef}
            type="text"
            className="session-edit-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className="session-name">
              {truncateQuestion(session.title || session.question)}
            </div>
            <div className="session-meta">
              {formatDate(session.created_at)} - {session.round_count}{' '}
              {session.round_count === 1 ? 'round' : 'rounds'}
            </div>
          </>
        )}
      </div>
      <div className="session-actions">
        <div className="session-menu-container" ref={openMenuId === session.id ? menuRef : null}>
          <button
            className="session-menu-btn"
            onClick={(e) => toggleMenu(e, session.id)}
            title="More options"
          >
            <MoreVertical size={16} />
          </button>
          {openMenuId === session.id && (
            <div className="session-menu-dropdown">
              <button
                onClick={(e) => {
                  handlePin(e, session.id)
                  setOpenMenuId(null)
                }}
              >
                <Pin size={14} fill={session.is_pinned ? 'currentColor' : 'none'} />
                {session.is_pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onClick={(e) => {
                  startEditing(e, session)
                  setOpenMenuId(null)
                }}
              >
                <Edit2 size={14} />
                Rename
              </button>
              <button
                onClick={(e) => {
                  handleShare(e, session.id)
                  setOpenMenuId(null)
                }}
              >
                <Share2 size={14} />
                Share
              </button>
              <button
                className="danger"
                onClick={(e) => {
                  confirmDelete(e, session)
                  setOpenMenuId(null)
                }}
              >
                <X size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </Link>
  )

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>
          Chat History <span className="session-count">({sessions.length})</span>
        </h2>
      </div>

      <button className="sidebar-new-chat" onClick={onNewChat}>
        + New Chat
      </button>

      <div className="sidebar-search">
        <SearchIcon size={14} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search chats... (Ctrl+F)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>

      <div className="sidebar-sessions">
        {filteredSessions.length === 0 ? (
          <p className="sidebar-empty">
            {searchQuery ? `No results for '${searchQuery}'` : 'No chat history yet'}
          </p>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <>
                <div className="sidebar-section-header">
                  <Pin size={12} fill="currentColor" />
                  <span>Pinned</span>
                </div>
                {pinnedSessions.map((session) => renderSessionItem(session))}
              </>
            )}

            {recentSessions.length > 0 && (
              <>
                {pinnedSessions.length > 0 && (
                  <div className="sidebar-section-header">
                    <span>Recent</span>
                  </div>
                )}
                {recentSessions.slice(0, visibleCount).map((session) => renderSessionItem(session))}
                {recentSessions.length > visibleCount && (
                  <button
                    className="load-more-btn"
                    onClick={() => setVisibleCount((prev) => prev + 10)}
                  >
                    Load more ({recentSessions.length - visibleCount} remaining)
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Link
        to="/settings"
        className={`sidebar-settings ${location.pathname === '/settings' ? 'active' : ''}`}
      >
        <SettingsIcon size={16} />
        Settings
      </Link>

      {deleteConfirm.open && (
        <div className="delete-modal-overlay" onClick={cancelDelete}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-icon">
              <X size={24} />
            </div>
            <h3>Delete Chat?</h3>
            <p>
              Are you sure you want to delete{' '}
              <strong>"{truncateQuestion(deleteConfirm.title, 30)}"</strong>? This action cannot be
              undone.
            </p>
            <div className="delete-modal-actions">
              <button className="delete-cancel" onClick={cancelDelete}>
                Cancel
              </button>
              <button className="delete-confirm" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModal.open && (
        <div
          className="share-modal-overlay"
          onClick={() => setShareModal({ open: false, url: '', loading: false })}
        >
          <div className="share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="share-modal-header">
              <h3>Share Session</h3>
              <button onClick={() => setShareModal({ open: false, url: '', loading: false })}>
                <X size={20} />
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

      {showToast && (
        <div className="copy-toast">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Link copied to clipboard!
        </div>
      )}
    </div>
  )
}

export default memo(Sidebar)
