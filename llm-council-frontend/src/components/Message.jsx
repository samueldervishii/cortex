import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

// Color palette for different models
const MODEL_COLORS = {
  'Claude Sonnet 4.6': '#d97706',
  'Claude Haiku 4.5': '#8b5cf6',
  'GPT OSS 120B': '#0467df',
  'Qwen 3 32B': '#10b981',
  'GPT OSS 20B': '#ef4444',
}

// Mention names → color (includes short aliases models actually use)
const MENTION_COLORS = {
  ...MODEL_COLORS,
  'Claude Sonnet': '#d97706',
  'Claude Haiku': '#8b5cf6',
  'Qwen': '#10b981',
  'User': '#9ca3af',
}

function getModelColor(modelName) {
  return MODEL_COLORS[modelName] || MENTION_COLORS[modelName] || '#d4a574'
}

function formatResponseTime(ms) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Parse @mentions in text and wrap them with styled spans
function highlightMentions(text) {
  if (!text) return text
  const mentionNames = Object.keys(MENTION_COLORS)
  // Sort by length descending so "Claude Sonnet 4.6" matches before "Claude Sonnet"
  mentionNames.sort((a, b) => b.length - a.length)
  const pattern = mentionNames.map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')
  const regex = new RegExp(`(${pattern})`, 'g')

  const parts = text.split(regex)
  if (parts.length === 1) return text

  return parts.map((part, i) => {
    if (part && part.startsWith('@')) {
      const name = part.slice(1)
      const color = MENTION_COLORS[name] || '#d4a574'
      return (
        <span key={i} className="mention-tag" style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40` }}>
          {part}
        </span>
      )
    }
    return part
  })
}

function Message({ type, content, modelName, disagreement, replyTo, responseTime, streaming }) {
  const [copied, setCopied] = useState(false)
  const hasDisagreement = disagreement?.has_disagreement
  const disagreementScore = disagreement?.disagreement_score
  const formattedTime = formatResponseTime(responseTime)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Only show copy for model responses
  const showCopy = ['council', 'chairman', 'chat'].includes(type)

  // Chat mode styling
  if (type === 'chat') {
    const color = getModelColor(modelName)
    return (
      <div className="message chat">
        <div className="chat-bubble">
          <div className="chat-header" style={{ color }}>
            <span className="chat-model-name">{modelName}</span>
            {replyTo && <span className="chat-reply-to">replying to @{replyTo}</span>}
            {formattedTime && <span className="response-time">{formattedTime}</span>}
            <button className="copy-btn" onClick={handleCopy} title="Copy response">
              {copied ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
          <div className="chat-content">
            <p>{highlightMentions(content)}{streaming && <span className="streaming-cursor" />}</p>
          </div>
        </div>
        <div className="chat-avatar" style={{ backgroundColor: color }}>
          {modelName?.charAt(0) || 'A'}
        </div>
      </div>
    )
  }

  // Default styling for other message types
  return (
    <div className={`message ${type} ${hasDisagreement ? 'has-disagreement' : ''}`}>
      {modelName && (
        <div className="message-header">
          <span className="model-name">{modelName}</span>
          {hasDisagreement && (
            <span
              className="disagreement-badge"
              title={`Disagreement score: ${(disagreementScore * 100).toFixed(0)}%`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Disputed
            </span>
          )}
          {formattedTime && <span className="response-time">{formattedTime}</span>}
          {showCopy && (
            <button className="copy-btn" onClick={handleCopy} title="Copy response">
              {copied ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}
      <div className="message-content">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
        {streaming && <span className="streaming-cursor" />}
      </div>
      {type === 'user' && <div className="user-avatar">U</div>}
    </div>
  )
}

// Memoize to prevent re-renders when parent updates
export default memo(Message)
