import { useState, memo } from 'react'
import { API_BASE, getAccessToken } from '../config/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

function formatResponseTime(ms) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function Message({ role, content, modelName, responseTime, streaming, file, messageIndex, sessionId, isArtifact }) {
  const [copied, setCopied] = useState(false)
  const formattedTime = formatResponseTime(responseTime)

  const handleCopy = async () => {
    try {
      // Strip markdown formatting for clean plain text copy
      const plainText = content
        .replace(/^#{1,6}\s+/gm, '')          // headings
        .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
        .replace(/\*(.+?)\*/g, '$1')           // italic
        .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}\w*\n?/g, '')) // code blocks
        .replace(/`(.+?)`/g, '$1')             // inline code
        .replace(/^[-*]\s+/gm, '• ')           // bullet lists
        .replace(/^\d+\.\s+/gm, (m) => m)      // keep numbered lists
        .replace(/^---+$/gm, '')               // horizontal rules
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .replace(/\n{3,}/g, '\n\n')            // collapse extra newlines
        .trim()
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (role === 'user') {
    return (
      <div className="message user">
        {file && (
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {file.filename}
          </button>
        )}
        <div className="message-content">
          <p>{content}</p>
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

  // Artifact card for generated documents
  if (isArtifact) {
    const titleMatch = content.match(/^#+ (.+)/m)
    const artifactTitle = titleMatch ? titleMatch[1] : 'Generated Document'
    const isEmpty = !content.trim()

    return (
      <div className="message assistant">
        <div className="artifact-card">
          <div className="artifact-header">
            <div className="artifact-title-row">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="artifact-title">{isEmpty ? 'Generating...' : artifactTitle}</span>
              {streaming && <span className="artifact-generating">writing</span>}
            </div>
          </div>
          {isEmpty ? (
            <div className="artifact-loading">
              <div className="artifact-loading-dots">
                <span /><span /><span />
              </div>
            </div>
          ) : (
            <div className="artifact-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
            </div>
          )}
          {!streaming && !isEmpty && (
            <div className="artifact-footer">
              <button className="artifact-btn" onClick={handleCopy} title="Copy text">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {copied
                    ? <polyline points="20 6 9 17 4 12" />
                    : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>
                  }
                </svg>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="artifact-btn" onClick={handleDownloadDocx} title="Download as DOCX">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                DOCX
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Normal assistant message
  return (
    <div className="message assistant">
      {modelName && (
        <div className="message-header">
          <span className="model-name">{modelName}</span>
          {formattedTime && <span className="response-time">{formattedTime}</span>}
          <button className="copy-btn" onClick={handleCopy} title="Copy response">
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      )}
      <div className="message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}

export default memo(Message)
