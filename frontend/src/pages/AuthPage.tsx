import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { EyeIcon as Eye } from '@phosphor-icons/react/Eye'
import { EyeSlashIcon as EyeSlash } from '@phosphor-icons/react/EyeSlash'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../config/api'
import './AuthPage.css'

function AuthPage() {
  const { login, register, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const isRegisterRoute = location.pathname === '/register'
  const [isRegister, setIsRegister] = useState(isRegisterRoute)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>(
    'idle'
  )
  const emailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync tab with URL
  useEffect(() => {
    setIsRegister(location.pathname === '/register')
  }, [location.pathname])

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

  const checkEmail = (value: string) => {
    if (emailTimerRef.current) clearTimeout(emailTimerRef.current)
    if (!value || !value.includes('@') || value.length < 5) {
      setEmailStatus('idle')
      return
    }
    setEmailStatus('checking')
    emailTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get(
          `/auth/check-email/${encodeURIComponent(value.toLowerCase())}`
        )
        setEmailStatus(res.data.available ? 'available' : 'taken')
      } catch {
        setEmailStatus('idle')
      }
    }, 500)
  }

  const switchMode = () => {
    setError('')
    setEmailStatus('idle')
    const next = isRegister ? '/login' : '/register'
    navigate(next, { replace: true })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.')
      return
    }

    if (isRegister) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setSubmitting(true)
    try {
      if (isRegister) {
        await register(email.trim().toLowerCase(), password)
      } else {
        await login(email.trim().toLowerCase(), password)
      }
      navigate('/', { replace: true })
    } catch (err: any) {
      if (err?.isNetworkError) {
        setError('Please check your internet connection.')
      } else if (err?.response?.data?.detail) {
        setError(err.response.data.detail)
      } else if (err?.response?.status === 401) {
        setError('Invalid email or password.')
      } else if (err?.response?.status === 409) {
        setError('An account with this email already exists.')
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
              <img src="/IMG_6935.png" alt="" className="auth-logo" />
              <span className="auth-brand-name">Cortex</span>
            </div>
            <h1 className="auth-headline">
              Your mind,
              <br />
              amplified.
            </h1>
            <p className="auth-subtitle">
              Intelligent AI conversations, beautifully simple.{' '}
              <a
                href="https://cortex-al.vercel.app"
                className="auth-learn-more"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more &rarr;
              </a>
            </p>
          </div>

          <div className="auth-card">
            <div className="auth-tabs">
              <button
                className={`auth-tab ${!isRegister ? 'active' : ''}`}
                onClick={switchMode}
                type="button"
              >
                Log in
              </button>
              <button
                className={`auth-tab ${isRegister ? 'active' : ''}`}
                onClick={switchMode}
                type="button"
              >
                Sign up
              </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (isRegister) checkEmail(e.target.value)
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  disabled={submitting}
                />
                {isRegister && emailStatus === 'checking' && (
                  <span className="auth-field-status checking">Checking...</span>
                )}
                {isRegister && emailStatus === 'available' && (
                  <span className="auth-field-status available">Email available</span>
                )}
                {isRegister && emailStatus === 'taken' && (
                  <span className="auth-field-status taken">Email already registered</span>
                )}
              </div>

              <div className="auth-field">
                <label htmlFor="password">Password</label>
                <div className="auth-input-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isRegister ? 'Min. 8 characters' : 'Your password'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
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

              {isRegister && (
                <div className="auth-field">
                  <label htmlFor="confirm-password">Confirm password</label>
                  <div className="auth-input-wrapper">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="auth-eye-btn"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="auth-error">{error}</div>}

              <button
                type="submit"
                className="auth-submit"
                disabled={submitting || (isRegister && emailStatus === 'taken')}
              >
                {submitting ? (
                  <span className="auth-submit-loading" />
                ) : isRegister ? (
                  'Create account'
                ) : (
                  'Log in'
                )}
              </button>
            </form>

            <div className="auth-footer">
              {isRegister ? (
                <span>
                  Already have an account?{' '}
                  <button type="button" className="auth-link" onClick={switchMode}>
                    Log in
                  </button>
                </span>
              ) : (
                <span>
                  Don't have an account?{' '}
                  <button type="button" className="auth-link" onClick={switchMode}>
                    Sign up
                  </button>
                </span>
              )}
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
            <span className="auth-preview-model">Claude Sonnet 4.6</span>
          </div>
          <div className="auth-preview-messages">
            <div className="auth-preview-msg user auth-anim-user">
              <p>Help me outline my thesis on the impact of AI in education</p>
            </div>
            <div className="auth-preview-typing">
              <span className="auth-typing-dot" />
              <span className="auth-typing-dot" />
              <span className="auth-typing-dot" />
            </div>
            <div className="auth-preview-msg assistant auth-anim-assistant">
              <p>
                <strong>Great topic!</strong> Here's a structured outline to get you started:
              </p>
              <p>
                <strong>1. Introduction</strong> — Define AI in education, state your thesis
                objective and core research questions
              </p>
              <p>
                <strong>2. Literature Review</strong> — Survey current AI tools in pedagogy,
                adaptive learning systems, and historical context
              </p>
              <p>
                <strong>3. Methodology</strong> — Detail your research approach, data collection
                strategy, and participant demographics
              </p>
              <p>
                <strong>4. Analysis &amp; Findings</strong> — Present impact on student outcomes,
                accessibility improvements, and engagement metrics
              </p>
              <p className="auth-preview-followup">
                Would you like me to expand on any of these sections?
              </p>
            </div>
          </div>
          <div className="auth-preview-input">
            <span className="auth-preview-input-text">Ask Cortex anything...</span>
            <span className="auth-preview-input-arrow">&#8593;</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
