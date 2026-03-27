import { useState } from 'react'
import { FRONTEND_URL } from '../config/api'

function SessionActions({ sessionId, onExport, onBranch, onShare, branchingEnabled = false }) {
  const [shareModal, setShareModal] = useState({ open: false, url: '', loading: false })
  const [showToast, setShowToast] = useState(false)

  const handleShare = async () => {
    if (!sessionId || !onShare) return
    setShareModal({ open: true, url: '', loading: true })
    try {
      const data = await onShare(sessionId)
      const frontendUrl = `${FRONTEND_URL}/shared/${data.share_token}`
      setShareModal({ open: true, url: frontendUrl, loading: false })
    } catch {
      setShareModal({ open: false, url: '', loading: false })
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareModal.url)
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  return (
    <>
      <div className="session-actions-bar">
        <button className="session-action-btn" onClick={onExport} title="Export to Markdown">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        {branchingEnabled && (
          <button className="session-action-btn" onClick={onBranch} title="Branch from here">
            <svg
              width="15"
              height="15"
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
          </button>
        )}
        <button className="session-action-btn" onClick={handleShare} title="Share session">
          <svg
            width="15"
            height="15"
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

export default SessionActions
