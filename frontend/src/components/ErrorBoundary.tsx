import { Component, type ErrorInfo, type ReactNode } from 'react'
import { WarningCircleIcon as WarningCircle } from '@phosphor-icons/react/WarningCircle'
import { ArrowClockwiseIcon as ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise'
import { ArrowCounterClockwiseIcon as ArrowCounterClockwise } from '@phosphor-icons/react/ArrowCounterClockwise'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-icon">
              <WarningCircle size={64} />
            </div>
            <h1>Something went wrong</h1>
            <p>An unexpected error occurred. Please try again or reload the page.</p>

            {import.meta.env.DEV && this.state.error && (
              <details className="error-details">
                <summary>Error Details</summary>
                <pre>{this.state.error.toString()}</pre>
                {this.state.errorInfo && <pre>{this.state.errorInfo.componentStack}</pre>}
              </details>
            )}

            <div className="error-actions">
              <button onClick={this.handleReset} className="error-btn primary">
                <ArrowCounterClockwise size={16} />
                Try Again
              </button>
              <button onClick={this.handleReload} className="error-btn secondary">
                <ArrowClockwise size={16} />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
