import { useState } from 'react'
import { XIcon as X } from '@phosphor-icons/react/X'
import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown'

interface FeedbackModalProps {
  type: 'positive' | 'negative'
  onSubmit: (comment: string, issueType?: string) => void
  onClose: () => void
}

const ISSUE_TYPES = [
  'UI bug',
  'Overactive refusal',
  'Poor image understanding',
  'Did not fully follow my request',
  'Not factually correct',
  'Incomplete response',
  'Issue with thought process',
  'Should have searched the web',
  'Other',
]

function FeedbackModal({ type, onSubmit, onClose }: FeedbackModalProps) {
  const [comment, setComment] = useState('')
  const [issueType, setIssueType] = useState('')
  const [selectOpen, setSelectOpen] = useState(false)

  const handleSubmit = () => {
    onSubmit(comment, type === 'negative' ? issueType : undefined)
  }

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
        <button className="feedback-close" onClick={onClose}>
          <X size={18} />
        </button>

        <h3 className="feedback-title">Give {type} feedback</h3>

        {type === 'negative' && (
          <div className="feedback-field">
            <label>What type of issue do you wish to report? (optional)</label>
            <div className="feedback-select-wrapper">
              <button className="feedback-select" onClick={() => setSelectOpen(!selectOpen)}>
                <span>{issueType || 'Select...'}</span>
                <CaretDown size={16} />
              </button>
              {selectOpen && (
                <div className="feedback-select-dropdown">
                  {ISSUE_TYPES.map((t) => (
                    <button
                      key={t}
                      className={`feedback-select-option ${t === issueType ? 'selected' : ''}`}
                      onClick={() => {
                        setIssueType(t)
                        setSelectOpen(false)
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="feedback-field">
          <label>Please provide details: (optional)</label>
          <textarea
            className="feedback-textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              type === 'positive'
                ? 'What was satisfying about this response?'
                : 'What went wrong with this response?'
            }
            rows={4}
          />
        </div>

        <div className="feedback-actions">
          <button className="feedback-submit" onClick={handleSubmit}>
            Submit
          </button>
          <button className="feedback-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default FeedbackModal
