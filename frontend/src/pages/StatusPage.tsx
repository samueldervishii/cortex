import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, FRONTEND_VERSION } from '../config/api'
import '../App.css'

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unknown'

interface ServiceDay {
  date: string
  status: ServiceStatus
}

interface UptimeService {
  id: string
  label: string
  description: string
  current_status: ServiceStatus
  last_checked: string | null
  uptime_24h: number | null
  uptime_7d: number | null
  sample_count_24h: number
  sample_count_7d: number
  days: ServiceDay[]
}

interface UptimeResponse {
  overall_status: ServiceStatus
  services: UptimeService[]
  generated_at: string | null
}

// Fallback payload used when the backend is unreachable. Keeps the
// service cards visible (in red/down state) instead of collapsing to a
// bare error message. The failed fetch IS itself a check — we just
// confirmed the server is unreachable — so we stamp `last_checked` with
// the current client time rather than leaving it null ("Never").
function buildDownFallback(): UptimeResponse {
  const now = new Date().toISOString()
  const emptyService = (
    id: string,
    label: string,
    description: string
  ): UptimeService => ({
    id,
    label,
    description,
    current_status: 'down',
    last_checked: now,
    uptime_24h: null,
    uptime_7d: null,
    sample_count_24h: 0,
    sample_count_7d: 0,
    days: [],
  })
  return {
    overall_status: 'down',
    services: [
      emptyService('api', 'API Server', 'Cortex backend'),
      emptyService('database', 'Database', 'MongoDB Atlas'),
    ],
    generated_at: now,
  }
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
}

function formatLastChecked(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const minutes = Math.floor(diffMs / 60000)
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch {
    return iso
  }
}

function formatUptime(value: number | null, samples: number): string {
  if (value === null || samples === 0) return '—'
  return `${value.toFixed(2)}%`
}

function dayLabel(isoDate: string): string {
  try {
    const d = new Date(isoDate + 'T00:00:00Z')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return isoDate
  }
}

