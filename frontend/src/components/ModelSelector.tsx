import { useState, useRef, useEffect } from 'react'
import { useToast } from '../contexts/ToastContext'

interface Model {
  id: string
  name: string
  provider: string
  icon: string
}

const MODELS: Model[] = [
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    icon: '/models/icons8-claude-ai-96.png',
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    provider: 'OpenAI',
    icon: '/models/icons8-chatgpt-100.png',
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'OpenAI',
    icon: '/models/icons8-chatgpt-100.png',
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    icon: '/models/icons8-claude-ai-96.png',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    icon: '/models/icons8-gemini-ai-96.png',
  },
  {
    id: 'grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'xAI',
    icon: '/models/icons8-grok-100.png',
  },
  {
    id: 'grok-3-mini-fast',
    name: 'Grok 3 Mini Fast',
    provider: 'xAI',
    icon: '/models/icons8-grok-100.png',
  },
]

const DEFAULT_MODEL = MODELS[0]

function ModelSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = (model: Model) => {
    setSelectedModel(model)
    setIsOpen(false)
    if (model.id !== DEFAULT_MODEL.id) {
      showToast('This model is not available yet. Using default model.', 'info')
    }
  }

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button className="model-selector-trigger" onClick={() => setIsOpen(!isOpen)}>
        <img className="model-selector-img" src={selectedModel.icon} alt="" />
        <span className="model-selector-name">{selectedModel.name}</span>
        <svg
          className={`model-selector-chevron ${isOpen ? 'open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          {MODELS.map((model) => (
            <button
              key={model.id}
              className={`model-selector-option ${model.id === selectedModel.id ? 'selected' : ''}`}
              onClick={() => handleSelect(model)}
            >
              <img className="model-option-img" src={model.icon} alt="" />
              <span className="model-option-name">{model.name}</span>
              {model.id === selectedModel.id && (
                <svg
                  className="model-option-check"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ModelSelector
