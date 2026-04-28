import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { useSelectedModel } from './ModelSelector'
import { CloudArrowUpIcon as Paperclip } from '@phosphor-icons/react/CloudArrowUp'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  // Vision uploads — model decides what to do with them, no OCR.
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]
const ALLOWED_EXT_RE = /\.(pdf|docx|txt|md|csv|png|jpe?g|gif|webp)$/i
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'])
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB documents
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB images (matches backend cap)

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  disabled: boolean
  placeholder?: string
  centered?: boolean
  quotedText?: string
  onClearQuote?: () => void
}

export interface ChatInputHandle {
  focus: () => void
}

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onFileUpload,
      disabled,
      placeholder,
      centered = false,
      quotedText,
      onClearQuote,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [attachedFile, setAttachedFile] = useState<File | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const [fileError, setFileError] = useState('')
    const selectedModel = useSelectedModel()

    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus()
      },
    }))

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    }

    const handleSend = () => {
      if (disabled) return
      if (attachedFile) {
        onFileUpload?.(attachedFile, value.trim())
        setAttachedFile(null)
        setFileError('')
      } else if (value.trim()) {
        onSubmit()
      }
    }

    const validateAndAttach = useCallback((file: File | undefined) => {
      setFileError('')
      if (!file) return

      const isImage = IMAGE_TYPES.has(file.type) || IMAGE_EXT_RE.test(file.name)

      if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXT_RE.test(file.name)) {
        setFileError('Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, PNG, JPG, GIF, or WebP.')
        return
      }
      const cap = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE
      if (file.size > cap) {
        const capMb = (cap / 1024 / 1024).toFixed(0)
        setFileError(
          `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${capMb}MB${isImage ? ' for images' : ''}.`
        )
        return
      }

      setAttachedFile(file)
    }, [])

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      validateAndAttach(e.target.files?.[0])
      e.target.value = ''
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      validateAndAttach(e.dataTransfer.files?.[0])
    }

    const removeFile = () => {
      setAttachedFile(null)
      setFileError('')
    }

    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea) {
        if (value === '') {
          textarea.style.height = 'auto'
        } else {
          textarea.style.height = 'auto'
          textarea.style.height = `${textarea.scrollHeight}px`
        }
      }
    }, [value])

    const MAX_CHARS = 1000
    const charactersUsed = value.length
    const isOverLimit = charactersUsed > MAX_CHARS
    const isNearLimit = charactersUsed >= MAX_CHARS * 0.9
    const hasContent = value.trim() || attachedFile

    const getFileExt = (name: string) => {
      const ext = name.split('.').pop()?.toUpperCase()
      return ext || 'FILE'
    }

    const getFileInfo = (file: File) => {
      const kb = file.size / 1024
      if (kb < 1) return `${file.size} B`
      if (kb < 1024) return `${Math.round(kb)} KB`
      return `${(kb / 1024).toFixed(1)} MB`
    }

    return (
      <div
        className={`input-container ${centered ? 'centered' : 'bottom'} ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {fileError && <div className="file-error">{fileError}</div>}

        <div
          className={`input-wrapper ${attachedFile ? 'has-file' : ''} ${centered ? 'input-wrapper-centered' : ''}`}
        >
          {quotedText && (
            <div className="quote-pill">
              <div className="quote-pill-bar" />
              <div className="quote-pill-text" title={quotedText}>
                {quotedText}
              </div>
              <button
                type="button"
                className="quote-pill-close"
                onClick={onClearQuote}
                title="Remove quote"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {attachedFile && (
            <div className="file-card">
              <button className="file-card-remove" onClick={removeFile}>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <div className="file-card-name">{attachedFile.name}</div>
              <div className="file-card-meta">{getFileInfo(attachedFile)}</div>
              <div className="file-card-badge">{getFileExt(attachedFile.name)}</div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={handleKeyDown}
            placeholder={
              attachedFile
                ? 'Add a message about this file...'
                : placeholder || 'Ask Étude anything. Type / for commands.'
            }
            rows={1}
            maxLength={MAX_CHARS}
            disabled={disabled}
            autoFocus={centered}
          />

          <div className="input-actions-row">
            <div className="input-actions-left">
              <button
                className={`attach-btn ${centered ? 'attach-btn-centered' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                title="Attach file or image (PDF, DOCX, TXT, MD, CSV, PNG, JPG, GIF, WebP)"
              >
                <Paperclip size={18} weight="regular" />
                {centered && <span>Attach file</span>}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.gif,.webp,image/*"
              onChange={handleFileSelect}
              hidden
            />
            <div className="input-actions-right">
              {centered && (
                <span
                  className={`input-char-count${isOverLimit ? ' over' : isNearLimit ? ' near' : ''}`}
                >
                  {charactersUsed}/{MAX_CHARS}
                </span>
              )}
              <span className="input-send-hint">
                <span className="input-send-hint-model">{selectedModel.name}</span>
                <kbd className="shortcut-kbd">↵</kbd>
                <span>to send</span>
              </span>
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={disabled || !hasContent}
                title="Send (Enter)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <p className="input-footer-note">Étude can make mistakes. Verify anything load-bearing.</p>

        {dragOver && (
          <div className="drop-overlay">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop file here</span>
          </div>
        )}
      </div>
    )
  }
)

ChatInput.displayName = 'ChatInput'

export default ChatInput
