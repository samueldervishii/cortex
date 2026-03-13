import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { apiClient } from '../config/api'
import './IncognitoChat.css'

// Ghost icon SVG component
const GhostIcon = () => (
  <svg
    width="20"
    height="20"
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
)

// Color palette for different models
const MODEL_COLORS = {
  'Claude Sonnet 4.6': '#d97706',
  'Claude Haiku 4.5': '#8b5cf6',
  'GPT OSS 120B': '#0467df',
  'Qwen 3 32B': '#10b981',
  'GPT OSS 20B': '#ef4444',
}

function getModelColor(modelName) {
  return MODEL_COLORS[modelName] || '#b8864a'
}

function formatResponseTime(ms) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Simple message component for incognito mode
function IncognitoMessage({ type, content, modelName, responseTime }) {
  const [copied, setCopied] = useState(false)
  const formattedTime = formatResponseTime(responseTime)
  const color = getModelColor(modelName)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (type === 'user') {
    return (
      <div className="incognito-message user">
        <div className="incognito-message-content">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
        </div>
        <div className="incognito-user-avatar">U</div>
      </div>
    )
  }

  if (type === 'chat' || type === 'council') {
    return (
      <div className="incognito-message model">
        <div className="incognito-model-avatar" style={{ backgroundColor: color }}>
          {modelName?.charAt(0) || 'A'}
        </div>
        <div className="incognito-bubble">
          <div className="incognito-header">
            <span className="incognito-model-name" style={{ color }}>
              {modelName}
            </span>
            {formattedTime && <span className="incognito-response-time">{formattedTime}</span>}
            <button className="incognito-copy-btn" onClick={handleCopy} title="Copy response">
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
          <div className="incognito-content">
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  if (type === 'chairman') {
    return (
      <div className="incognito-message chairman">
        <div className="incognito-model-avatar chairman-avatar">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <div className="incognito-bubble chairman-bubble">
          <div className="incognito-header">
            <span className="incognito-model-name chairman-name">{modelName || 'Chairman'}</span>
            {formattedTime && <span className="incognito-response-time">{formattedTime}</span>}
            <button className="incognito-copy-btn" onClick={handleCopy} title="Copy response">
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
          <div className="incognito-content">
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  // System/error messages
  return (
    <div className={`incognito-message ${type}`}>
      <div className="incognito-system-content">{content}</div>
    </div>
  )
}

function IncognitoChat({ isOpen, onClose, availableModels, selectedModels }) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        // Clear chat when closing with Escape
        setMessages([])
        setQuestion('')
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [question])

  const addMessage = (type, content, modelName = null, extras = {}) => {
    setMessages((prev) => [...prev, { type, content, modelName, timestamp: new Date(), ...extras }])
  }

  const handleSubmit = async () => {
    if (!question.trim() || loading) return

    const userQuestion = question
    setQuestion('')
    setLoading(true)

    addMessage('user', userQuestion)

    try {
      // Create ephemeral session (not saved to DB)
      setCurrentStep('Creating ephemeral session...')
      const createRes = await apiClient.post('/query', {
        question: userQuestion,
        mode: 'chat',
        selected_models: selectedModels.length > 0 ? selectedModels : null,
        ephemeral: true, // Signal to backend this is incognito
      })

      const sessionId = createRes.data.session.id

      // Get responses (chat mode)
      setCurrentStep('Models are typing...')
      const chatRes = await apiClient.post(`/session/${sessionId}/run-all`)
      const session = chatRes.data.session
      const currentRound = session.rounds[session.rounds.length - 1]

      // Add chat messages one by one
      for (let i = 0; i < currentRound.chat_messages.length; i++) {
        const chatMsg = currentRound.chat_messages[i]
        setCurrentStep(`${chatMsg.model_name} is typing...`)

        await new Promise((resolve) => setTimeout(resolve, 300))

        addMessage('chat', chatMsg.content, chatMsg.model_name, {
          responseTime: chatMsg.response_time_ms,
        })
      }

      // Delete the session immediately after getting responses (incognito cleanup)
      try {
        await apiClient.delete(`/session/${sessionId}`)
      } catch (deleteErr) {
        // Silently ignore delete errors - session may already be cleaned up
        console.debug('Incognito session cleanup:', deleteErr)
      }
    } catch (error) {
      console.error('Incognito chat error:', error)
      // Handle validation errors (422) which return an array of error objects
      let errorMessage = 'Something went wrong. Please try again.'
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail
        if (typeof detail === 'string') {
          errorMessage = detail
        } else if (Array.isArray(detail)) {
          // Pydantic validation errors are arrays of objects with 'msg' field
          errorMessage = detail.map((err) => err.msg || JSON.stringify(err)).join(', ')
        } else if (typeof detail === 'object') {
          errorMessage = detail.msg || JSON.stringify(detail)
        }
      }
      addMessage('error', errorMessage)
    } finally {
      setLoading(false)
      setCurrentStep('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleClearChat = () => {
    setMessages([])
    setQuestion('')
  }

  const handleClose = () => {
    // Clear chat when closing
    setMessages([])
    setQuestion('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="incognito-overlay">
      <div className="incognito-modal">
        {/* Header */}
        <div className="incognito-modal-header">
          <div className="incognito-title">
            <GhostIcon />
            <span>Incognito chat</span>
          </div>
          <button className="incognito-close" onClick={handleClose} title="Close (Esc)">
            &times;
          </button>
        </div>

        {/* Messages area */}
        <div className="incognito-messages">
          {messages.length === 0 ? (
            <div className="incognito-empty">
              <GhostIcon />
              <p>Start a private conversation</p>
              <span>Messages won't be saved to your history</span>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <IncognitoMessage
                  key={idx}
                  type={msg.type}
                  content={msg.content}
                  modelName={msg.modelName}
                  responseTime={msg.responseTime}
                />
              ))}
              {loading && (
                <div className="incognito-loading">
                  <div className="incognito-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <span className="incognito-status">{currentStep}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Footer disclaimer */}
        <div className="incognito-disclaimer">
          <GhostIcon />
          <span>Incognito chats aren't saved, added to history, or stored in database.</span>
        </div>

        {/* Input area */}
        <div className="incognito-input-area">
          <div className="incognito-input-wrapper">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="How can we help ?"
              rows={1}
              disabled={loading}
            />
            <button
              className="incognito-send"
              onClick={handleSubmit}
              disabled={loading || !question.trim()}
              title="Send (Ctrl+Enter)"
            >
              <span className="send-icon">↑</span>
            </button>
          </div>
          <div className="incognito-hints">
            <span>Ctrl+Enter to send</span>
            <span>Enter for new line</span>
          </div>
          {messages.length > 0 && (
            <button
              className="incognito-clear"
              onClick={handleClearChat}
              title="Clear conversation"
            >
              Clear chat
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default IncognitoChat
