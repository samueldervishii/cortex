import { useEffect, useRef } from 'react'
import { apiClient } from '../config/api'
import Message from './Message'
import ChatInput from './ChatInput'

function ChatMessages({
  messages,
  loading,
  currentStep,
  question,
  onQuestionChange,
  onSubmit,
  onFileUpload,
  readOnly = false,
  sessionId,
}) {
  const messagesEndRef = useRef(null)
  const chatInputRef = useRef(null)

  useEffect(() => {
    chatInputRef.current?.focus()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleExportDocx = async () => {
    if (!sessionId) return
    try {
      const res = await apiClient.get(`/session/${sessionId}/export-docx`, {
        responseType: 'blob',
      })
      const blob = new Blob([res.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cortex-chat.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('DOCX export failed:', err)
    }
  }

  return (
    <>
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <Message
            key={idx}
            role={msg.role}
            content={msg.content}
            modelName={msg.modelName}
            responseTime={msg.responseTime}
            streaming={msg.streaming}
            file={msg.file}
            isArtifact={msg.isArtifact}
            messageIndex={idx}
            sessionId={sessionId}
          />
        ))}

        {!loading && sessionId && (
          <div className="session-actions">
            <button className="session-action-btn" onClick={handleExportDocx} title="Export as DOCX">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>DOCX</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!readOnly && (
        <ChatInput
          ref={chatInputRef}
          value={question}
          onChange={onQuestionChange}
          onSubmit={onSubmit}
          onFileUpload={onFileUpload}
          disabled={loading}
          placeholder="Ask a follow-up question..."
        />
      )}
    </>
  )
}

export default ChatMessages
