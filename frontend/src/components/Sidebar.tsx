import { useState, useEffect, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { PushPinIcon as Pin } from '@phosphor-icons/react/PushPin'
import { PencilSimpleIcon as Edit2 } from '@phosphor-icons/react/PencilSimple'
import { ShareNetworkIcon as Share2 } from '@phosphor-icons/react/ShareNetwork'
import { TrashIcon as X } from '@phosphor-icons/react/Trash'
import { MagnifyingGlassIcon as SearchIcon } from '@phosphor-icons/react/MagnifyingGlass'
import { GearIcon as SettingsIcon } from '@phosphor-icons/react/Gear'
import { DotsThreeCircleIcon as MoreVertical } from '@phosphor-icons/react/DotsThreeCircle'
import { NotePencilIcon as SquarePen } from '@phosphor-icons/react/NotePencil'
import { SignOutIcon as LogOut } from '@phosphor-icons/react/SignOut'
import { TextOutdentIcon as TextOutdent } from '@phosphor-icons/react/TextOutdent'
import { TextIndentIcon as TextIndent } from '@phosphor-icons/react/TextIndent'
import { FRONTEND_URL } from '../config/api'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useUsage } from '../contexts/UsageContext'

// Must mirror api/services/usage_service.py LIMIT_TOKENS
const USAGE_LIMIT_TOKENS = 200_000

function formatSidebarTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function formatResetWindow(seconds: number): string {
  if (!seconds || seconds <= 0) return 'Ready to use'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours >= 1) return `Resets in ${hours}h ${minutes}m`
  if (minutes >= 1) return `Resets in ${minutes}m`
  return `Resets in ${seconds}s`
}

interface Session {
  id: string
  title?: string
  question?: string
  created_at?: string
  round_count?: number
  is_pinned?: boolean
}

interface SidebarProps {
  isOpen: boolean
  sessions: Session[]
  currentSessionId: string | null
  hasMoreSessions?: boolean
  loadingMoreSessions?: boolean
  onLoadMoreSessions?: () => void
  onDeleteSession: (id: string) => Promise<void>
  onRenameSession: (id: string, title: string) => Promise<void>
  onTogglePinSession: (id: string) => Promise<void>
  onShareSession: (id: string) => Promise<{ share_token: string }>
  onClose: () => void
  onCloseMobile?: () => void
  onNewChat: () => void
  onOpenCommandPalette?: () => void
}

