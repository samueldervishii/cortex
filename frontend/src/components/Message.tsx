import { useState, memo } from 'react'
import { CopyIcon as Copy } from '@phosphor-icons/react/Copy'
import { CheckIcon as Check } from '@phosphor-icons/react/Check'
import { DownloadSimpleIcon as Download } from '@phosphor-icons/react/DownloadSimple'
import { FileTextIcon as FileText } from '@phosphor-icons/react/FileText'
import { ThumbsUpIcon as ThumbsUp } from '@phosphor-icons/react/ThumbsUp'
import { ThumbsDownIcon as ThumbsDown } from '@phosphor-icons/react/ThumbsDown'
import { GitBranchIcon as GitBranch } from '@phosphor-icons/react/GitBranch'
import { API_BASE, getAccessToken } from '../config/api'
import { apiClient } from '../config/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import FeedbackModal from './FeedbackModal'

function formatResponseTime(ms?: number) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface FileInfo {
  filename: string
}

interface MessageProps {
  role: 'user' | 'assistant' | 'error'
  content: string
  modelName?: string
  responseTime?: number
  streaming?: boolean
  file?: FileInfo
  messageIndex: number
  sessionId?: string
  isArtifact?: boolean
  onBranch?: (messageIndex: number) => void
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
  file,
  messageIndex,
  sessionId,
  isArtifact,
  onBranch,
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
  const formattedTime = formatResponseTime(responseTime)

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
      a.download = 'cortex-document.docx'
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
          {userAvatar ? (
            <img src={userAvatar} alt="" />
          ) : (
            <span>{userInitial}</span>
          )}
        </div>
        <div className="message-body">
          <div className="message-header">
            <span className="message-role-label">{userDisplayName}</span>
          </div>
          {file && (
            <button
              className="message-file-badge"
              onClick={async () => {
                if (!sessionId || messageIndex == null) return
                try {
                  const token = getAccessToken()
                  const res = await fetch(
                    `${API_BASE}/session/${sessionId}/file/${messageIndex}`,
                    {
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    }
                  )
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
          )}
          <div className="message-content">
            <p>{content}</p>
          </div>
          <div className="message-actions">
            <button className="message-action-btn" onClick={handleCopy} title="Copy">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
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
          <img src="/IMG_6935.png" alt="" />
        </div>
        <div className="message-body">
          <div className="message-header">
            <span className="message-role-label">Cortex</span>
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
            <div className="artifact-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {content}
              </ReactMarkdown>
            </div>
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
        <img src="/IMG_6935.png" alt="" />
      </div>
      <div className="message-body message-assistant-content">
        <div className="message-header">
          <span className="message-role-label">Cortex</span>
          {modelName && <span className="model-name">{modelName}</span>}
          {formattedTime && <span className="response-time">{formattedTime}</span>}
        </div>
        <div className="message-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
            {content}
          </ReactMarkdown>
        </div>
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
