import { useRef, useState, useEffect } from 'react'
import ChatInput from './ChatInput'
import SuggestionCards from './SuggestionCards'

interface WelcomeScreenProps {
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: () => void
  loading: boolean
}

function WelcomeScreen({ question, onQuestionChange, onSubmit, loading }: WelcomeScreenProps) {
  const inputRef = useRef<{ focus: () => void } | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(true)

  useEffect(() => {
    if (question) {
      // Delay unmounting to allow fade-out animation to complete
      const timer = setTimeout(() => {
        setShowSuggestions(false)
      }, 400) // Match fade-out animation duration
      return () => clearTimeout(timer)
    } else {
      setShowSuggestions(true)
    }
  }, [question])

  const handleSuggestionClick = (prompt: string) => {
    onQuestionChange(prompt)
  }

  const focusInput = () => {
    inputRef.current?.focus()
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <h1>LLM Council</h1>
      </div>
      <ChatInput
        ref={inputRef}
        value={question}
        onChange={onQuestionChange}
        onSubmit={onSubmit}
        disabled={loading}
        placeholder="How can we help you today?"
        centered
      />
      {showSuggestions && (
        <SuggestionCards
          onSelectSuggestion={handleSuggestionClick}
          onFocusInput={focusInput}
          isVisible={!question}
        />
      )}
    </div>
  )
}

export default WelcomeScreen
