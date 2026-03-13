import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, FRONTEND_VERSION } from '../config/api'
import '../App.css'

function StatusPage() {
  const navigate = useNavigate()
  const [statusData, setStatusData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastChecked, setLastChecked] = useState(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiClient.get('/status')
      setStatusData(res.data)
      setError(null)
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to reach API server')
      setStatusData(null)
    } finally {
      setLoading(false)
      setLastChecked(new Date())
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 15000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const getStatusIcon = (status) => {
    switch (status) {
      case 'operational':
        return <span className="status-page-icon operational">&#x25CF;</span>
      case 'degraded':
        return <span className="status-page-icon degraded">&#x25CF;</span>
      case 'down':
        return <span className="status-page-icon down">&#x25CF;</span>
      default:
        return <span className="status-page-icon unknown">&#x25CF;</span>
    }
  }

  const getOverallBanner = () => {
    if (error) return { className: 'down', text: 'System Unreachable', sub: error }
    if (!statusData) return { className: 'unknown', text: 'Checking...', sub: '' }
    if (statusData.overall_status === 'operational')
      return { className: 'operational', text: 'All Systems Operational', sub: '' }
    return {
      className: 'degraded',
      text: 'Some Systems Degraded',
      sub: 'One or more components are experiencing issues',
    }
  }

  const banner = getOverallBanner()

  return (
    <div className="status-page">
      <header className="status-page-header">
        <button className="status-page-back" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1>System Status</h1>
        <span className="status-page-version">v{FRONTEND_VERSION}</span>
      </header>

      <div className={`status-page-banner ${banner.className}`}>
        <h2>{banner.text}</h2>
        {banner.sub && <p>{banner.sub}</p>}
      </div>

      {loading && !statusData ? (
        <div className="status-page-loading">
          <div className="status-page-spinner" />
          <p>Checking system status...</p>
        </div>
      ) : statusData ? (
        <>
          <section className="status-page-section">
            <h3>Infrastructure</h3>
            <div className="status-page-checks">
              {Object.entries(statusData.checks).map(([key, check]) => (
                <div key={key} className="status-page-check-row">
                  <div className="status-page-check-left">
                    {getStatusIcon(check.status)}
                    <span className="status-page-check-name">
                      {key === 'api_server'
                        ? 'API Server'
                        : key === 'mongodb'
                          ? 'Database (MongoDB)'
                          : key === 'anthropic_circuit'
                            ? 'Anthropic Circuit Breaker'
                            : key}
                    </span>
                  </div>
                  <span className={`status-page-check-badge ${check.status}`}>
                    {check.status}
                  </span>
                  <span className="status-page-check-detail">{check.detail}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="status-page-section">
            <h3>AI Providers</h3>
            <div className="status-page-providers">
              {Object.entries(statusData.providers).map(([name, provider]) => (
                <div key={name} className="status-page-provider-card">
                  <div className="status-page-provider-header">
                    {getStatusIcon(provider.configured ? 'operational' : 'down')}
                    <span className="status-page-provider-name">
                      {name.charAt(0).toUpperCase() + name.slice(1)}
                    </span>
                    <span
                      className={`status-page-check-badge ${provider.configured ? 'operational' : 'down'}`}
                    >
                      {provider.configured ? 'Connected' : 'Not Configured'}
                    </span>
                  </div>
                  <div className="status-page-provider-models">
                    {provider.models.map((model) => (
                      <span key={model} className="status-page-model-tag">
                        {model}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="status-page-section">
            <h3>Council Configuration</h3>
            <div className="status-page-council">
              <div className="status-page-council-chairman">
                <span className="status-page-council-label">Chairman</span>
                <span className="status-page-council-model">
                  {statusData.models.chairman.name}
                </span>
                <span className="status-page-council-provider">
                  {statusData.models.chairman.provider}
                </span>
              </div>
              <div className="status-page-council-members">
                <span className="status-page-council-label">
                  Council Members ({statusData.models.council_members.length})
                </span>
                {statusData.models.council_members.map((model) => (
                  <div key={model.id} className="status-page-council-member">
                    <span>{model.name}</span>
                    <span className="status-page-council-provider">{model.provider}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="status-page-footer">
            <span>Environment: {statusData.environment}</span>
            {lastChecked && (
              <span>Last checked: {lastChecked.toLocaleTimeString()}</span>
            )}
            <button className="status-page-refresh" onClick={fetchStatus}>
              Refresh
            </button>
          </footer>
        </>
      ) : null}
    </div>
  )
}

export default StatusPage
