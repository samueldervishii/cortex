import { useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown'

export interface ModelDef {
  id: string
  name: string
  shortName: string
  description: string
  tier: 'DEFAULT' | 'MAX' | 'FAST'
  icon: string
}

export const MODELS: ModelDef[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    description: 'Balanced · fast · default · most efficient',
    tier: 'DEFAULT',
    icon: '/models/icons8-claude-ai-96.png',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    shortName: 'Opus 4.6',
    description: 'Deepest reasoning · slower · more expensive',
    tier: 'MAX',
    icon: '/models/icons8-claude-ai-96.png',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    description: 'Quick replies · cheapest · less powerful',
    tier: 'FAST',
    icon: '/models/icons8-claude-ai-96.png',
  },
]

const STORAGE_KEY = 'etude-selected-model'
const DEFAULT_MODEL_ID = MODELS[0].id
const MODEL_CHANGED_EVENT = 'etude:model-changed'

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

/** Reactive hook: returns the currently selected model, updating across the
 *  app whenever any `ModelSelector` (or another tab via `storage`) changes it. */
export function useSelectedModel(): ModelDef {
  const id = useSyncExternalStore(subscribeModel, getSelectedModelId, getSelectedModelId)
  return MODELS.find((m) => m.id === id) || MODELS[0]
}

function subscribeModel(cb: () => void): () => void {
  const handler = () => cb()
  window.addEventListener(MODEL_CHANGED_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(MODEL_CHANGED_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

interface ModelSelectorProps {
  variant?: 'topbar' | 'input'
}

/** Drop direction: topbar variant drops down under the trigger, input
 *  variant (inside the chat input) drops up above it. */
type DropDirection = 'down' | 'up'

interface DropdownPosition {
  top: number
  left: number
  width: number
  direction: DropDirection
}

const DROPDOWN_WIDTH = 320
const DROPDOWN_MAX_HEIGHT = 360
const DROPDOWN_GAP = 6

function ModelSelector({ variant = 'topbar' }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const selected = useSelectedModel()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Compute a viewport-relative position for the dropdown so we can render it
  // via a portal (escaping any `overflow: hidden` parent like `.chat-content`).
  useLayoutEffect(() => {
    if (!isOpen) return
    const compute = () => {
      const btn = triggerRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      const prefersUp = variant === 'input'

      const spaceBelow = viewportH - rect.bottom
      const spaceAbove = rect.top
      const fitsBelow = spaceBelow >= DROPDOWN_MAX_HEIGHT + DROPDOWN_GAP
      const fitsAbove = spaceAbove >= DROPDOWN_MAX_HEIGHT + DROPDOWN_GAP

      let direction: DropDirection = prefersUp ? 'up' : 'down'
      if (direction === 'down' && !fitsBelow && fitsAbove) direction = 'up'
      if (direction === 'up' && !fitsAbove && fitsBelow) direction = 'down'

      // Align right edge with the trigger's right edge; clamp to viewport.
      const width = Math.min(DROPDOWN_WIDTH, viewportW - 16)
      let left = rect.right - width
      if (left < 8) left = 8
      if (left + width > viewportW - 8) left = viewportW - width - 8

      const top = direction === 'down' ? rect.bottom + DROPDOWN_GAP : rect.top - DROPDOWN_GAP
      setPosition({ top, left, width, direction })
    }

    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [isOpen, variant])

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return
      }
      setIsOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  const choose = (id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Ignore quota / privacy-mode failures
    }
    window.dispatchEvent(new CustomEvent(MODEL_CHANGED_EVENT, { detail: id }))
    setIsOpen(false)
  }

  const dropdown =
    isOpen && position
      ? createPortal(
          <div
            ref={dropdownRef}
            className={`model-selector-dropdown model-selector-dropdown-portal drop-${position.direction}`}
            role="listbox"
            style={{
              position: 'fixed',
              top: position.direction === 'down' ? position.top : undefined,
              bottom: position.direction === 'up' ? window.innerHeight - position.top : undefined,
              left: position.left,
              width: position.width,
              maxHeight: DROPDOWN_MAX_HEIGHT,
              zIndex: 2000,
            }}
          >
            {MODELS.map((model) => {
              const isSelected = model.id === selected.id
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`model-selector-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => choose(model.id)}
                >
                  <img className="model-option-img" src={model.icon} alt="" />
                  <div className="model-option-info">
                    <span className="model-option-name-row">
                      <span className="model-option-name">{model.name}</span>
                      <span className={`model-option-badge ${model.tier.toLowerCase()}`}>
                        {model.tier}
                      </span>
                    </span>
                    <span className="model-option-desc">{model.description}</span>
                  </div>
                  {isSelected && <span className="model-option-dot" aria-hidden="true" />}
                </button>
              )
            })}
            <div className="model-dropdown-footer">Model choice applies to new messages</div>
          </div>,
          document.body
        )
      : null

  return (
    <div className={`model-selector ${variant}`}>
      <button
        ref={triggerRef}
        className="model-selector-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        title={selected.name}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <img className="model-selector-img" src={selected.icon} alt="" />
        <span className="model-selector-name">
          {variant === 'topbar' ? selected.name : selected.shortName}
        </span>
        <CaretDown size={12} className={`model-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>
      {dropdown}
    </div>
  )
}

export default ModelSelector
