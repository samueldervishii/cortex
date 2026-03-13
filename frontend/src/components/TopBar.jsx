import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FRONTEND_URL, apiClient } from '../config/api'

function TopBar({
  onNewChat,
  onToggleSidebar,
  sessionId,
  onShare,
  onExport,
  onBranch,
  onOpenCommandPalette,
  onOpenIncognito,
  branchingEnabled = false,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const isRootPath = location.pathname === '/'
  const showGlobalActions = isRootPath || location.pathname.startsWith('/settings') || location.pathname.startsWith('/status')
  const [shareModal, setShareModal] = useState({ open: false, url: '', loading: false })
  const [showToast, setShowToast] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking') // 'healthy', 'unhealthy', 'checking'

  // Check API health status periodically
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await apiClient.get('/health')
        setApiStatus('healthy')
      } catch {
        setApiStatus('unhealthy')
      }
    }

    checkHealth()
    const interval = setInterval(checkHealth, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const handleShare = async () => {
    if (!sessionId || !onShare) return
    setShareModal({ open: true, url: '', loading: true })
    try {
      const data = await onShare(sessionId)
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

  const handleExport = () => {
    if (onExport) onExport()
  }

  return (
    <>
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
              className={`status-indicator ${apiStatus}`}
              onClick={() => navigate('/status')}
              title={
                apiStatus === 'healthy'
                  ? 'All systems operational'
                  : apiStatus === 'unhealthy'
                    ? 'System issues detected'
                    : 'Checking status...'
              }
            >
              <span className="status-dot"></span>
              <span className="status-text">
                {apiStatus === 'healthy'
                  ? 'Operational'
                  : apiStatus === 'unhealthy'
                    ? 'Issues'
                    : 'Checking'}
              </span>
            </button>
          )}

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

          {sessionId && (
            <>
              <button className="top-bar-action" onClick={handleExport} title="Export to Markdown">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="button-text">Export</span>
              </button>
              {branchingEnabled && (
                <button
                  className="top-bar-action branch-btn"
                  onClick={() => onBranch()}
                  title="Branch from current state"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span className="button-text">Branch</span>
                </button>
              )}
              <button className="top-bar-action" onClick={handleShare} title="Share session">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                <span className="button-text">Share</span>
              </button>
            </>
          )}
        </div>
      </div>

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
    </>
  )
}

export default TopBar
