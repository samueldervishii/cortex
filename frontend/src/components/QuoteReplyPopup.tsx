import { CornerUpLeft } from 'lucide-react'

interface QuoteReplyPopupProps {
  top: number
  left: number
  onReply: () => void
}

function QuoteReplyPopup({ top, left, onReply }: QuoteReplyPopupProps) {
  return (
    <div
      className="quote-reply-popup"
      style={{ top: `${top}px`, left: `${left}px` }}
      role="toolbar"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="quote-reply-btn"
        onClick={onReply}
        title="Reply to selection"
      >
        <span>Reply</span>
        <CornerUpLeft size={14} />
      </button>
    </div>
  )
}

export default QuoteReplyPopup
