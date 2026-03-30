import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
]
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const ChatInput = forwardRef(
  ({ value, onChange, onSubmit, onFileUpload, disabled, placeholder, centered = false }, ref) => {
    const textareaRef = useRef(null)
    const fileInputRef = useRef(null)
    const [attachedFile, setAttachedFile] = useState(null)
    const [dragOver, setDragOver] = useState(false)
    const [fileError, setFileError] = useState('')

    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus()
      },
    }))

    const handleKeyDown = (e) => {
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

    const validateAndAttach = useCallback((file) => {
      setFileError('')
      if (!file) return

      if (!ALLOWED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|txt|md|csv)$/i)) {
        setFileError('Unsupported file type. Use PDF, DOCX, TXT, MD, or CSV.')
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`)
        return
      }

      setAttachedFile(file)
    }, [])

    const handleFileSelect = (e) => {
      validateAndAttach(e.target.files?.[0])
      e.target.value = '' // Reset so same file can be re-selected
    }

    const handleDragOver = (e) => {
      e.preventDefault()
      setDragOver(true)
    }

    const handleDragLeave = (e) => {
      e.preventDefault()
      setDragOver(false)
    }

    const handleDrop = (e) => {
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

    const hasContent = value.trim() || attachedFile

    const getFileExt = (name) => {
      const ext = name.split('.').pop()?.toUpperCase()
      return ext || 'FILE'
    }

    const getFileInfo = (file) => {
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

        <div className={`input-wrapper ${attachedFile ? 'has-file' : ''}`}>
          {attachedFile && (
            <div className="file-card">
              <button className="file-card-remove" onClick={removeFile}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <div className="file-card-name">{attachedFile.name}</div>
              <div className="file-card-meta">{getFileInfo(attachedFile)}</div>
              <div className="file-card-badge">{getFileExt(attachedFile.name)}</div>
            </div>
          )}

          <div className="input-row">
            <button
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Attach file (PDF, DOCX, TXT)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv"
              onChange={handleFileSelect}
              hidden
            />
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={attachedFile ? 'Add a message about this file...' : placeholder}
              rows={1}
              disabled={disabled}
              autoFocus={centered}
            />
            <button onClick={handleSend} disabled={disabled || !hasContent} title="Send (Enter)">
              <span className="send-icon">&uarr;</span>
            </button>
          </div>
        </div>

        {dragOver && (
          <div className="drop-overlay">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
