import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
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
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  const switchMode = () => {
    setError('')
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
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string }; status?: number } }
      if (axiosErr.response?.data?.detail) {
        setError(axiosErr.response.data.detail)
      } else if (axiosErr.response?.status === 401) {
        setError('Invalid email or password.')
      } else if (axiosErr.response?.status === 409) {
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
      <div className="auth-card">
        <div className="auth-header">
          <h1>Cortex</h1>
          <p>{isRegister ? 'Create your account' : 'Welcome back'}</p>
        </div>

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
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegister ? 'Min. 8 characters' : 'Your password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              disabled={submitting}
            />
          </div>

          {isRegister && (
            <div className="auth-field">
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                disabled={submitting}
              />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={submitting}>
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
  )
}

export default AuthPage
