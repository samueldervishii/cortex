import { useMemo, useRef, useState } from 'react'
import { ArrowsCounterClockwiseIcon as ArrowsCounterClockwise } from '@phosphor-icons/react/ArrowsCounterClockwise'
import { SparkleIcon as Sparkle } from '@phosphor-icons/react/Sparkle'
import { FileTextIcon as FileText } from '@phosphor-icons/react/FileText'
import { EnvelopeIcon as Envelope } from '@phosphor-icons/react/Envelope'
import { MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass'
import { NotePencilIcon as NotePencil } from '@phosphor-icons/react/NotePencil'
import ChatInput, { type ChatInputHandle } from './ChatInput'
import { useAuth } from '../contexts/AuthContext'

interface WelcomeScreenProps {
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  loading: boolean
  ghostMode?: boolean
}

const SUGGESTIONS = [
  {
    eyebrow: 'Draft',
    icon: NotePencil,
    title: 'Write a thesis introduction',
    description: 'Frame your argument with strong structure and a clear research tone.',
    prompt:
      'Write me a thesis introduction about the impact of artificial intelligence on modern education',
  },
  {
    eyebrow: 'Research',
    icon: MagnifyingGlass,
    title: 'Overview of a complex topic',
    description: 'Break a subject into themes, key findings, and critical comparisons.',
    prompt:
      'Give me a comprehensive overview of renewable energy technologies, covering key themes, recent developments, and critical analysis',
  },
  {
    eyebrow: 'Refine',
    icon: FileText,
    title: 'Improve and restructure',
    description: 'Tighten clarity, flow, and academic tone across your existing writing.',
    prompt:
      'Help me improve the clarity, structure, and academic tone of my draft. I will paste it next.',
  },
  {
    eyebrow: 'Reply',
    icon: Envelope,
    title: 'Generate a polished response',
    description: 'Turn rough notes into a clear, well-structured email or formal reply.',
    prompt:
      'Help me write a polished email reply to a professor asking for a deadline extension on my research paper.',
  },
]

function WelcomeScreen({
  question,
  onQuestionChange,
  onSubmit,
  onFileUpload,
  loading,
  ghostMode = false,
}: WelcomeScreenProps) {
  const inputRef = useRef<ChatInputHandle | null>(null)
  const [suggestions, setSuggestions] = useState(SUGGESTIONS)
  const { user } = useAuth() as any
  const firstName = useMemo(() => {
    const raw = user?.display_name || user?.username || user?.email || ''
    const cleaned = String(raw).trim()
    if (!cleaned) return 'Researcher'
    return cleaned.split(/[\s@._-]+/)[0]
  }, [user])

  const handlePromptClick = (prompt: string) => {
    onQuestionChange(prompt)
    setTimeout(() => onSubmit(), 100)
  }

  const shuffleSuggestions = () => {
    const copy = [...SUGGESTIONS]
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    setSuggestions(copy)
  }

  if (ghostMode) {
    return (
      <div className="welcome-screen welcome-screen-ghost">
        <div className="welcome-center">
          <h1 className="welcome-ghost-title">Temporary Chat</h1>
          <p className="welcome-ghost-sub">
            This chat won't appear in your chat history, and won't be used to train our models.
          </p>
        </div>

        <div className="welcome-input-area welcome-input-area-ghost">
          <ChatInput
            ref={inputRef}
            value={question}
            onChange={onQuestionChange}
            onSubmit={onSubmit}
            onFileUpload={onFileUpload}
            disabled={loading}
            placeholder="Ask anything"
            centered
          />
        </div>

        <p className="welcome-ghost-footer">
          For safety, we may keep a copy of this chat for up to 30 days.
        </p>
      </div>
    )
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-center">
        <div className="welcome-badge">
          <Sparkle size={14} />
          Cortex workspace
        </div>
        <h1 className="welcome-heading">
          <span className="welcome-heading-static">Hi there, {firstName}</span>
          <span className="welcome-heading-gradient">What should we research today?</span>
        </h1>
        <p className="welcome-subheading">
          Use one of the starter prompts below or describe your question in your own words to begin.
        </p>
      </div>

      <div className="welcome-suggestions">
        {suggestions.map((item) => (
          <button
            key={item.eyebrow}
            className="welcome-suggestion-card"
            onClick={() => handlePromptClick(item.prompt)}
          >
            <span className="welcome-suggestion-eyebrow">
              <item.icon size={14} />
              {item.eyebrow}
            </span>
            <span className="welcome-suggestion-title">{item.title}</span>
            <span className="welcome-suggestion-desc">{item.description}</span>
          </button>
        ))}
      </div>

      <div className="welcome-toolbar">
        <button className="welcome-toolbar-btn" type="button" onClick={shuffleSuggestions}>
          <ArrowsCounterClockwise size={14} />
          Refresh prompts
        </button>
      </div>

      <div className="welcome-input-area">
        <ChatInput
          ref={inputRef}
          value={question}
          onChange={onQuestionChange}
          onSubmit={onSubmit}
          onFileUpload={onFileUpload}
          disabled={loading}
          placeholder="Describe anything you need..."
          centered
        />
        <p className="welcome-hint">
          Press <kbd className="shortcut-kbd">Shift</kbd> +<kbd className="shortcut-kbd">?</kbd> to
          open the command palette
        </p>
      </div>
    </div>
  )
}

export default WelcomeScreen
