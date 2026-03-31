import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Download,
  Settings,
  Palette,
  Info,
  MessageSquare,
  Star,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { apiClient } from '../config/api'
import './CommandPalette.css'

interface Session {
  id: string
  title?: string
  question?: string
  round_count?: number
  created_at?: string
  is_pinned?: boolean
}

interface CommandItem {
  type: 'action' | 'settings' | 'session'
  icon: LucideIcon
  title: string
  description: string
  action: () => void
  isPinned?: boolean
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  sessions: Session[]
  onNewChat: () => void
  onExport: () => void
  currentSessionId: string | null
}

let lastKnownStatus = 'checking'

function CommandPalette({
  isOpen,
  onClose,
  sessions,
  onNewChat,
  onExport,
  currentSessionId,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<Session[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const [apiStatus, setApiStatus] = useState(() => lastKnownStatus)

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await apiClient.get('/health')
        setApiStatus('healthy')
        lastKnownStatus = 'healthy'
      } catch {
        setApiStatus('unhealthy')
        lastKnownStatus = 'unhealthy'
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 300000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!query.trim() || query.trim().length < 3) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await apiClient.get(`/sessions/search?q=${encodeURIComponent(query.trim())}`)
        setSearchResults(res.data.sessions || [])
      } catch {
        setSearchResults(null)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query])

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIndex(0)
      setSearchResults(null)
    }
  }, [isOpen])

  const getItems = (): CommandItem[] => {
    const items: CommandItem[] = []

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
      icon: Info,
      title: 'Settings › About',
      description: 'Version and keyboard shortcuts',
      action: () => {
        navigate('/settings?tab=about')
        onClose()
      },
    })

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const sessionsSource = searchResults && query.trim().length >= 3 ? searchResults : null
    const sessionsToShow = sessionsSource
      ? sessionsSource
      : query.trim()
        ? sessions
        : sessions
            .filter((s) => s.created_at && new Date(s.created_at).getTime() > oneDayAgo)
            .slice(0, 3)

    const seen = new Set<string>()
    sessionsToShow.forEach((session) => {
      if (seen.has(session.id)) return
      seen.add(session.id)
      const title = session.title || session.question || 'Untitled'
      items.push({
        type: 'session',
        icon: MessageSquare,
        title: title.length > 60 ? title.substring(0, 60) + '...' : title,
        description: sessionsSource
          ? 'Content match'
          : `${session.round_count} round${(session.round_count || 0) > 1 ? 's' : ''}`,
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

  const filteredItems = query.trim()
    ? items.filter((item) =>
        `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())
      )
    : items

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[selectedIndex]) filteredItems[selectedIndex].action()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredItems, selectedIndex, onClose])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!isOpen) return null

  const typeLabels: Record<string, string> = {
    action: 'Quick Actions',
    settings: 'Settings',
    session: 'Chat Sessions',
  }

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
          <div className="command-palette-hint desktop-only">
            <kbd>Esc</kbd> to close
          </div>
        </div>

        <div className="command-palette-results">
          {filteredItems.length === 0 ? (
            <div className="command-palette-empty">
              <p>{searching ? 'Searching messages...' : `No results found for "${query}"`}</p>
            </div>
          ) : (
            <>
              {(['action', 'settings', 'session'] as const).map((type) => {
                const typeItems = filteredItems.filter((item) => item.type === type)
                if (typeItems.length === 0) return null
                return (
                  <div key={type} className="command-palette-group">
                    <div className="command-palette-group-title">{typeLabels[type]}</div>
                    {typeItems.map((item) => {
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
          <span
            className="command-palette-status"
            onClick={() => {
              navigate('/status')
              onClose()
            }}
          >
            <span className={`banner-dot ${apiStatus}`}></span>
            {apiStatus === 'checking'
              ? 'Checking server...'
              : apiStatus === 'unhealthy'
                ? 'Server is experiencing issues'
                : 'All systems operational'}
          </span>
          <span className="command-palette-footer-keys">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Select
            </span>
            <span>
              <kbd>Esc</kbd> Close
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
