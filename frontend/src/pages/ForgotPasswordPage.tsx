import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../config/api'
import './AuthPage.css'

/**
 * "Forgot your password?" entry point. Sends the email address to the
 * backend, which generates a reset token and emails it. We always show
 * the same generic confirmation regardless of whether the email is
 * registered, mirroring the backend's anti-enumeration response.
 */
function ForgotPasswordPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      setError('Please enter your email address.')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/auth/forgot-password', { email: trimmed })
      setSubmitted(true)
    } catch (err: any) {
      if (err?.isNetworkError) {
        setError('Please check your internet connection.')
      } else if (err?.response?.data?.detail) {
        setError(err.response.data.detail)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-left-content">
          <div className="auth-brand">
            <div className="auth-brand-row">
              <img src="/logo.png" alt="" className="auth-logo" />
              <span className="auth-brand-name">Étude</span>
            </div>
            <h1 className="auth-headline">Reset your password</h1>
            <p className="auth-subtitle">
              Enter the email associated with your account and we'll send you a link to choose a new
              password.
            </p>
          </div>

          <div className="auth-card">
            {submitted ? (
              <div className="auth-form">
                <p className="auth-confirmation">
                  If that account exists, we've sent a password-reset link to{' '}
                  <strong>{email.trim().toLowerCase()}</strong>. The link expires in 30 minutes.
                </p>
                <p className="auth-confirmation-secondary">
                  Don't see it? Check your spam folder, or{' '}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => {
                      setSubmitted(false)
                      setError('')
                    }}
                  >
                    try a different email
                  </button>
                  .
                </p>
                <Link to="/login" className="auth-submit auth-submit-secondary">
                  Back to log in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="auth-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    disabled={submitting}
                  />
                </div>

                {error && <div className="auth-error">{error}</div>}

                <button type="submit" className="auth-submit" disabled={submitting}>
                  {submitting ? <span className="auth-submit-loading" /> : 'Send reset link'}
                </button>
              </form>
            )}

            <div className="auth-footer">
              <span>
                Remembered it?{' '}
                <Link to="/login" className="auth-link">
                  Log in
                </Link>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-preview">
          <div className="auth-preview-chrome">
            <span className="auth-preview-dot" />
            <span className="auth-preview-dot" />
            <span className="auth-preview-dot" />
          </div>
          <div className="auth-preview-topbar">
            <span className="auth-preview-model">Claude</span>
          </div>
          <div className="auth-preview-messages">
            <div className="auth-preview-msg user auth-anim-user">
              <p>I forgot my password — what now?</p>
            </div>
            <div className="auth-preview-msg assistant auth-anim-assistant">
              <p>No worries! Enter your email on the left and we'll send you a reset link.</p>
              <p className="auth-preview-followup">The link is good for 30 minutes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
