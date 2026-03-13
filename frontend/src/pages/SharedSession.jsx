import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiClient, FRONTEND_VERSION } from '../config/api'
import { ChatMessages, ChatSkeleton } from '../components'
import { loadMessagesFromSession } from '../utils'
import '../App.css'

function SharedSession() {
  const { shareToken } = useParams()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sessionTitle, setSessionTitle] = useState('')

  useEffect(() => {
    const loadSharedSession = async () => {
      try {
        setLoading(true)
        const res = await apiClient.get(`/shared/${shareToken}`)
        const session = res.data.session

        setSessionTitle(session.title || 'Shared Session')
        setMessages(loadMessagesFromSession(session))
      } catch (err) {
        console.error('Error loading shared session:', err)
        setError('This shared session is not available or has been revoked.')
      } finally {
        setLoading(false)
      }
    }

    loadSharedSession()
  }, [shareToken])

  if (loading) {
    return (
      <div className="chat-app">
        <div className="top-bar shared-top-bar">
          <div className="shared-badge">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Shared Session
          </div>
        </div>
        <ChatSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="shared-error">
        <h1>Session Not Found</h1>
        <p>{error}</p>
        <Link to="/" className="shared-home-link">
          Go to LLM Council
        </Link>
      </div>
    )
  }

  return (
    <div className="chat-app shared-view">
      <div className="top-bar shared-top-bar">
        <div className="shared-badge">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Shared Session
        </div>
        <Link to="/" className="new-chat-btn">
          Open LLM Council
        </Link>
      </div>

      <ChatMessages
        messages={messages}
        loading={false}
        currentStep=""
        question=""
        onQuestionChange={() => {}}
        onSubmit={() => {}}
        readOnly={true}
      />

      {/* <div className="shared-footer">
        <span>v{FRONTEND_VERSION}</span>
        <span>|</span>
        <a href="https://llm-council-docs.netlify.app/" target="_blank" rel="noopener noreferrer">
          Documentation
        </a>
      </div> */}
    </div>
  )
}

export default SharedSession
