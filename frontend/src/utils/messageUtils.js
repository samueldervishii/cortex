/**
 * Convert a council round to display messages
 * @param {Object} round - The conversation round from the API
 * @returns {Array} Array of message objects for display
 */
export function roundToMessages(round) {
  const msgs = []

  // User question
  msgs.push({
    type: 'user',
    content: round.question,
    timestamp: new Date(),
  })

  // Check if this is a chat mode round
  if (round.mode === 'chat' && round.chat_messages && round.chat_messages.length > 0) {
    // Chat mode: display messages as a group chat
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
  const disagreementMap = {}
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
        peerReviews: round.peer_reviews,
        responses: round.responses,
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
 * Load messages from a session's rounds
 * @param {Object} session - The session object from the API
 * @returns {Array} Array of all messages from all rounds
 */
export function loadMessagesFromSession(session) {
  const loadedMessages = []
  if (session.rounds && session.rounds.length > 0) {
    for (const round of session.rounds) {
      loadedMessages.push(...roundToMessages(round))
    }
  }
  return loadedMessages
}
