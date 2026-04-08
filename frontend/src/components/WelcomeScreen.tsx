import { useRef } from 'react'
import { Paperclip, FileText, Download } from 'lucide-react'
import ChatInput, { type ChatInputHandle } from './ChatInput'

interface WelcomeScreenProps {
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  loading: boolean
}

const SUGGESTIONS = [
  {
    eyebrow: 'Draft',
    title: 'Write a thesis introduction',
    description: 'Frame your argument with strong structure and a clear research tone.',
    prompt:
      'Write me a thesis introduction about the impact of artificial intelligence on modern education',
  },
  {
    eyebrow: 'Research',
    title: 'Overview of a complex topic',
    description: 'Break a subject into themes, key findings, and critical comparisons.',
    prompt:
      'Give me a comprehensive overview of renewable energy technologies, covering key themes, recent developments, and critical analysis',
  },
  {
    eyebrow: 'Refine',
    title: 'Improve and restructure',
    description: 'Tighten clarity, flow, and academic tone across your existing writing.',
    prompt:
      'Help me improve the clarity, structure, and academic tone of my draft. I will paste it next.',
  },
]

const CAPABILITIES = [
  { label: 'File Upload', icon: Paperclip },
  { label: 'Artifacts', icon: FileText },
  { label: 'DOCX Export', icon: Download },
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
      <div className="welcome-center">
        <img src="/logo.svg" alt="Cortex" className="welcome-mascot" />
        <h1 className="welcome-heading">Where research begins</h1>
        <p className="welcome-subheading">
          Draft, analyze, and organize your research with AI — all in one focused place.
        </p>
      </div>

      <div className="welcome-suggestions">
        {SUGGESTIONS.map((item) => (
          <button
            key={item.eyebrow}
            className="welcome-suggestion-card"
            onClick={() => handlePromptClick(item.prompt)}
          >
            <span className="welcome-suggestion-eyebrow">{item.eyebrow}</span>
            <span className="welcome-suggestion-title">{item.title}</span>
            <span className="welcome-suggestion-desc">{item.description}</span>
          </button>
        ))}
      </div>

      <div className="welcome-pills">
        {CAPABILITIES.map((cap) => (
          <span key={cap.label} className="welcome-pill">
            <cap.icon size={14} />
            {cap.label}
          </span>
        ))}
      </div>

      <div className="welcome-input-area">
        <ChatInput
          ref={inputRef}
          value={question}
          onChange={onQuestionChange}
          onSubmit={onSubmit}
          onFileUpload={onFileUpload}
          disabled={loading}
          placeholder="Ask for a draft, upload a source, or describe what you need..."
          centered
        />
      </div>
    </div>
  )
}

export default WelcomeScreen
