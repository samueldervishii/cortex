import { useRef } from 'react'
import ChatInput, { type ChatInputHandle } from './ChatInput'

interface WelcomeScreenProps {
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  loading: boolean
}

const QUICK_PROMPTS = [
  {
    title: 'Write a thesis introduction',
    subtitle: 'about AI in modern education',
    prompt:
      'Write me a thesis introduction about the impact of artificial intelligence on modern education',
  },
  {
    title: 'Help me structure',
    subtitle: 'a literature review chapter',
    prompt: 'Help me structure a literature review chapter for my thesis',
  },
]

function WelcomeScreen({
  question,
  onQuestionChange,
  onSubmit,
  onFileUpload,
  loading,
}: WelcomeScreenProps) {
  const inputRef = useRef<ChatInputHandle | null>(null)

  const handlePromptClick = (prompt: string) => {
    onQuestionChange(prompt)
    setTimeout(() => onSubmit(), 100)
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <h1 className="welcome-greeting">Hello there!</h1>
        <p className="welcome-subtitle">How can I help you today?</p>
      </div>

      <div className="welcome-prompts">
        {QUICK_PROMPTS.map((item, index) => (
          <button
            key={index}
            className="welcome-prompt-card"
            onClick={() => handlePromptClick(item.prompt)}
          >
            <span className="welcome-prompt-title">{item.title}</span>
            <span className="welcome-prompt-subtitle">{item.subtitle}</span>
          </button>
        ))}
      </div>

      <ChatInput
        ref={inputRef}
        value={question}
        onChange={onQuestionChange}
        onSubmit={onSubmit}
        onFileUpload={onFileUpload}
        disabled={loading}
        placeholder="Send a message..."
        centered
      />

      <div className="welcome-footer">
        <span className="welcome-shortcut-hint">
          Press <kbd>?</kbd> for keyboard shortcuts
        </span>
        <span className="powered-by">
          <a href="https://www.anthropic.com/news/claude-sonnet-4-6" target="_blank">
            Powered by Anthropic Claude Sonnet 4.6
          </a>
        </span>
      </div>
    </div>
  )
}

export default WelcomeScreen
