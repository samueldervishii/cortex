import { useEffect, useRef, useState, useMemo } from 'react'
import Message from './Message'
import VotingVisualization from './VotingVisualization'
import LoadingIndicator from './LoadingIndicator'
import ChatInput from './ChatInput'
import SessionActions from './SessionActions'

function ChatMessages({
  messages,
  loading,
  currentStep,
  question,
  onQuestionChange,
  onSubmit,
  readOnly = false,
  mode = 'formal',
  blindVoteEnabled = false,
  onExport,
  onBranch,
  onShare,
  sessionId,
  branchingEnabled = false,
}) {
  const messagesEndRef = useRef(null)
  const chatInputRef = useRef(null)
  const [userVote, setUserVote] = useState(null) // anonymous label the user voted for
  const [revealed, setRevealed] = useState(false)
  const prevUserMsgCount = useRef(0)

  // Reset vote state when a new user message arrives (new round)
  const userMsgCount = messages.filter((m) => m.type === 'user').length
  useEffect(() => {
    if (userMsgCount > prevUserMsgCount.current) {
      setUserVote(null)
      setRevealed(false)
      prevUserMsgCount.current = userMsgCount
    }
  }, [userMsgCount])

  // Index of the last user message — separates historical rounds from current
  const lastUserIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'user') return i
    }
    return -1
  }, [messages])

  // Build anonymous label mapping for current round's council messages
  const { anonymousMapping, currentRoundLabeled } = useMemo(() => {
    if (!blindVoteEnabled) return { anonymousMapping: {}, currentRoundLabeled: [] }
    const mapping = {} // 'Model A' -> 'Claude Sonnet 4.6'
    const nameToLabel = {} // 'Claude Sonnet 4.6' -> 'Model A'
    let counter = 0
    const labeled = messages.slice(lastUserIdx + 1).map((msg) => {
      if (msg.type === 'council') {
        if (!nameToLabel[msg.modelName]) {
          const label = `Model ${String.fromCharCode(65 + counter)}`
          nameToLabel[msg.modelName] = label
          mapping[label] = msg.modelName
          counter++
        }
        return { ...msg, anonymousLabel: nameToLabel[msg.modelName] }
      }
      return msg
    })
    return { anonymousMapping: mapping, currentRoundLabeled: labeled }
  }, [messages, blindVoteEnabled, lastUserIdx])

  // Check if all current-round council responses finished streaming
  const currentRoundMsgs = messages.slice(lastUserIdx + 1)
  const currentCouncilMsgs = currentRoundMsgs.filter((m) => m.type === 'council')
  const allResponsesDone =
    currentCouncilMsgs.length > 0 && currentCouncilMsgs.every((m) => !m.streaming)
  const showBlindVoteUI = blindVoteEnabled && allResponsesDone && !loading

  // Full display message list: historical messages unchanged, current round with anonymous labels
  const displayMessages = useMemo(() => {
    if (!blindVoteEnabled) return messages
    return [...messages.slice(0, lastUserIdx + 1), ...currentRoundLabeled]
  }, [messages, blindVoteEnabled, lastUserIdx, currentRoundLabeled])

  // Auto-focus the input when the component mounts (session opened or first reply)
  useEffect(() => {
    chatInputRef.current?.focus()
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  return (
    <>
      <div className="chat-messages">
        {displayMessages.map((msg, idx) => {
          if (msg.type === 'voting') {
            return (
              <VotingVisualization
                key={idx}
                peerReviews={msg.peerReviews}
                responses={msg.responses}
                disagreementAnalysis={msg.disagreementAnalysis}
              />
            )
          }

          const isCurrentRoundCouncil =
            blindVoteEnabled && msg.type === 'council' && idx > lastUserIdx

          // Show anonymous label while not revealed, real name after
          const displayName =
            isCurrentRoundCouncil && !revealed ? msg.anonymousLabel || msg.modelName : msg.modelName

          const isVotable = showBlindVoteUI && !revealed && isCurrentRoundCouncil
          const isVoted = Boolean(userVote && userVote === msg.anonymousLabel)

          return (
            <Message
              key={idx}
              type={msg.type}
              content={msg.content}
              modelName={displayName}
              disagreement={msg.disagreement}
              replyTo={msg.replyTo}
              responseTime={msg.responseTime}
              streaming={msg.streaming}
              level={msg.level}
              levelLabel={msg.levelLabel}
              blindVoteProps={
                isCurrentRoundCouncil
                  ? { isVotable, isVoted, onVote: () => setUserVote(msg.anonymousLabel) }
                  : null
              }
            />
          )
        })}

        {showBlindVoteUI && (
          <div className="blind-vote-bar">
            {!revealed ? (
              <>
                <span className="blind-vote-hint">
                  {userVote
                    ? `You picked ${userVote} — ready to see who said what?`
                    : 'Click "Vote" on your favourite response before the reveal!'}
                </span>
                {userVote && (
                  <button className="blind-vote-reveal-btn" onClick={() => setRevealed(true)}>
                    Reveal Models
                  </button>
                )}
              </>
            ) : (
              <span className="blind-vote-revealed-msg">
                {userVote
                  ? `Your pick (${userVote}) was ${anonymousMapping[userVote]}`
                  : 'Models revealed!'}
              </span>
            )}
          </div>
        )}

        {!loading && sessionId && (
          <SessionActions
            sessionId={sessionId}
            onExport={onExport}
            onBranch={onBranch}
            onShare={onShare}
            branchingEnabled={branchingEnabled}
          />
        )}

        {loading && <LoadingIndicator statusText={currentStep} />}

        <div ref={messagesEndRef} />
      </div>

      {!readOnly && (
        <ChatInput
          ref={chatInputRef}
          value={question}
          onChange={onQuestionChange}
          onSubmit={onSubmit}
          disabled={loading}
          placeholder={
            mode === 'chat'
              ? 'Message the group chat... (@ to mention)'
              : 'Ask the council another question...'
          }
          mode={mode}
        />
      )}
    </>
  )
}

export default ChatMessages