function StatusPage() {
  const navigate = useNavigate()
  const [uptime, setUptime] = useState<UptimeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const fetchUptime = useCallback(async () => {
    try {
      const res = await apiClient.get('/status/uptime')
      setUptime(res.data)
      setError(null)
    } catch (err: any) {
      setError(
        err.response?.data?.detail || err.message || 'Unable to reach API server'
      )
      // Keep the layout stable: render the three service cards in a
      // "down" fallback state instead of collapsing to a bare error.
      setUptime(buildDownFallback())
    } finally {
      setLoading(false)
      setLastFetched(new Date())
    }
  }, [])

  useEffect(() => {
    fetchUptime()
    const interval = setInterval(fetchUptime, 30000)
    return () => clearInterval(interval)
  }, [fetchUptime])

  const overall: ServiceStatus = error ? 'down' : uptime?.overall_status || 'unknown'
  const operationalCount =
    uptime?.services.filter((s) => s.current_status === 'operational').length || 0
  const totalCount = uptime?.services.length || 0
  const hasIncident = uptime
    ? uptime.services.some((s) => s.current_status !== 'operational')
    : false

  const bannerText: Record<ServiceStatus, { title: string; sub: string }> = {
    operational: {
      title: 'All Systems Operational',
      sub: 'Every tracked service is responding normally.',
    },
    degraded: {
      title: 'Partial Service Disruption',
      sub: 'One or more components are experiencing issues.',
    },
    down: {
      title: 'Service Outage',
      sub: error || 'One or more components are unavailable.',
    },
    unknown: {
      title: 'Checking systems…',
      sub: '',
    },
  }

  return (
    <div className="status-page status-page-v2">
      <header className="status-page-header">
        <button className="status-page-back" onClick={() => navigate('/')} title="Back">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1>System Status</h1>
        <span className="status-page-version">v{FRONTEND_VERSION}</span>
      </header>

      {hasIncident && uptime && (
        <div className="status-incident-banner">
          <div className="status-incident-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="status-incident-body">
            <strong>Service disruption detected.</strong>{' '}
            <span>
              {uptime.services
                .filter((s) => s.current_status !== 'operational')
                .map((s) => s.label)
                .join(', ')}{' '}
              currently experiencing issues.
            </span>
            <div className="status-incident-note">
              We're checking on this and working to restore service.
            </div>
          </div>
        </div>
      )}

      <div className={`status-overall-card status-${overall}`}>
        <div className="status-overall-icon">
          {overall === 'operational' && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {(overall === 'degraded' || overall === 'down') && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
        <div className="status-overall-text">
          <h2>{bannerText[overall].title}</h2>
          {bannerText[overall].sub && <p>{bannerText[overall].sub}</p>}
        </div>
        {uptime && totalCount > 0 && (
          <div className="status-overall-summary">
            <div className="status-summary-big">
              {operationalCount}
              <span>/{totalCount}</span>
            </div>
            <div className="status-summary-label">services operational</div>
          </div>
        )}
      </div>

      {loading && !uptime ? (
        <div className="status-page-loading">
          <div className="status-page-spinner" />
          <p>Checking system status…</p>
        </div>
      ) : uptime ? (
        <section className="status-services-section">
          <h3 className="status-section-title">Services</h3>
          <p className="status-section-sub">
            Probed every 5 minutes. History grows as data is collected.
          </p>

          {uptime.services.map((svc) => (
            <article
              key={svc.id}
              className={`status-service-card status-${svc.current_status}`}
            >
              <div className="status-service-head">
                <div className="status-service-title">
                  <span className={`status-service-dot status-${svc.current_status}`} />
                  <div>
                    <h4>{svc.label}</h4>
                    <span className="status-service-desc">{svc.description}</span>
                  </div>
                </div>
                <div className="status-service-right">
                  <span className={`status-service-badge status-${svc.current_status}`}>
                    {STATUS_LABEL[svc.current_status]}
                  </span>
                  <span className="status-service-meta">
                    Last check: {formatLastChecked(svc.last_checked)}
                  </span>
                </div>
              </div>

              <div className="status-service-metrics">
                <div className="status-metric">
                  <span className="status-metric-label">Uptime (24h)</span>
                  <span className="status-metric-value">
                    {formatUptime(svc.uptime_24h, svc.sample_count_24h)}
                  </span>
                </div>
                <div className="status-metric">
                  <span className="status-metric-label">Uptime (7d)</span>
                  <span className="status-metric-value">
                    {formatUptime(svc.uptime_7d, svc.sample_count_7d)}
                  </span>
                </div>
                <div className="status-metric">
                  <span className="status-metric-label">Samples</span>
                  <span className="status-metric-value">{svc.sample_count_7d}</span>
                </div>
              </div>

              <div className="status-day-bars">
                {svc.days.length === 0 ? (
                  <div className="status-day-empty">
                    {svc.current_status === 'down'
                      ? 'No data available — service unreachable.'
                      : 'No history yet — data appears as the scheduler collects probes.'}
                  </div>
                ) : (
                  <>
                    <div className="status-day-row">
                      {svc.days.map((d) => (
                        <div
                          key={d.date}
                          className={`status-day-square status-${d.status}`}
                          title={`${dayLabel(d.date)} — ${STATUS_LABEL[d.status]}`}
                        />
                      ))}
                    </div>
                    <div className="status-day-labels">
                      <span>{dayLabel(svc.days[0].date)}</span>
                      {svc.days.length > 1 && (
                        <span>{dayLabel(svc.days[svc.days.length - 1].date)}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </article>
          ))}

          {lastFetched && (
            <p className="status-last-updated">
              Last refresh: {lastFetched.toLocaleTimeString()}
            </p>
          )}
        </section>
      ) : (
        <div className="status-page-loading">
          <p>{error || 'Unable to load status data.'}</p>
        </div>
      )}
    </div>
  )
}

export default StatusPage
