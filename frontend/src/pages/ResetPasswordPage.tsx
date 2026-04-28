import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom'
import { EyeIcon as Eye } from '@phosphor-icons/react/Eye'
import { EyeSlashIcon as EyeSlash } from '@phosphor-icons/react/EyeSlash'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../config/api'
import './AuthPage.css'

/**
 * Reset-password landing page. The reset link in the email points
 * here with the single-use token in the query string. We only
 * collect the new password client-side; the token is round-tripped
 * untouched to the backend.
 */
function ResetPasswordPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(() => params.get('token') || '', [params])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Auto-redirect after a successful reset so the user lands on the
  // login screen with a fresh slate.
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => navigate('/login', { replace: true }), 3000)
    return () => clearTimeout(timer)
  }, [success, navigate])

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

    if (!token) {
      setError('Reset link is missing or malformed. Please request a new one.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/auth/reset-password', {
        token,
        new_password: password,
      })
      setSuccess(true)
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
            <h1 className="auth-headline">Choose a new password</h1>
            <p className="auth-subtitle">
              Pick something memorable. After resetting, you'll need to log in again on every
              device.
            </p>
          </div>

          <div className="auth-card">
            {success ? (
              <div className="auth-form">
                <p className="auth-confirmation">
                  Your password has been reset. Redirecting you to the log-in page...
                </p>
                <Link to="/login" className="auth-submit auth-submit-secondary">
                  Go to log in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="auth-field">
                  <label htmlFor="password">New password</label>
                  <div className="auth-input-wrapper">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      autoFocus
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="auth-eye-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="auth-field">
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <div className="auth-input-wrapper">
                    <input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="auth-eye-btn"
                      onClick={() => setShowConfirm(!showConfirm)}
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {error && <div className="auth-error">{error}</div>}

                <button type="submit" className="auth-submit" disabled={submitting || !token}>
                  {submitting ? <span className="auth-submit-loading" /> : 'Reset password'}
                </button>
              </form>
            )}

            <div className="auth-footer">
              <span>
                <Link to="/login" className="auth-link">
                  Back to log in
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
            <div className="auth-preview-msg assistant auth-anim-assistant">
              <p>
                Pick a strong, unique password. We'll log you out everywhere so any old sessions
                can't be used to get back in.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResetPasswordPage
