import type { ConversationRound, CouncilSession, DisagreementAnalysis } from '../types'

// UI message type — broader than the API types because it includes
// frontend-only message types like 'voting' and 'system'.
export interface DisplayMessage {
  type: string
  content?: string
  modelName?: string
  timestamp: Date
  streaming?: boolean
  responseTime?: number | null
  replyTo?: string | null
  level?: string
  levelLabel?: string
  disagreement?: DisagreementAnalysis | null
  // Voting visualization data (only for type: 'voting')
  peerReviews?: Record<string, unknown>[]
  responses?: Record<string, unknown>[]
  disagreementAnalysis?: DisagreementAnalysis[]
}

/**
 * Convert a council round to display messages.
 */
export function roundToMessages(round: ConversationRound): DisplayMessage[] {
  const msgs: DisplayMessage[] = []

  // User question
  msgs.push({
    type: 'user',
    content: round.question,
    timestamp: new Date(),
  })

  // ELI5 Ladder mode
  if (round.mode === 'eli5_ladder' && round.responses && round.responses.length > 0) {
    msgs.push({
      type: 'system',
      content: 'Generating explanations at multiple complexity levels...',
      timestamp: new Date(),
    })
    for (const resp of round.responses) {
      if (resp.error) {
        msgs.push({
          type: 'error',
          content: `Error: ${resp.error}`,
          modelName: resp.model_name,
          timestamp: new Date(),
        })
      } else {
        const levelMatch = resp.model_name.match(/ELI5 · (.+)/)
        const levelLabel = levelMatch ? levelMatch[1] : resp.model_name
        const levelId = levelLabel.toLowerCase()
        msgs.push({
          type: 'eli5',
          content: resp.response,
          modelName: resp.model_name,
          level: levelId,
          levelLabel,
          responseTime: resp.response_time_ms,
          timestamp: new Date(),
        })
      }
    }
    return msgs
  }

  // Check if this is a chat mode round
  if (round.mode === 'chat' && round.chat_messages && round.chat_messages.length > 0) {
    for (const chatMsg of round.chat_messages) {
      msgs.push({
        type: 'chat',
        content: chatMsg.content,
        modelName: chatMsg.model_name,
        replyTo: chatMsg.reply_to,
        responseTime: chatMsg.response_time_ms,
        timestamp: new Date(),
      })
    }
    return msgs
  }

  // Formal mode: traditional council responses
  // Build disagreement lookup by model_id
  const disagreementMap: Record<string, DisagreementAnalysis> = {}
  if (round.disagreement_analysis) {
    for (const analysis of round.disagreement_analysis) {
      disagreementMap[analysis.model_id] = analysis
    }
  }

  // Council responses
  if (round.responses && round.responses.length > 0) {
    msgs.push({
      type: 'system',
      content: 'Gathering responses from the council...',
      timestamp: new Date(),
    })

    for (const resp of round.responses) {
      if (resp.error) {
        msgs.push({
          type: 'error',
          content: `Error: ${resp.error}`,
          modelName: resp.model_name,
          timestamp: new Date(),
        })
      } else {
        msgs.push({
          type: 'council',
          content: resp.response,
          modelName: resp.model_name,
          responseTime: resp.response_time_ms,
          timestamp: new Date(),
          disagreement: disagreementMap[resp.model_id] || null,
        })
      }
    }

    // Add voting visualization after responses if we have peer reviews
    if (round.peer_reviews && round.peer_reviews.length > 0) {
      msgs.push({
        type: 'voting',
        peerReviews: round.peer_reviews as Record<string, unknown>[],
        responses: round.responses as unknown as Record<string, unknown>[],
        disagreementAnalysis: round.disagreement_analysis,
        timestamp: new Date(),
      })
    }
  }

  // Chairman's synthesis
  if (round.final_synthesis) {
    msgs.push({
      type: 'system',
      content: 'Claude Sonnet 4.6 is reviewing all responses...',
      timestamp: new Date(),
    })
    msgs.push({
      type: 'chairman',
      content: round.final_synthesis,
      modelName: 'Claude Sonnet 4.6 (Head)',
      timestamp: new Date(),
    })
  }

  return msgs
}

/**
 * Load messages from a session's rounds.
 */
export function loadMessagesFromSession(session: CouncilSession): DisplayMessage[] {
  const loadedMessages: DisplayMessage[] = []
  if (session.rounds && session.rounds.length > 0) {
    for (const round of session.rounds) {
      loadedMessages.push(...roundToMessages(round))
    }
  }
  return loadedMessages
}
