import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { apiClient } from '../config/api'
import Message from './Message'
import ChatInput from './ChatInput'
import type { ChatInputHandle } from './ChatInput'
import { useAuth } from '../contexts/AuthContext'

interface FileInfo {
  filename: string
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  content: string
  modelName?: string
  responseTime?: number
  streaming?: boolean
  file?: FileInfo
  isArtifact?: boolean
  wasCancelled?: boolean
}

interface ChatMessagesProps {
  messages: ChatMessage[]
  loading: boolean
  currentStep: string
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  readOnly?: boolean
  sessionId?: string
  onBranch?: (messageIndex: number) => void
  onOpenArtifact?: (messageIndex: number) => void
  onStopStreaming?: () => void
  onEditMessage?: (messageIndex: number, newContent: string) => Promise<void> | void
  onRegenerateMessage?: (messageIndex: number) => Promise<void> | void
  quotedText?: string
  onClearQuote?: () => void
}

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
  onBranch,
  onOpenArtifact,
  onStopStreaming,
  onEditMessage,
  onRegenerateMessage,
  quotedText,
  onClearQuote,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<ChatInputHandle>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const { user } = useAuth() as any
  const userDisplayName = user?.display_name || user?.username || user?.email || 'You'
  const userInitial = (userDisplayName || '?')[0].toUpperCase()
  const userAvatar = user?.avatar || null

  useEffect(() => {
    chatInputRef.current?.focus()
  }, [])

  // Focus the input when a quote gets attached (user clicked Reply on a
  // selection) so they can immediately start typing their response.
  useEffect(() => {
    if (quotedText) chatInputRef.current?.focus()
  }, [quotedText])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distanceFromBottom > 200)
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

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
      a.download = `etude-chat.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('DOCX export failed:', err)
    }
  }

  // Stable callback refs — the props from App change identity on every
  // keystroke (because their dependencies inside useCouncil aren't memoized),
  // which would invalidate the useMemo below and re-parse every message's
  // markdown on every character typed. This pattern keeps the identities
  // pinned while still calling the latest callbacks when invoked.
  const onBranchRef = useRef(onBranch)
  onBranchRef.current = onBranch
  const onEditRef = useRef(onEditMessage)
  onEditRef.current = onEditMessage
  const onRegenerateRef = useRef(onRegenerateMessage)
  onRegenerateRef.current = onRegenerateMessage

  const stableOnBranch = useMemo<typeof onBranch>(
    () => (readOnly ? undefined : (messageIndex: number) => onBranchRef.current?.(messageIndex)),
    [readOnly]
  )
  const stableOnEdit = useMemo<typeof onEditMessage>(
    () =>
      readOnly
        ? undefined
        : (messageIndex: number, newContent: string) =>
            onEditRef.current?.(messageIndex, newContent),
    [readOnly]
  )
  const stableOnRegenerate = useMemo<typeof onRegenerateMessage>(
    () =>
      readOnly ? undefined : (messageIndex: number) => onRegenerateRef.current?.(messageIndex),
    [readOnly]
  )

  // Index of the most recent streaming assistant message, if any.
  // Receives the live ``currentStep`` so the status renders inline
  // beside the model name instead of as a centered floating block.
  const lastStreamingIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.role === 'assistant' && m.streaming) return i
    }
    return -1
  }, [messages])

  // Memoize the rendered message list so it doesn't re-parse markdown on
  // every keystroke in the input. Without this, typing one character
  // re-renders every Message → ReactMarkdown parse, which is slow for
  // long conversations.
  const renderedMessages = useMemo(
    () =>
      messages.map((msg, idx) => (
        <Message
          key={idx}
          role={msg.role}
          content={msg.content}
          modelName={msg.modelName}
          responseTime={msg.responseTime}
          streaming={msg.streaming}
          streamingStep={
            idx === lastStreamingIdx && loading && !msg.content ? currentStep : undefined
          }
          wasCancelled={msg.wasCancelled}
          file={msg.file}
          isArtifact={msg.isArtifact}
          messageIndex={idx}
          sessionId={sessionId}
          onBranch={stableOnBranch}
          onEdit={stableOnEdit}
          onRegenerate={stableOnRegenerate}
          citations={(msg as any).citations}
          userAvatar={userAvatar}
          userInitial={userInitial}
          userDisplayName="You"
        />
      )),
    [
      messages,
      sessionId,
      stableOnBranch,
      stableOnEdit,
      stableOnRegenerate,
      userAvatar,
      userInitial,
      lastStreamingIdx,
      loading,
      currentStep,
    ]
  )

  return (
    <>
      <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
        {renderedMessages}

        {/* The streaming-status text lives inline next to the model
            name on the streaming assistant bubble (see ``streamingStep``
            above). The brief moment before that bubble exists is
            covered by the floating "Stop generating" button below,
            so we no longer render a separate centered indicator —
            it duplicated the inline pill once the bubble appeared
            and looked detached from the conversation. */}

        {!loading && sessionId && messages.some((m) => m.isArtifact) && (
          <div className="session-actions">
            <button
              className="session-action-btn"
              onClick={handleExportDocx}
              title="Export as DOCX"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
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

      {loading && onStopStreaming && !readOnly && (
        <div className="stop-stream-wrap">
          <button
            type="button"
            className="stop-stream-btn"
            onClick={onStopStreaming}
            title="Stop generating"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
            <span>Stop generating</span>
          </button>
        </div>
      )}

      {showScrollBtn && (
        <button className="scroll-to-bottom" onClick={scrollToBottom} title="Scroll to bottom">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {!readOnly && (
        <ChatInput
          ref={chatInputRef}
          value={question}
          onChange={onQuestionChange}
          onSubmit={onSubmit}
          onFileUpload={onFileUpload}
          disabled={loading}
          placeholder="Send a message..."
          quotedText={quotedText}
          onClearQuote={onClearQuote}
        />
      )}
    </>
  )
}

export default ChatMessages
