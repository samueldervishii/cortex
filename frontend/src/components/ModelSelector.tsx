import { useState, useRef, useEffect } from 'react'
import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown'
import { CheckIcon as Check } from '@phosphor-icons/react/Check'

export interface ModelDef {
  id: string
  name: string
  shortName: string
  description: string
  icon: string
}

export const MODELS: ModelDef[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    description: 'Most efficient for everyday tasks',
    icon: '/models/icons8-claude-ai-96.png',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    shortName: 'Opus 4.6',
    description: 'Most powerful for complex reasoning',
    icon: '/models/icons8-claude-ai-96.png',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    description: 'Fastest, lowest cost',
    icon: '/models/icons8-claude-ai-96.png',
  },
]

const STORAGE_KEY = 'cortex-selected-model'
const DEFAULT_MODEL_ID = MODELS[0].id

/** Read the selected model id from localStorage, with fallback + validation. */
export function getSelectedModelId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && MODELS.some((m) => m.id === stored)) return stored
  } catch {
    // localStorage unavailable — fall through to default
  }
  return DEFAULT_MODEL_ID
}

function ModelSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>(() => getSelectedModelId())
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selected = MODELS.find((m) => m.id === selectedId) || MODELS[0]

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

  const choose = (id: string) => {
    setSelectedId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Ignore quota / privacy-mode failures
    }
    setIsOpen(false)
  }

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        className="model-selector-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        title={selected.name}
      >
        <img className="model-selector-img" src={selected.icon} alt="" />
        <span className="model-selector-name">{selected.shortName}</span>
        <CaretDown size={14} className={`model-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          {MODELS.map((model) => {
            const isSelected = model.id === selectedId
            return (
              <button
                key={model.id}
                type="button"
                className={`model-selector-option ${isSelected ? 'selected' : ''}`}
                onClick={() => choose(model.id)}
              >
                <img className="model-option-img" src={model.icon} alt="" />
                <div className="model-option-info">
                  <span className="model-option-name">{model.name}</span>
                  <span className="model-option-desc">{model.description}</span>
                </div>
                {isSelected && <Check size={16} className="model-option-check" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ModelSelector
