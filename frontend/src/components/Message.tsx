import { useState, memo, useRef, useEffect } from 'react'
import { CopyIcon as Copy } from '@phosphor-icons/react/Copy'
import { CheckIcon as Check } from '@phosphor-icons/react/Check'
import { DownloadSimpleIcon as Download } from '@phosphor-icons/react/DownloadSimple'
import { FileTextIcon as FileText } from '@phosphor-icons/react/FileText'
import { ThumbsUpIcon as ThumbsUp } from '@phosphor-icons/react/ThumbsUp'
import { ThumbsDownIcon as ThumbsDown } from '@phosphor-icons/react/ThumbsDown'
import { GitBranchIcon as GitBranch } from '@phosphor-icons/react/GitBranch'
import { PencilSimpleIcon as Pencil } from '@phosphor-icons/react/PencilSimple'
import { ArrowClockwiseIcon as ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise'
import { API_BASE, getAccessToken } from '../config/api'
import { apiClient } from '../config/api'
import MarkdownRenderer from './MarkdownRenderer'
import FeedbackModal from './FeedbackModal'

function formatResponseTime(ms?: number) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface FileInfo {
  filename: string
  contentType?: string
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i

function isImageFile(file?: FileInfo) {
  if (!file) return false
  if (file.contentType && file.contentType.startsWith('image/')) return true
  return IMAGE_EXT_RE.test(file.filename || '')
}

interface MessageProps {
  role: 'user' | 'assistant' | 'error'
  content: string
  modelName?: string
  responseTime?: number
  streaming?: boolean
  /**
   * Live status text shown inline next to the model name while
   * streaming (e.g. "Thinking", "Searching the web"). Only the last
   * streaming assistant message receives this; once tokens start
   * flowing the caller clears it.
   */
  streamingStep?: string
  wasCancelled?: boolean
  file?: FileInfo
  messageIndex: number
  sessionId?: string
  isArtifact?: boolean
  onBranch?: (messageIndex: number) => void
  onEdit?: (messageIndex: number, newContent: string) => Promise<void> | void
  onRegenerate?: (messageIndex: number) => Promise<void> | void
  citations?: Citation[]
  userAvatar?: string | null
  userInitial?: string
  userDisplayName?: string
}

export interface Citation {
  id: string
  text: string
  source: string
  page?: number | string
}

function Message({
  role,
  content,
  modelName,
  responseTime,
  streaming,
  streamingStep,
  wasCancelled,
  file,
  messageIndex,
  sessionId,
  isArtifact,
  onBranch,
  onEdit,
  onRegenerate,
  citations,
  userAvatar,
  userInitial = 'U',
  userDisplayName = 'You',
}: MessageProps) {
  const [copied, setCopied] = useState(false)
  const [feedbackType, setFeedbackType] = useState<'positive' | 'negative' | null>(null)
  const [submittedRating, setSubmittedRating] = useState<'positive' | 'negative' | null>(null)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(content)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const formattedTime = formatResponseTime(responseTime)

  // Auto-grow + focus the edit textarea when entering edit mode.
  useEffect(() => {
    if (!isEditing) return
    const ta = editTextareaRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`
  }, [isEditing])

  const handleStartEdit = () => {
    setEditValue(content)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(content)
  }

  const handleSubmitEdit = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || !onEdit) return
    if (trimmed === content.trim()) {
      setIsEditing(false)
      return
    }
    setIsEditing(false)
    try {
      await onEdit(messageIndex, trimmed)
    } catch (err) {
      console.error('Edit submit failed:', err)
    }
  }

  const handleCopy = async () => {
    try {
      const plainText = content
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}\w*\n?/g, ''))
        .replace(/`(.+?)`/g, '$1')
        .replace(/^[-*]\s+/gm, '- ')
        .replace(/^\d+\.\s+/gm, (m) => m)
        .replace(/^---+$/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleFeedbackClick = (type: 'positive' | 'negative') => {
    setFeedbackType(type)
    setShowFeedbackModal(true)
  }

  const handleFeedbackSubmit = async (comment: string, issueType?: string) => {
    if (!sessionId || isSubmitting) return
    setIsSubmitting(true)
    try {
      await apiClient.post(`/session/${sessionId}/feedback`, {
        message_index: messageIndex,
        rating: feedbackType,
        comment: comment || null,
        issue_type: issueType || null,
      })
      setSubmittedRating(feedbackType)
    } catch (err) {
      console.error('Feedback failed:', err)
    } finally {
      setIsSubmitting(false)
      setShowFeedbackModal(false)
      setFeedbackType(null)
    }
  }

  const handleDownloadDocx = async () => {
    if (!sessionId || messageIndex == null) return
    try {
      const token = getAccessToken()
      const res = await fetch(
        `${API_BASE}/session/${sessionId}/message/${messageIndex}/export-docx`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      )
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'etude-document.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('DOCX download failed:', err)
    }
  }

  if (role === 'user') {
    return (
      <div className="message user">
        <div className="message-avatar message-avatar-user" aria-hidden="true">
          {userAvatar ? <img src={userAvatar} alt="" /> : <span>{userInitial}</span>}
        </div>
        <div className="message-body">
          <div className="message-header">
            <span className="message-role-label">{userDisplayName}</span>
          </div>
          {file && isImageFile(file) ? (
            <ImageAttachment
              sessionId={sessionId}
              messageIndex={messageIndex}
              filename={file.filename}
            />
          ) : file ? (
            <button
              className="message-file-badge"
              onClick={async () => {
                if (!sessionId || messageIndex == null) return
                try {
                  const token = getAccessToken()
                  const res = await fetch(`${API_BASE}/session/${sessionId}/file/${messageIndex}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                  })
                  if (!res.ok) return
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = file.filename
                  a.click()
                  URL.revokeObjectURL(url)
                } catch (err) {
                  console.error('Download failed:', err)
                }
              }}
              title="Download file"
            >
              <FileText size={13} />
              {file.filename}
            </button>
          ) : null}
          {isEditing ? (
            <div className="message-edit">
              <textarea
                ref={editTextareaRef}
                className="message-edit-textarea"
                value={editValue}
                onChange={(e) => {
                  setEditValue(e.target.value)
                  const ta = e.target as HTMLTextAreaElement
                  ta.style.height = 'auto'
                  ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    handleCancelEdit()
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSubmitEdit()
                  }
                }}
                rows={3}
              />
              <div className="message-edit-actions">
                <button
                  type="button"
                  className="message-edit-btn message-edit-btn-cancel"
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="message-edit-btn message-edit-btn-save"
                  onClick={handleSubmitEdit}
                  disabled={!editValue.trim() || editValue.trim() === content.trim()}
                >
                  Save & regenerate
                </button>
              </div>
            </div>
          ) : (
            <div className="message-content">
              <p>{content}</p>
            </div>
          )}
          {!isEditing && (
            <div className="message-actions">
              <button className="message-action-btn" onClick={handleCopy} title="Copy">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              {onEdit && sessionId && !file && (
                <button
                  className="message-action-btn"
                  onClick={handleStartEdit}
                  title="Edit message"
                >
                  <Pencil size={14} />
                </button>
              )}
              {onBranch && sessionId && (
                <button
                  className="message-action-btn"
                  onClick={() => onBranch(messageIndex)}
                  title="Branch from here"
                >
                  <GitBranch size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (role === 'error') {
    return (
      <div className="message error">
        <div className="message-content">
          <p>{content}</p>
        </div>
      </div>
    )
  }

  // Artifact card for generated documents
  if (isArtifact) {
    const titleMatch = content.match(/^#+ (.+)/m)
    const artifactTitle = titleMatch ? titleMatch[1] : 'Generated Document'
    const isEmpty = !content.trim()

    return (
      <div className="message assistant message-artifact">
        <div className="message-avatar message-avatar-cortex" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </div>
        <div className="message-body">
          <div className="message-header">
            <span className="message-role-label">Étude</span>
          </div>
          <div className="artifact-card">
            <div className="artifact-header">
              <div className="artifact-title-row">
                <FileText size={16} />
                <span className="artifact-title">{isEmpty ? 'Generating...' : artifactTitle}</span>
                {streaming && <span className="artifact-generating">writing</span>}
              </div>
            </div>
            {isEmpty ? (
              <div className="artifact-loading">
                <div className="artifact-loading-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : (
              <MarkdownRenderer className="artifact-body">{content}</MarkdownRenderer>
            )}
            {!streaming && !isEmpty && (
              <div className="artifact-footer">
                <button className="artifact-btn" onClick={handleCopy} title="Copy text">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  className="artifact-btn"
                  onClick={handleDownloadDocx}
                  title="Download as DOCX"
                >
                  <Download size={14} />
                  DOCX
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Normal assistant message
  return (
    <div className="message assistant">
      <div className="message-avatar message-avatar-cortex" aria-hidden="true">
        <img src="/logo.png" alt="" />
      </div>
      <div className="message-body message-assistant-content">
        <div className="message-header">
          <span className="message-role-label">Étude</span>
          {modelName && <span className="model-name">{modelName}</span>}
          {formattedTime && <span className="response-time">{formattedTime}</span>}
          {streaming && streamingStep && (
            <span className="message-streaming-step" aria-live="polite">
              <span className="message-streaming-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {streamingStep}
            </span>
          )}
          {wasCancelled && <span className="message-cancelled-badge">stopped</span>}
        </div>
        <MarkdownRenderer className="message-content">{content}</MarkdownRenderer>
        {citations && citations.length > 0 && <CitationList citations={citations} />}
        {!streaming && content && (
          <div className="message-actions">
            <button className="message-action-btn" onClick={handleCopy} title="Copy">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              className={`message-action-btn ${submittedRating === 'positive' ? 'active' : ''}`}
              onClick={() => handleFeedbackClick('positive')}
              title="Good response"
            >
              <ThumbsUp size={14} />
            </button>
            <button
              className={`message-action-btn ${submittedRating === 'negative' ? 'active' : ''}`}
              onClick={() => handleFeedbackClick('negative')}
              title="Bad response"
            >
              <ThumbsDown size={14} />
            </button>
            {onRegenerate && sessionId && (
              <button
                className="message-action-btn"
                onClick={() => onRegenerate(messageIndex)}
                title="Regenerate response"
              >
                <ArrowClockwise size={14} />
              </button>
            )}
            {onBranch && sessionId && (
              <button
                className="message-action-btn"
                onClick={() => onBranch(messageIndex)}
                title="Branch from here"
              >
                <GitBranch size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {showFeedbackModal && feedbackType && (
        <FeedbackModal
          type={feedbackType}
          onSubmit={handleFeedbackSubmit}
          onClose={() => {
            setShowFeedbackModal(false)
            setFeedbackType(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Lazy thumbnail loader for image attachments.
 *
 * The file route requires an Authorization header, so we can't drop
 * the URL into ``<img src>`` directly — fetch the bytes, build an
 * object URL, and revoke it on unmount to avoid blob leaks. Shows a
 * lightweight placeholder while loading and falls back to a plain
 * filename badge if the fetch fails.
 */
function ImageAttachment({
  sessionId,
  messageIndex,
  filename,
}: {
  sessionId?: string
  messageIndex: number
  filename: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!sessionId || messageIndex == null) return
    let revoke: string | null = null
    let cancelled = false
    ;(async () => {
      try {
        const token = getAccessToken()
        const res = await fetch(`${API_BASE}/session/${sessionId}/file/${messageIndex}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) {
          if (!cancelled) setErrored(true)
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        revoke = url
        if (!cancelled) setSrc(url)
        else URL.revokeObjectURL(url)
      } catch {
        if (!cancelled) setErrored(true)
      }
    })()
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [sessionId, messageIndex])

  if (errored) {
    return (
      <div className="message-file-badge" title={filename}>
        <FileText size={13} />
        {filename}
      </div>
    )
  }
  if (!src) {
    return (
      <div className="message-image-thumb message-image-thumb-loading" aria-label="Loading image">
        <span className="message-image-thumb-spinner" />
      </div>
    )
  }
  return (
    <a
      className="message-image-thumb"
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title={filename}
    >
      <img src={src} alt={filename} />
    </a>
  )
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="citations">
      <div className="citations-label">Sources</div>
      <div className="citation-chips">
        {citations.map((c) => (
          <button
            key={c.id}
            className={`citation-chip ${expandedId === c.id ? 'expanded' : ''}`}
            onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
          >
            <FileText size={12} />
            <span>
              {c.source}
              {c.page ? ` · p.${c.page}` : ''}
            </span>
          </button>
        ))}
      </div>
      {expandedId &&
        (() => {
          const c = citations.find((x) => x.id === expandedId)
          if (!c) return null
          return (
            <div className="citation-excerpt">
              <div className="citation-excerpt-header">
                <span>
                  {c.source}
                  {c.page ? ` — Page ${c.page}` : ''}
                </span>
                <button onClick={() => setExpandedId(null)}>&times;</button>
              </div>
              <p>{c.text}</p>
            </div>
          )
        })()}
    </div>
  )
}

export default memo(Message)