function Sidebar({
  isOpen,
  sessions,
  currentSessionId,
  hasMoreSessions = false,
  loadingMoreSessions = false,
  onLoadMoreSessions,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onShareSession,
  onClose,
  onCloseMobile,
  onNewChat,
  onOpenCommandPalette,
}: SidebarProps) {
  const { showToast } = useToast()
  const { user, logout } = useAuth() as any
  const { current: usageCurrent } = useUsage()
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
  const [accountOpen, setAccountOpen] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const pendingSearchFocusRef = useRef(false)

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
        if (!isOpen) {
          pendingSearchFocusRef.current = true
          onClose()
          return
        }
        searchInputRef.current?.focus()
      }
      if (e.key === 'Escape' && searchQuery) {
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [isOpen, onClose, searchQuery])

  useEffect(() => {
    if (isOpen && pendingSearchFocusRef.current) {
      pendingSearchFocusRef.current = false
      const timeoutId = window.setTimeout(() => searchInputRef.current?.focus(), 220)
      return () => window.clearTimeout(timeoutId)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setAccountOpen(false)
      setOpenMenuId(null)
      setEditingId(null)
    }
  }, [isOpen])

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

  const openSearch = () => {
    if (!isOpen) {
      pendingSearchFocusRef.current = true
      onClose()
      return
    }
    searchInputRef.current?.focus()
  }

  const renderAccountDropdown = () => (
    <div className="sidebar-account-dropdown">
      {/* <button
        className="sidebar-account-item"
        onClick={() => {
          setAccountOpen(false)
          navigate('/settings?tab=general')
          onCloseMobile?.()
        }}
      >
        <User size={14} />
        Profile
      </button> */}
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
  )

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
                <Pin size={14} weight={session.is_pinned ? 'fill' : 'regular'} />
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
    <div className={`sidebar ${isOpen ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-shell">
        <div className="sidebar-brand">
          {isOpen ? (
            <>
              <div className="sidebar-brand-main">
                <div className="sidebar-logo">
                  {/* <img src="/IMG_6935.png" alt="Cortex" className="sidebar-logo-icon" /> */}
                  <div className="sidebar-logo-copy">
                    <span className="sidebar-logo-title">
                      Cortex - <span className="sidebar-logo-subtitle">Research workspace</span>
                    </span>
                  </div>
                </div>
              </div>
              <button className="sidebar-toggle-btn" onClick={onClose}>
                <TextOutdent size={16} />
              </button>
            </>
          ) : (
            <button className="sidebar-collapsed-logo-btn" onClick={onClose} title="Open sidebar">
              <img src="/IMG_6935.png" alt="Cortex" className="sidebar-logo-icon logo-default" />
              <TextIndent size={18} className="logo-hover-icon" />
            </button>
          )}
        </div>

        {isOpen ? (
          <>
            <div className="sidebar-nav">
              <button
                className="sidebar-nav-item sidebar-nav-item-primary"
                onClick={() => {
                  onNewChat()
                  onCloseMobile?.()
                }}
              >
                <SquarePen size={16} />
                <span>New chat</span>
                <kbd className="sidebar-nav-shortcut">Alt+N</kbd>
              </button>
            </div>

            <div className="sidebar-search-card">
              <div className="sidebar-search visible">
                <SearchIcon size={14} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search chats"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchQuery('')
                      e.currentTarget.blur()
                    }
                  }}
                />
                {searchQuery ? (
                  <button className="search-clear" onClick={() => setSearchQuery('')}>
                    <X size={14} />
                  </button>
                ) : (
                  <span className="sidebar-search-hint">Ctrl+F</span>
                )}
              </div>
              <button className="sidebar-search-quick" onClick={openSearch} title="Search chats">
                <SearchIcon size={15} />
              </button>
            </div>

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
                        <Pin size={11} weight="fill" />
                        <span>Pinned</span>
                      </div>
                      {pinnedSessions.map((session) => renderSessionItem(session))}
                    </>
                  )}

                  {recentSessions.length > 0 && (
                    <>
                      <div className="sidebar-section-header">
                        <span>{pinnedSessions.length > 0 ? 'Recent' : 'Chats'}</span>
                      </div>
                      {recentSessions.map((session) => renderSessionItem(session))}
                      {!searchQuery && hasMoreSessions && (
                        <button
                          className="load-more-btn"
                          onClick={onLoadMoreSessions}
                          disabled={loadingMoreSessions}
                        >
                          {loadingMoreSessions ? 'Loading…' : 'Load more'}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {user &&
              (() => {
                const tokens = usageCurrent?.total_tokens || 0
                const percent = Math.min(
                  100,
                  Math.max(0, (tokens / USAGE_LIMIT_TOKENS) * 100)
                )
                const hasBucket = !!(usageCurrent && usageCurrent.bucket_end)
                return (
                  <div className="sidebar-usage" aria-label="Usage">
                    <div className="sidebar-usage-header">
                      <span className="sidebar-usage-label">Usage</span>
                      <span className="sidebar-usage-count">
                        {formatSidebarTokens(tokens)} /{' '}
                        {formatSidebarTokens(USAGE_LIMIT_TOKENS)}
                      </span>
                    </div>
                    <div className="sidebar-usage-bar">
                      <div
                        className="sidebar-usage-bar-fill"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="sidebar-usage-reset">
                      {hasBucket
                        ? formatResetWindow(usageCurrent!.resets_in_seconds)
                        : 'Resets every 5 hours'}
                    </span>
                  </div>
                )
              })()}

            {user && (
              <div className="sidebar-account" ref={accountRef}>
                {accountOpen && renderAccountDropdown()}
                <button
                  className={`sidebar-account-trigger ${accountOpen ? 'open' : ''}`}
                  onClick={() => setAccountOpen((prev) => !prev)}
                >
                  <div className="sidebar-account-avatar">
                    {user.avatar ? <img src={user.avatar} alt="" /> : displayInitial}
                  </div>
                  <div className="sidebar-account-copy">
                    <span className="sidebar-account-name">{displayName}</span>
                    {user.email && (
                      <span className="sidebar-account-email">{user.email}</span>
                    )}
                  </div>
                  <span
                    className="sidebar-account-settings"
                    role="button"
                    tabIndex={0}
                    title="Settings"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAccountOpen(false)
                      navigate('/settings')
                      onCloseMobile?.()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        setAccountOpen(false)
                        navigate('/settings')
                        onCloseMobile?.()
                      }
                    }}
                  >
                    <SettingsIcon size={14} />
                  </span>
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="sidebar-collapsed-actions">
              <button
                className="sidebar-rail-btn sidebar-rail-btn-primary"
                onClick={() => {
                  onNewChat()
                  onCloseMobile?.()
                }}
                title="New chat"
              >
                <SquarePen size={17} />
              </button>
              <button
                className="sidebar-rail-btn"
                onClick={onOpenCommandPalette}
                title="Search (Ctrl+K)"
              >
                <SearchIcon size={17} />
              </button>
            </div>

            {user && (
              <div className="sidebar-collapsed-footer" ref={accountRef}>
                {accountOpen && renderAccountDropdown()}
                <button
                  className={`sidebar-rail-profile ${accountOpen ? 'open' : ''}`}
                  onClick={() => setAccountOpen((prev) => !prev)}
                  title={displayName || 'Account'}
                >
                  <div className="sidebar-account-avatar">
                    {user.avatar ? <img src={user.avatar} alt="" /> : displayInitial}
                  </div>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {deleteConfirm.open &&
        createPortal(
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
          </div>,
          document.body
        )}

      {shareModal.open &&
        createPortal(
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
          </div>,
          document.body
        )}
    </div>
  )
}

export default memo(Sidebar)
