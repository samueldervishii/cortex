import { useRef } from 'react'
import ChatInput from './ChatInput'

interface WelcomeScreenProps {
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  loading: boolean
}

function WelcomeScreen({
  question,
  onQuestionChange,
  onSubmit,
  onFileUpload,
  loading,
}: WelcomeScreenProps) {
  const inputRef = useRef<{ focus: () => void } | null>(null)

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <h1>Cortex</h1>
        <p className="welcome-subtitle">Your AI-powered assistant</p>
      </div>
      <ChatInput
        ref={inputRef}
        value={question}
        onChange={onQuestionChange}
        onSubmit={onSubmit}
        onFileUpload={onFileUpload}
        disabled={loading}
        placeholder="Ask me anything..."
        centered
      />
      <div className="welcome-footer">
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
