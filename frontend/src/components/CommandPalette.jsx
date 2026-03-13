import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Download,
  Settings,
  Palette,
  Cpu,
  Info,
  MessageSquare,
  Star,
  Search,
} from 'lucide-react'
import './CommandPalette.css'

function CommandPalette({ isOpen, onClose, sessions, onNewChat, onExport, currentSessionId }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Define all available commands and items
  const getItems = () => {
    const items = []

    // Quick Actions
    items.push({
      type: 'action',
      icon: Plus,
      title: 'New Chat',
      description: 'Start a new conversation',
      action: () => {
        onNewChat()
        onClose()
      },
    })

    if (currentSessionId) {
      items.push({
        type: 'action',
        icon: Download,
        title: 'Export Current Session',
        description: 'Download session as markdown',
        action: () => {
          onExport()
          onClose()
        },
      })
    }

    // Settings sections
    items.push({
      type: 'settings',
      icon: Settings,
      title: 'Settings',
      description: 'Open settings page',
      action: () => {
        navigate('/settings')
        onClose()
      },
    })

    items.push({
      type: 'settings',
      icon: Palette,
      title: 'Settings › Appearance',
      description: 'Theme and display options',
      action: () => {
        navigate('/settings?tab=general')
        onClose()
      },
    })

    items.push({
      type: 'settings',
      icon: Cpu,
      title: 'Settings › Models',
      description: 'Select and configure AI models',
      action: () => {
        navigate('/settings?tab=models')
        onClose()
      },
    })

    items.push({
      type: 'settings',
      icon: Info,
      title: 'Settings › About',
      description: 'Version and keyboard shortcuts',
      action: () => {
        navigate('/settings?tab=about')
        onClose()
      },
    })

    // Chat sessions — when not searching, show only 3 most recent (max 1 day old)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const sessionsToShow = query.trim()
      ? sessions
      : sessions
          .filter((s) => s.created_at && new Date(s.created_at).getTime() > oneDayAgo)
          .slice(0, 3)

    sessionsToShow.forEach((session) => {
      const title = session.title || session.question || 'Untitled'
      items.push({
        type: 'session',
        icon: MessageSquare,
        title: title.length > 60 ? title.substring(0, 60) + '...' : title,
        description: `${session.round_count} round${session.round_count > 1 ? 's' : ''}`,
        action: () => {
          navigate(`/sessions/${session.id}`)
          onClose()
        },
        isPinned: session.is_pinned,
      })
    })

    return items
  }

  const items = getItems()

  // Filter items based on query
  const filteredItems = query.trim()
    ? items.filter((item) => {
        const searchText = `${item.title} ${item.description}`.toLowerCase()
        return searchText.includes(query.toLowerCase())
      })
    : items

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredItems, selectedIndex, onClose])

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!isOpen) return null

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search sessions, settings, or type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="command-palette-hint">
            <kbd>Esc</kbd> to close
          </div>
        </div>

        <div className="command-palette-results">
          {filteredItems.length === 0 ? (
            <div className="command-palette-empty">
              <p>No results found for "{query}"</p>
            </div>
          ) : (
            <>
              {/* Group by type */}
              {['action', 'settings', 'session'].map((type) => {
                const typeItems = filteredItems.filter((item) => item.type === type)
                if (typeItems.length === 0) return null

                const typeLabels = {
                  action: 'Quick Actions',
                  settings: 'Settings',
                  session: 'Chat Sessions',
                }

                return (
                  <div key={type} className="command-palette-group">
                    <div className="command-palette-group-title">{typeLabels[type]}</div>
                    {typeItems.map((item, index) => {
                      const globalIndex = filteredItems.indexOf(item)
                      const IconComponent = item.icon
                      return (
                        <div
                          key={globalIndex}
                          className={`command-palette-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                          onClick={item.action}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                        >
                          <span className="command-palette-icon">
                            <IconComponent size={18} />
                          </span>
                          <div className="command-palette-item-content">
                            <div className="command-palette-item-title">
                              {item.isPinned && (
                                <span className="pin-badge">
                                  <Star size={12} fill="currentColor" />
                                </span>
                              )}
                              {item.title}
                            </div>
                            <div className="command-palette-item-description">
                              {item.description}
                            </div>
                          </div>
                          {globalIndex === selectedIndex && (
                            <div className="command-palette-enter-hint">
                              <kbd>↵</kbd>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Select
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
