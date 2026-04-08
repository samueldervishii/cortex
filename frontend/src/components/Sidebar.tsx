import { useState, useEffect, useRef, memo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Pin,
  Edit2,
  Share2,
  X,
  Search as SearchIcon,
  Settings as SettingsIcon,
  MoreVertical,
  MessageSquare,
  SquarePen,
  User,
  LogOut,
  ChevronUp,
} from 'lucide-react'
import { FRONTEND_URL } from '../config/api'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'

interface Session {
  id: string
  title?: string
  question?: string
  created_at?: string
  round_count?: number
  is_pinned?: boolean
}

interface SidebarProps {
  sessions: Session[]
  currentSessionId: string | null
  onDeleteSession: (id: string) => Promise<void>
  onRenameSession: (id: string, title: string) => Promise<void>
  onTogglePinSession: (id: string) => Promise<void>
  onShareSession: (id: string) => Promise<{ share_token: string }>
  onClose: () => void
  onCloseMobile?: () => void
  onNewChat: () => void
}

function Sidebar({
  sessions,
  currentSessionId,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onShareSession,
  onClose,
  onCloseMobile,
  onNewChat,
}: SidebarProps) {
  const { showToast } = useToast()
  const { user, logout } = useAuth() as any
  const navigate = useNavigate()
  const [shareModal, setShareModal] = useState({ open: false, url: '', loading: false })
  const [deleteConfirm, setDeleteConfirm] = useState({
    open: false,
    sessionId: null as string | null,
    title: '',
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const [searchOpen, setSearchOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    setVisibleCount(10)
  }, [searchQuery])

  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const title = (session.title || '').toLowerCase()
    const question = (session.question || '').toLowerCase()
    return title.includes(query) || question.includes(query)
  })

  const pinnedSessions = filteredSessions.filter((s) => s.is_pinned)
  const recentSessions = filteredSessions.filter((s) => !s.is_pinned)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  const toggleMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenMenuId(openMenuId === sessionId ? null : sessionId)
  }

  const truncateQuestion = (question?: string, maxLength = 40) => {
    if (!question) return 'New conversation'
    if (question.length <= maxLength) return question
    return question.substring(0, maxLength) + '...'
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const handleShare = async (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setShareModal({ open: true, url: '', loading: true })
    try {
      const data = await onShareSession(sessionId)
      const frontendUrl = `${FRONTEND_URL}/shared/${data.share_token}`
      setShareModal({ open: true, url: frontendUrl, loading: false })
    } catch {
      setShareModal({ open: false, url: '', loading: false })
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareModal.url)
    showToast('Link copied to clipboard!', 'success')
  }

  const startEditing = (e: React.MouseEvent, session: Session) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title || session.question?.substring(0, 50) || '')
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  const saveEdit = async (e?: React.FocusEvent | React.MouseEvent) => {
    e?.preventDefault()
    if (editingId && editTitle.trim()) {
      await onRenameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }

  const cancelEdit = (e?: React.MouseEvent) => {
    e?.preventDefault()
    setEditingId(null)
    setEditTitle('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit()
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  const handlePin = async (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    await onTogglePinSession(sessionId)
  }

  const confirmDelete = (e: React.MouseEvent, session: Session) => {
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

  const displayName = user?.display_name || user?.username || user?.email || ''
  const displayInitial = (displayName || '?')[0].toUpperCase()

  const renderSessionItem = (session: Session) => (
    <Link
      key={session.id}
      to={`/sessions/${session.id}`}
      className={`sidebar-session ${session.id === currentSessionId ? 'active' : ''} ${session.is_pinned ? 'pinned' : ''}`}
      onClick={(e) => {
        if (editingId === session.id) {
          e.preventDefault()
          return
        }
        onCloseMobile?.()
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
              <MessageSquare size={14} />
              <span>{truncateQuestion(session.title || session.question)}</span>
            </div>
            <div className="session-date">{formatDate(session.created_at)}</div>
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
            <MoreVertical size={14} />
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
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <img src="/logo.svg" alt="Cortex" className="sidebar-logo-icon" />
          <div className="sidebar-logo-copy">
            <span className="sidebar-logo-title">Cortex</span>
            <span className="sidebar-logo-subtitle">Research workspace</span>
          </div>
        </div>
        <button className="sidebar-toggle-btn" onClick={onClose} title="Close sidebar">
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
      </div>

      <div className="sidebar-nav">
        <button
          className="sidebar-nav-item"
          onClick={() => {
            onNewChat()
            onCloseMobile?.()
          }}
        >
          <SquarePen size={16} />
          <span>New chat</span>
          <kbd className="sidebar-nav-shortcut">Alt+N</kbd>
        </button>
        <button
          className="sidebar-nav-item"
          onClick={() => {
            setSearchOpen(true)
            setTimeout(() => searchInputRef.current?.focus(), 50)
          }}
        >
          <SearchIcon size={16} />
          <span>Search chats</span>
        </button>
      </div>

      {searchOpen && (
        <div className="sidebar-search visible">
          <SearchIcon size={14} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={() => {
              if (!searchQuery) {
                setTimeout(() => setSearchOpen(false), 150)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('')
                setSearchOpen(false)
              }
            }}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div className="sidebar-divider" />

      <div className="sidebar-sessions">
        {filteredSessions.length === 0 ? (
          <p className="sidebar-empty">
            {searchQuery ? `No results for "${searchQuery}"` : 'No conversations yet'}
          </p>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <>
                <div className="sidebar-section-header">
                  <Pin size={11} fill="currentColor" />
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

      {user && (
        <div className="sidebar-account" ref={accountRef}>
          {accountOpen && (
            <div className="sidebar-account-dropdown">
              <button
                className="sidebar-account-item"
                onClick={() => {
                  setAccountOpen(false)
                  navigate('/settings?tab=general')
                  onCloseMobile?.()
                }}
              >
                <User size={14} />
                Profile
              </button>
              <button
                className="sidebar-account-item"
                onClick={() => {
                  setAccountOpen(false)
                  navigate('/settings')
                  onCloseMobile?.()
                }}
              >
                <SettingsIcon size={14} />
                Settings
              </button>
              <div className="sidebar-account-divider" />
              <button
                className="sidebar-account-item danger"
                onClick={() => {
                  setAccountOpen(false)
                  logout()
                }}
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          )}
          <button
            className={`sidebar-account-trigger ${accountOpen ? 'open' : ''}`}
            onClick={() => setAccountOpen((prev) => !prev)}
          >
            <div className="sidebar-account-avatar">
              {user.avatar ? (
                <img src={user.avatar} alt="" />
              ) : (
                displayInitial
              )}
            </div>
            <span className="sidebar-account-name">{displayName}</span>
            <ChevronUp size={14} className={`sidebar-account-chevron ${accountOpen ? 'open' : ''}`} />
          </button>
        </div>
      )}

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
    </div>
  )
}

export default memo(Sidebar)
