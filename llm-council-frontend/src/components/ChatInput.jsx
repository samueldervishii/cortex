import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

// Model names and colors for the mention dropdown
const MODEL_COLORS = {
  'Claude Sonnet 4.6': '#d97706',
  'Claude Haiku 4.5': '#8b5cf6',
  'GPT OSS 120B': '#0467df',
  'Qwen 3 32B': '#10b981',
  'GPT OSS 20B': '#ef4444',
}

const ALL_MODELS = Object.keys(MODEL_COLORS)

const ChatInput = forwardRef(
  ({ value, onChange, onSubmit, disabled, placeholder, centered = false, mode, systemPrompt, onSystemPromptChange }, ref) => {
    const textareaRef = useRef(null)
    const dropdownRef = useRef(null)
    const [showMentions, setShowMentions] = useState(false)
    const [mentionFilter, setMentionFilter] = useState('')
    const [mentionStartIndex, setMentionStartIndex] = useState(-1)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [showSystemPrompt, setShowSystemPrompt] = useState(false)

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus()
      },
    }))

    // Filter models based on what user typed after @
    const filteredModels = ALL_MODELS.filter((name) =>
      name.toLowerCase().includes(mentionFilter.toLowerCase())
    )

    // Reset selected index when filter changes
    useEffect(() => {
      setSelectedIndex(0)
    }, [mentionFilter])

    // Close dropdown on outside click
    useEffect(() => {
      const handleClickOutside = (e) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
          setShowMentions(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const insertMention = (modelName) => {
      // Replace the @partial text with the full @ModelName
      const before = value.substring(0, mentionStartIndex)
      const after = value.substring(textareaRef.current?.selectionStart || value.length)
      const newValue = `${before}@${modelName} ${after}`
      onChange(newValue)
      setShowMentions(false)
      setMentionFilter('')
      setMentionStartIndex(-1)

      // Re-focus textarea
      setTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          const cursorPos = before.length + modelName.length + 2 // +2 for @ and space
          textarea.focus()
          textarea.setSelectionRange(cursorPos, cursorPos)
        }
      }, 0)
    }

    const handleChange = (e) => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart
      onChange(newValue)

      // Only show mention dropdown in chat mode
      if (mode !== 'chat') {
        setShowMentions(false)
        return
      }

      // Check if user just typed @ or is typing after @
      const textBeforeCursor = newValue.substring(0, cursorPos)
      const lastAtIndex = textBeforeCursor.lastIndexOf('@')

      if (lastAtIndex !== -1) {
        // Check there's no space between @ and cursor (unless it's part of a model name)
        const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1)
        // Model names can have spaces, so check if it's a valid partial match
        const hasNewline = textAfterAt.includes('\n')

        if (!hasNewline && textAfterAt.length <= 20) {
          setShowMentions(true)
          setMentionFilter(textAfterAt)
          setMentionStartIndex(lastAtIndex)
          return
        }
      }

      setShowMentions(false)
      setMentionFilter('')
      setMentionStartIndex(-1)
    }

    const handleKeyDown = (e) => {
      // Handle mention dropdown navigation
      if (showMentions && filteredModels.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % filteredModels.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + filteredModels.length) % filteredModels.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          insertMention(filteredModels[selectedIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowMentions(false)
          return
        }
      }

      // Ctrl+Enter or Cmd+Enter to send
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (value.trim() && !disabled) {
          onSubmit()
        }
      }
      // Regular Enter creates new line (default behavior)
    }

    // Auto-resize textarea based on content
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

    return (
      <div className={`input-container ${centered ? 'centered' : 'bottom'}`}>
        {/* System prompt - collapsible */}
        {onSystemPromptChange && (
          <div className={`system-prompt-section ${showSystemPrompt ? 'open' : ''}`}>
            <button
              className="system-prompt-toggle"
              onClick={() => setShowSystemPrompt((prev) => !prev)}
              type="button"
            >
              <span className={`system-prompt-chevron ${showSystemPrompt ? 'open' : ''}`}>&#9654;</span>
              <span>System Prompt</span>
              {systemPrompt?.trim() && !showSystemPrompt && (
                <span className="system-prompt-badge">Active</span>
              )}
            </button>
            {showSystemPrompt && (
              <textarea
                className="system-prompt-textarea"
                value={systemPrompt || ''}
                onChange={(e) => onSystemPromptChange(e.target.value)}
                placeholder="Custom instructions for all council members (e.g., 'respond in Spanish', 'you are a senior engineer')..."
                rows={3}
                maxLength={2000}
              />
            )}
          </div>
        )}

        <div className="input-wrapper" style={{ position: 'relative' }}>
          {/* @mention dropdown */}
          {showMentions && filteredModels.length > 0 && (
            <div className="mention-dropdown" ref={dropdownRef}>
              {filteredModels.map((name, i) => (
                <div
                  key={name}
                  className={`mention-option ${i === selectedIndex ? 'selected' : ''}`}
                  onClick={() => insertMention(name)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span
                    className="mention-avatar"
                    style={{ backgroundColor: MODEL_COLORS[name] }}
                  >
                    {name.charAt(0)}
                  </span>
                  <span className="mention-name">{name}</span>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            autoFocus={centered}
          />
          <button onClick={onSubmit} disabled={disabled || !value.trim()} title="Send (Ctrl+Enter)">
            <span className="send-icon">↑</span>
          </button>
        </div>
        <div className="input-hints">
          <span>Ctrl+Enter to send</span>
          {mode === 'chat' && <span>@ to mention a model</span>}
          <span>Alt+N new chat</span>
          <span>Ctrl+\ sidebar</span>
        </div>
      </div>
    )
  }
)

ChatInput.displayName = 'ChatInput'

export default ChatInput
