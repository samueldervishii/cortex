// Shared type definitions for the LLM Council frontend.
// These mirror the backend Pydantic schemas and are used across components.

export interface Model {
  id: string
  name: string
  provider: 'anthropic' | 'groq'
  is_chairman?: boolean
}

export interface ModelResponse {
  model_id: string
  model_name: string
  response: string
  error: string | null
  response_time_ms: number | null
}

export interface PeerReview {
  reviewer_model: string
  rankings: Record<string, unknown>[]
}

export interface ChatMessage {
  model_id: string
  model_name: string
  content: string
  reply_to: string | null
  response_time_ms: number | null
}

export interface DisagreementAnalysis {
  model_id: string
  model_name: string
  ranks_received: number[]
  mean_rank: number
  disagreement_score: number
  has_disagreement: boolean
}

export interface ConversationRound {
  question: string
  mode: CouncilMode
  status: RoundStatus
  selected_models: string[] | null
  system_prompt: string | null
  responses: ModelResponse[]
  peer_reviews: PeerReview[]
  chat_messages: ChatMessage[]
  final_synthesis: string | null
  disagreement_analysis: DisagreementAnalysis[]
}

export type CouncilMode = 'formal' | 'chat' | 'eli5_ladder'

export type RoundStatus =
  | 'pending'
  | 'responses_complete'
  | 'reviews_complete'
  | 'synthesized'
  | 'chat_complete'

export interface CouncilSession {
  id: string
  title: string | null
  rounds: ConversationRound[]
  version: number
  is_deleted: boolean
  is_pinned: boolean
  is_shared: boolean
  share_token: string | null
  shared_at: string | null
  pinned_at: string | null
  parent_session_id: string | null
  branched_from_round: number | null
  created_at: string | null
}

export interface SessionSummary {
  id: string
  title: string | null
  question: string
  status: RoundStatus
  round_count: number
  created_at: string | null
  is_pinned: boolean
}

// Frontend-only message type used in the chat UI.
// Discriminated union on `type` for exhaustive handling.
export type MessageType = 'user' | 'council' | 'chairman' | 'chat' | 'system' | 'error' | 'eli5'

export interface UIMessage {
  type: MessageType
  content: string
  modelName: string | null
  timestamp: Date
  streaming?: boolean
  responseTime?: number
  replyTo?: string | null
  level?: string
  levelLabel?: string
}

export interface UserSettings {
  user_id: string
  theme: string
  enabled_beta_features: string[]
  auto_delete_days: number | null
  model_personas: Record<string, string>
}
