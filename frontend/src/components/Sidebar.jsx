import { useState, useEffect, useRef, memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Pin,
  Edit2,
  Share2,
  X,
  Search as SearchIcon,
  Settings as SettingsIcon,
  GitBranch,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Palette,
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
  // Folder props
  folders = [],
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveSessionToFolder,
}) {
  const [shareModal, setShareModal] = useState({ open: false, url: '', loading: false })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, sessionId: null, title: '' })
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState({
    open: false,
    folderId: null,
    name: '',
  })
  const [showToast, setShowToast] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [openMenuId, setOpenMenuId] = useState(null)
  const [collapsedFolders, setCollapsedFolders] = useState(() => {
    const saved = localStorage.getItem('llm-council-collapsed-folders')
    return saved ? JSON.parse(saved) : {}
  })
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [editFolderColor, setEditFolderColor] = useState(null)
  const [visibleCount, setVisibleCount] = useState(10)

  // Preset folder colors
  const folderColors = [
    null, // Default (no color)
    '#ef4444', // Red
    '#f97316', // Orange
    '#eab308', // Yellow
    '#22c55e', // Green
    '#06b6d4', // Cyan
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
  ]
  const [draggedSessionId, setDraggedSessionId] = useState(null)
  const [dragOverFolderId, setDragOverFolderId] = useState(null)
  const searchInputRef = useRef(null)
  const editInputRef = useRef(null)
  const newFolderInputRef = useRef(null)
  const editFolderInputRef = useRef(null)
  const menuRef = useRef(null)
  const location = useLocation()

  // Save collapsed folders to localStorage
  useEffect(() => {
    localStorage.setItem('llm-council-collapsed-folders', JSON.stringify(collapsedFolders))
  }, [collapsedFolders])

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

  // Group sessions by folder
  const sessionsByFolder = {}
  const unfolderedSessions = []

  filteredSessions.forEach((session) => {
    if (session.folder_id) {
      if (!sessionsByFolder[session.folder_id]) {
        sessionsByFolder[session.folder_id] = []
      }
      sessionsByFolder[session.folder_id].push(session)
    } else {
      unfolderedSessions.push(session)
    }
  })

  // Separate pinned and unpinned from unfoldered sessions
  const pinnedSessions = unfolderedSessions.filter((s) => s.is_pinned)
  const recentSessions = unfolderedSessions.filter((s) => !s.is_pinned)

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
      // Escape to clear search
      if (e.key === 'Escape' && searchQuery) {
        setSearchQuery('')
      }
    }
    // Use capture phase to intercept before browser
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
      // Build frontend share URL using configured frontend URL
      const frontendUrl = `${FRONTEND_URL}/shared/${data.share_token}`
      setShareModal({ open: true, url: frontendUrl, loading: false })
    } catch (error) {
      setShareModal({ open: false, url: '', loading: false })
    }
  }

  const handleBranch = async (e, sessionId) => {
    e.preventDefault()
    e.stopPropagation()
    if (onBranchSession) {
      await onBranchSession(sessionId)
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareModal.url)
    setShowToast(true)

    // Hide toast after 2 seconds
    setTimeout(() => {
      setShowToast(false)
    }, 2000)
  }

  const startEditing = (e, session) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title || session.question?.substring(0, 50) || '')
    // Focus the input after render
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

  // Folder functions
  const toggleFolderCollapsed = (folderId) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }))
  }

  const startCreatingFolder = () => {
    setIsCreatingFolder(true)
    setNewFolderName('')
    setNewFolderColor(null)
    setTimeout(() => newFolderInputRef.current?.focus(), 0)
  }

  const handleCreateFolder = async () => {
    if (newFolderName.trim() && onCreateFolder) {
      await onCreateFolder(newFolderName.trim(), newFolderColor)
      setIsCreatingFolder(false)
      setNewFolderName('')
      setNewFolderColor(null)
    } else {
      // Cancel if empty
      setIsCreatingFolder(false)
      setNewFolderName('')
      setNewFolderColor(null)
    }
  }

  const cancelCreateFolder = () => {
    setIsCreatingFolder(false)
    setNewFolderName('')
    setNewFolderColor(null)
  }

  // Handle blur - save if name exists, cancel if empty
  const handleCreateFolderBlur = (e) => {
    // Don't blur if clicking on color picker
    if (e.relatedTarget?.closest('.folder-color-picker')) {
      return
    }
    if (newFolderName.trim()) {
      handleCreateFolder()
    } else {
      cancelCreateFolder()
    }
  }

  const startEditingFolder = (e, folder) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingFolderId(folder.id)
    setEditFolderName(folder.name)
    setEditFolderColor(folder.color || null)
    setOpenMenuId(null)
    setTimeout(() => editFolderInputRef.current?.focus(), 0)
  }

  const saveEditFolder = async () => {
    if (editingFolderId && editFolderName.trim() && onUpdateFolder) {
      await onUpdateFolder(editingFolderId, { name: editFolderName.trim(), color: editFolderColor })
    }
    setEditingFolderId(null)
    setEditFolderName('')
    setEditFolderColor(null)
  }

  const cancelEditFolder = () => {
    setEditingFolderId(null)
    setEditFolderName('')
    setEditFolderColor(null)
  }

  const confirmDeleteFolder = (e, folder) => {
    e.preventDefault()
    e.stopPropagation()
    setDeleteFolderConfirm({ open: true, folderId: folder.id, name: folder.name })
    setOpenMenuId(null)
  }

  const handleDeleteFolder = async () => {
    if (deleteFolderConfirm.folderId && onDeleteFolder) {
      await onDeleteFolder(deleteFolderConfirm.folderId)
    }
    setDeleteFolderConfirm({ open: false, folderId: null, name: '' })
  }

  // Drag and drop handlers
  const handleDragStart = (e, sessionId) => {
    setDraggedSessionId(sessionId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', sessionId)
  }

  const handleDragEnd = () => {
    setDraggedSessionId(null)
    setDragOverFolderId(null)
  }

  const handleDragOver = (e, folderId) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId)
    }
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const relatedTarget = e.relatedTarget
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null)
    }
  }

  const handleDrop = async (e, folderId) => {
    e.preventDefault()
    e.stopPropagation()
    const sessionId = draggedSessionId || e.dataTransfer.getData('text/plain')
    if (sessionId && onMoveSessionToFolder) {
      await onMoveSessionToFolder(sessionId, folderId)
    }
    setDraggedSessionId(null)
    setDragOverFolderId(null)
  }

  const handleMoveToFolder = async (e, sessionId, folderId) => {
    e.preventDefault()
    e.stopPropagation()
    if (onMoveSessionToFolder) {
      await onMoveSessionToFolder(sessionId, folderId)
    }
    setOpenMenuId(null)
  }

  const renderSessionItem = (session, inFolder = false) => (
    <Link
      key={session.id}
      to={`/sessions/${session.id}`}
      className={`sidebar-session ${session.id === currentSessionId ? 'active' : ''} ${session.is_pinned ? 'pinned' : ''} ${inFolder ? 'in-folder' : ''} ${draggedSessionId === session.id ? 'dragging' : ''}`}
      draggable="true"
      onDragStart={(e) => handleDragStart(e, session.id)}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        if (editingId === session.id) {
          e.preventDefault()
        } else {
          onClose()
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
              {branchingEnabled && (
                <button
                  onClick={(e) => {
                    handleBranch(e, session.id)
                    setOpenMenuId(null)
                  }}
                >
                  <GitBranch size={14} />
                  Branch
                </button>
              )}
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
              <div className="menu-submenu">
                <button className="submenu-trigger">
                  <Folder size={14} />
                  Move to folder
                  <ChevronRight size={12} />
                </button>
                <div className="submenu-content">
                  {session.folder_id && (
                    <button onClick={(e) => handleMoveToFolder(e, session.id, null)}>
                      Remove from folder
                    </button>
                  )}
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={(e) => handleMoveToFolder(e, session.id, folder.id)}
                      disabled={session.folder_id === folder.id}
                      className="folder-option"
                    >
                      {folder.color && (
                        <span
                          className="folder-color-dot"
                          style={{ backgroundColor: folder.color }}
                        />
                      )}
                      {folder.name}
                    </button>
                  ))}
                  {onCreateFolder && (
                    <button
                      className="create-folder-option"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setOpenMenuId(null)
                        startCreatingFolder()
                      }}
                    >
                      <FolderPlus size={12} />
                      New folder...
                    </button>
                  )}
                </div>
              </div>
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
        <button className="sidebar-close" onClick={onClose}>
          <X size={20} />
        </button>
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
        {filteredSessions.length === 0 && folders.length === 0 ? (
          <p className="sidebar-empty">
            {searchQuery ? `No results for '${searchQuery}'` : 'No chat history yet'}
          </p>
        ) : (
          <>
            {/* Folders Section */}
            {folders.length > 0 && (
              <div className="sidebar-section-header folders-header">
                <Folder size={12} />
                <span>Folders</span>
                <button
                  className="add-folder-btn"
                  onClick={startCreatingFolder}
                  title="Create folder"
                >
                  <FolderPlus size={14} />
                </button>
              </div>
            )}

            {isCreatingFolder && (
              <div className="new-folder-container">
                <div className="new-folder-input-container">
                  <Folder
                    size={14}
                    className="new-folder-icon"
                    style={newFolderColor ? { color: newFolderColor } : {}}
                  />
                  <input
                    ref={newFolderInputRef}
                    type="text"
                    className="new-folder-input"
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') cancelCreateFolder()
                    }}
                    onBlur={handleCreateFolderBlur}
                  />
                  {newFolderName.trim() && (
                    <button
                      className="new-folder-save-btn"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleCreateFolder()
                      }}
                      title="Save folder (Enter)"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="folder-color-picker">
                  {folderColors.map((color, index) => (
                    <button
                      key={index}
                      className={`color-dot ${newFolderColor === color ? 'selected' : ''} ${!color ? 'no-color' : ''}`}
                      style={color ? { backgroundColor: color } : {}}
                      onClick={() => setNewFolderColor(color)}
                      title={color || 'Default'}
                    />
                  ))}
                </div>
              </div>
            )}

            {folders.map((folder) => (
              <div key={folder.id} className="folder-container">
                <div
                  className={`folder-header ${dragOverFolderId === folder.id ? 'drag-over' : ''}`}
                  onClick={() => toggleFolderCollapsed(folder.id)}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  <div className="folder-info">
                    {collapsedFolders[folder.id] ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    <Folder size={14} style={folder.color ? { color: folder.color } : {}} />
                    {editingFolderId === folder.id ? (
                      <div className="folder-edit-wrapper" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={editFolderInputRef}
                          type="text"
                          className="folder-edit-input"
                          value={editFolderName}
                          onChange={(e) => setEditFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditFolder()
                            if (e.key === 'Escape') cancelEditFolder()
                          }}
                          onBlur={(e) => {
                            // Don't blur if clicking on color picker
                            if (e.relatedTarget?.closest('.folder-edit-colors')) return
                            saveEditFolder()
                          }}
                        />
                        <div className="folder-edit-colors">
                          {folderColors.map((color, index) => (
                            <button
                              key={index}
                              className={`color-dot ${editFolderColor === color ? 'selected' : ''} ${!color ? 'no-color' : ''}`}
                              style={color ? { backgroundColor: color } : {}}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setEditFolderColor(color)
                              }}
                              title={color || 'Default'}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="folder-name">{folder.name}</span>
                    )}
                    <span className="folder-count">
                      ({sessionsByFolder[folder.id]?.length || 0})
                    </span>
                  </div>
                  <div className="folder-actions">
                    <div
                      className="session-menu-container"
                      ref={openMenuId === `folder-${folder.id}` ? menuRef : null}
                    >
                      <button
                        className="session-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleMenu(e, `folder-${folder.id}`)
                        }}
                      >
                        <MoreVertical size={14} />
                      </button>
                      {openMenuId === `folder-${folder.id}` && (
                        <div className="session-menu-dropdown">
                          <button onClick={(e) => startEditingFolder(e, folder)}>
                            <Edit2 size={14} />
                            Rename
                          </button>
                          <div className="menu-color-section">
                            <div className="menu-color-label">
                              <Palette size={14} />
                              Color
                            </div>
                            <div className="menu-color-picker">
                              {folderColors.map((color, index) => (
                                <button
                                  key={index}
                                  className={`menu-color-dot ${folder.color === color ? 'selected' : ''} ${!color ? 'no-color' : ''}`}
                                  style={color ? { backgroundColor: color } : {}}
                                  onClick={async (e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (onUpdateFolder) {
                                      await onUpdateFolder(folder.id, { color })
                                    }
                                  }}
                                  title={color || 'Default'}
                                />
                              ))}
                            </div>
                          </div>
                          <button
                            className="danger"
                            onClick={(e) => confirmDeleteFolder(e, folder)}
                          >
                            <X size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {!collapsedFolders[folder.id] && sessionsByFolder[folder.id]?.length > 0 && (
                  <div className="folder-sessions">
                    {sessionsByFolder[folder.id].map((session) => renderSessionItem(session, true))}
                  </div>
                )}
              </div>
            ))}

            {/* Create Folder Button (if no folders exist) */}
            {folders.length === 0 && onCreateFolder && (
              <button className="create-folder-btn" onClick={startCreatingFolder}>
                <FolderPlus size={14} />
                Create folder
              </button>
            )}

            {/* Pinned Sessions (not in folders) */}
            {pinnedSessions.length > 0 && (
              <>
                <div className="sidebar-section-header">
                  <Pin size={12} fill="currentColor" />
                  <span>Pinned</span>
                </div>
                {pinnedSessions.map((session) => renderSessionItem(session))}
              </>
            )}

            {/* Recent Sessions (not in folders) - paginated */}
            {recentSessions.length > 0 && (
              <>
                {(pinnedSessions.length > 0 || folders.length > 0) && (
                  <div
                    className={`sidebar-section-header ${dragOverFolderId === null && draggedSessionId ? 'drag-over' : ''}`}
                    onDragOver={(e) => handleDragOver(e, null)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, null)}
                  >
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
        onClick={onClose}
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

      {deleteFolderConfirm.open && (
        <div
          className="delete-modal-overlay"
          onClick={() => setDeleteFolderConfirm({ open: false, folderId: null, name: '' })}
        >
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-icon">
              <Folder size={24} />
            </div>
            <h3>Delete Folder?</h3>
            <p>
              Are you sure you want to delete the folder{' '}
              <strong>"{deleteFolderConfirm.name}"</strong>? Sessions inside will be moved out but
              not deleted.
            </p>
            <div className="delete-modal-actions">
              <button
                className="delete-cancel"
                onClick={() => setDeleteFolderConfirm({ open: false, folderId: null, name: '' })}
              >
                Cancel
              </button>
              <button className="delete-confirm" onClick={handleDeleteFolder}>
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
