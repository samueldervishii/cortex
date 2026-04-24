import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon as ArrowLeft } from '@phosphor-icons/react/ArrowLeft'
import { Keyboard as KeyboardIcon } from '@phosphor-icons/react/Keyboard'
import { useAuth } from '../contexts/AuthContext'
import { useUsage } from '../contexts/UsageContext'
import useTitle from '../hooks/useTitle'
import { useToast } from '../contexts/ToastContext'
import { FRONTEND_VERSION, apiClient } from '../config/api'
import { KEYBOARD_SHORTCUTS } from '../data/keyboardShortcuts'
import './Settings.css'

// Hard token cap per 5-hour bucket. Must match api/services/usage_service.py
// LIMIT_TOKENS. Enforced server-side — the bar is just the visual.
const LIMIT_TOKENS = 200_000

function formatResetTime(seconds: number): string {
  if (!seconds || seconds <= 0) return 'Ready'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function usagePercent(tokens: number): number {
  return Math.min(100, (tokens / LIMIT_TOKENS) * 100)
}

function usageBarState(percent: number): string {
  if (percent >= 100) return 'danger'
  if (percent >= 80) return 'warn'
  return 'normal'
}

interface SettingsData {
  auto_delete_days: number | null
}

function Settings() {
  useTitle('Settings')
  const { user, updateProfile, regenerateAvatar, changePassword, deleteAccount } = useAuth() as any
  const { showToast } = useToast()
  const {
    current: usageCurrent,
    history: usageHistory,
    refreshCurrent,
    refreshHistory,
  } = useUsage()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('general')

  const [settings, setSettings] = useState<SettingsData>({ auto_delete_days: null })
  const [settingsLoading, setSettingsLoading] = useState(true)

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [fieldOfWork, setFieldOfWork] = useState('')
  const [personalPrefs, setPersonalPrefs] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle')
  const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [workDropdownOpen, setWorkDropdownOpen] = useState(false)
  const workDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (workDropdownRef.current && !workDropdownRef.current.contains(e.target as Node)) {
        setWorkDropdownOpen(false)
      }
    }
    if (workDropdownOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [workDropdownOpen])

  const [showPassword, setShowPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [showDelete, setShowDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [clearHistoryModal, setClearHistoryModal] = useState({ open: false, includePinned: false })
  const [exportModal, setExportModal] = useState({ open: false, format: 'json', loading: false })

  useEffect(() => {
    loadSettings()
  }, [])
  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '')
      setUsername(user.username || '')
      setFieldOfWork(user.field_of_work || '')
      setPersonalPrefs(user.personal_preferences || '')
    }
  }, [user])
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['general', 'usage', 'data', 'about'].includes(tab)) setActiveTab(tab)
  }, [searchParams])

  useEffect(() => {
    if (activeTab === 'usage') {
      refreshCurrent()
      refreshHistory(30)
    }
  }, [activeTab, refreshCurrent, refreshHistory])

  const loadSettings = async () => {
    try {
      setSettingsLoading(true)
      const res = await apiClient.get('/settings')
      setSettings(res.data.settings)
    } catch (e) {
      console.error('Failed to load settings:', e)
    } finally {
      setSettingsLoading(false)
    }
  }
  const saveSettings = async (updates: Partial<SettingsData>) => {
    try {
      const res = await apiClient.patch('/settings', updates)
      setSettings(res.data.settings)
      showToast('Settings saved')
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  const saveProfile = async () => {
    setProfileSaving(true)
    setProfileError('')
    try {
      await updateProfile({
        display_name: displayName.trim(),
        username: username.trim(),
        field_of_work: fieldOfWork,
        personal_preferences: personalPrefs,
      })
      setEditingField(null)
      showToast('Profile updated')
    } catch (err: any) {
      setProfileError(err?.response?.data?.detail || 'Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const cancelFieldEdit = (field: string) => {
    if (user) {
      if (field === 'displayName') setDisplayName(user.display_name || '')
      if (field === 'username') setUsername(user.username || '')
      if (field === 'fieldOfWork') setFieldOfWork(user.field_of_work || '')
    }
    setEditingField(null)
    setProfileError('')
  }

  const handlePrefsSave = async () => {
    setProfileSaving(true)
    setProfileError('')
    try {
      await updateProfile({
        display_name: displayName.trim(),
        username: username.trim(),
        field_of_work: fieldOfWork,
        personal_preferences: personalPrefs,
      })
      showToast('Preferences saved')
    } catch (err: any) {
      setProfileError(err?.response?.data?.detail || 'Failed to save')
    } finally {
      setProfileSaving(false)
    }
  }

  const checkUsername = (value: string) => {
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current)
    if (!value || value.length < 3) {
      setUsernameStatus(value ? 'invalid' : 'idle')
      return
    }
    if (value === user?.username) {
      setUsernameStatus('idle')
      return
    }
    setUsernameStatus('checking')
    usernameTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get(`/auth/check-username/${encodeURIComponent(value)}`)
        setUsernameStatus(res.data.available ? 'available' : 'taken')
      } catch {
        setUsernameStatus('idle')
      }
    }, 400)
  }

  const handlePrefsCancel = () => {
    if (user) {
      setPersonalPrefs(user.personal_preferences || '')
      setProfileError('')
    }
  }
  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      await regenerateAvatar()
      showToast('Avatar updated')
    } catch {
    } finally {
      setRegenerating(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError('')
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    setChangingPassword(true)
    try {
      await changePassword(currentPassword, newPassword)
      setShowPassword(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('Password changed')
    } catch (err: any) {
      setPasswordError(err?.response?.data?.detail || 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      await deleteAccount(deletePassword)
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail || 'Failed to delete account')
      setDeleting(false)
    }
  }
  const handleClearHistory = async () => {
    try {
      await apiClient.delete(
        `/sessions/all?confirm=true&include_pinned=${clearHistoryModal.includePinned}`
      )
      setClearHistoryModal({ open: false, includePinned: false })
      showToast('History cleared')
    } catch (e) {
      console.error('Failed:', e)
    }
  }
  const handleExport = async () => {
    try {
      setExportModal((p) => ({ ...p, loading: true }))
      const res = await apiClient.get(`/sessions/export?format=${exportModal.format}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `chat_export.${exportModal.format === 'json' ? 'json' : 'md'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportModal({ open: false, format: 'json', loading: false })
    } catch (e) {
      console.error('Failed:', e)
      setExportModal((p) => ({ ...p, loading: false }))
    }
  }
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  const WORK_OPTIONS = [
    'Engineering',
    'Design',
    'Research',
    'Education',
    'Business',
    'Marketing',
    'Writing',
    'Science',
    'Healthcare',
    'Law',
    'Other',
  ]
  const TABS = [
    { id: 'general', label: 'My profile' },
    { id: 'usage', label: 'Usage' },
    { id: 'data', label: 'Data' },
    { id: 'about', label: 'About' },
  ]
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''

  return (
    <div className="settings-page">
      <div className="settings-header">
        <Link to="/" className="settings-back-link">
          <ArrowLeft size={14} />
          <span>Back to chat</span>
        </Link>
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">Manage your profile and personal preferences here.</p>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeTab === 'general' && (
            <>
              <h2 className="settings-section-title">My profile</h2>

              <div className="profile-table">
                <div className="profile-row">
                  <div className="profile-row-label">
                    <span className="profile-label-text">Photo</span>
                    <span className="profile-label-hint">
                      This will be displayed on your profile.
                    </span>
                  </div>
                  <div className="profile-row-value">
                    <button
                      className="settings-avatar-btn"
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      title="Generate new avatar"
                    >
                      {user?.avatar ? (
                        <img src={user.avatar} alt="" className="settings-avatar-img" />
                      ) : (
                        <span className="settings-avatar-fallback">
                          {(user?.display_name || user?.email || '?')[0].toUpperCase()}
                        </span>
                      )}
                      <span className="settings-avatar-overlay">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 2v6h-6" />
                          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                          <path d="M3 22v-6h6" />
                          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                      </span>
                    </button>
                    <button
                      className="profile-action-link"
                      onClick={handleRegenerate}
                      disabled={regenerating}
                    >
                      {regenerating ? 'Generating...' : 'Regenerate'}
                    </button>
                  </div>
                </div>

                <div className="profile-row">
                  <div className="profile-row-label">
                    <span className="profile-label-text">Full name</span>
                  </div>
                  <div className="profile-row-value">
                    {editingField === 'displayName' ? (
                      <div className="profile-inline-edit">
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Your name"
                          maxLength={100}
                          autoFocus
                        />
                        <div className="profile-inline-actions">
                          <button
                            className="profile-inline-cancel"
                            onClick={() => cancelFieldEdit('displayName')}
                          >
                            Cancel
                          </button>
                          <button
                            className="profile-inline-save"
                            onClick={saveProfile}
                            disabled={profileSaving}
                          >
                            {profileSaving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="profile-value-text">{displayName || '\u2014'}</span>
                        <button
                          className="profile-action-link"
                          onClick={() => setEditingField('displayName')}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="profile-row">
                  <div className="profile-row-label">
                    <span className="profile-label-text">Username</span>
                  </div>
                  <div className="profile-row-value">
                    {editingField === 'username' ? (
                      <div className="profile-inline-edit">
                        <div className="profile-input-with-status">
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^a-zA-Z0-9_]/g, '')
                              setUsername(v)
                              checkUsername(v)
                            }}
                            placeholder="username"
                            maxLength={50}
                            autoFocus
                          />
                          {usernameStatus === 'checking' && (
                            <span className="field-status checking">Checking...</span>
                          )}
                          {usernameStatus === 'available' && (
                            <span className="field-status available">Available</span>
                          )}
                          {usernameStatus === 'taken' && (
                            <span className="field-status taken">Taken</span>
                          )}
                          {usernameStatus === 'invalid' && (
                            <span className="field-status taken">Min 3 characters</span>
                          )}
                        </div>
                        <div className="profile-inline-actions">
                          <button
                            className="profile-inline-cancel"
                            onClick={() => {
                              cancelFieldEdit('username')
                              setUsernameStatus('idle')
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="profile-inline-save"
                            onClick={saveProfile}
                            disabled={
                              profileSaving ||
                              usernameStatus === 'taken' ||
                              usernameStatus === 'invalid'
                            }
                          >
                            {profileSaving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="profile-value-text">
                          {username ? `@${username}` : '\u2014'}
                        </span>
                        <button
                          className="profile-action-link"
                          onClick={() => setEditingField('username')}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="profile-row">
                  <div className="profile-row-label">
                    <span className="profile-label-text">Email</span>
                  </div>
                  <div className="profile-row-value">
                    <span className="profile-value-text">{user?.email || '\u2014'}</span>
                  </div>
                </div>

                <div className="profile-row">
                  <div className="profile-row-label">
                    <span className="profile-label-text">Field of work</span>
                  </div>
                  <div className="profile-row-value">
                    {editingField === 'fieldOfWork' ? (
                      <div className="profile-inline-edit">
                        <div className="custom-select" ref={workDropdownRef}>
                          <button
                            className="custom-select-trigger"
                            type="button"
                            onClick={() => setWorkDropdownOpen((p) => !p)}
                          >
                            <span>{fieldOfWork || 'Select...'}</span>
                            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                              <path
                                d="M1 1.5L6 6.5L11 1.5"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          {workDropdownOpen && (
                            <div className="custom-select-menu">
                              {WORK_OPTIONS.map((o) => (
                                <button
                                  key={o}
                                  className={`custom-select-option ${fieldOfWork === o ? 'selected' : ''}`}
                                  onClick={() => {
                                    setFieldOfWork(o)
                                    setWorkDropdownOpen(false)
                                  }}
                                >
                                  {o}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="profile-inline-actions">
                          <button
                            className="profile-inline-cancel"
                            onClick={() => cancelFieldEdit('fieldOfWork')}
                          >
                            Cancel
                          </button>
                          <button
                            className="profile-inline-save"
                            onClick={saveProfile}
                            disabled={profileSaving}
                          >
                            {profileSaving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {fieldOfWork ? (
                          <span className="profile-value-pill">{fieldOfWork}</span>
                        ) : (
                          <span className="profile-value-text">{'\u2014'}</span>
                        )}
                        <button
                          className="profile-action-link"
                          onClick={() => setEditingField('fieldOfWork')}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {memberSince && (
                  <div className="profile-row">
                    <div className="profile-row-label">
                      <span className="profile-label-text">Member since</span>
                    </div>
                    <div className="profile-row-value">
                      <span className="profile-value-text profile-value-muted">{memberSince}</span>
                    </div>
                  </div>
                )}
              </div>

              {profileError && <p className="settings-field-error">{profileError}</p>}
              <div className="settings-divider" />

              <div className="settings-section">
                <div className="settings-field">
                  <label>
                    What{' '}
                    <a
                      href="https://cortex-al.vercel.app/personalization.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="settings-label-link"
                    >
                      personal preferences
                    </a>{' '}
                    should Cortex consider in responses?
                  </label>
                  <p className="settings-field-hint">
                    Your preferences will apply to all conversations, within{' '}
                    <a
                      href="https://cortex-al.vercel.app/usage-policy.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="settings-label-link"
                    >
                      Cortex's guidelines
                    </a>
                    .
                  </p>
                  <textarea
                    className="settings-textarea"
                    value={personalPrefs}
                    onChange={(e) => setPersonalPrefs(e.target.value)}
                    placeholder="e.g. I primarily code in Python (not a coding beginner)"
                    maxLength={2000}
                    rows={3}
                  />
                </div>
                <div className="settings-btn-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="settings-cancel-btn" onClick={handlePrefsCancel}>
                    Cancel
                  </button>
                  <button
                    className="settings-save-btn dark"
                    onClick={handlePrefsSave}
                    disabled={profileSaving}
                  >
                    {profileSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </div>

              <div className="settings-divider" />
              <div className="settings-section">
                <h2>Security</h2>
                {!showPassword ? (
                  <button className="settings-text-btn" onClick={() => setShowPassword(true)}>
                    Change password
                  </button>
                ) : (
                  <div className="settings-password-form">
                    <div className="settings-field">
                      <label>Current password</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                      />
                    </div>
                    <div className="settings-field">
                      <label>New password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                      />
                    </div>
                    <div className="settings-field">
                      <label>Confirm new password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                      />
                    </div>
                    {passwordError && <p className="settings-field-error">{passwordError}</p>}
                    <div className="settings-btn-row">
                      <button
                        className="settings-cancel-btn"
                        onClick={() => {
                          setShowPassword(false)
                          setCurrentPassword('')
                          setNewPassword('')
                          setConfirmPassword('')
                          setPasswordError('')
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="settings-save-btn"
                        onClick={handleChangePassword}
                        disabled={changingPassword || !currentPassword || !newPassword}
                      >
                        {changingPassword ? 'Changing...' : 'Change password'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-divider" />
              <div className="settings-section">
                <h2 className="settings-danger-heading">Delete account</h2>
                {!showDelete ? (
                  <button className="settings-text-btn danger" onClick={() => setShowDelete(true)}>
                    Delete my account
                  </button>
                ) : (
                  <div className="settings-delete-form">
                    <p className="settings-danger-text">
                      This will permanently delete your account and all your data. This action
                      cannot be undone.
                    </p>
                    <div className="settings-field">
                      <label>Enter your password to confirm</label>
                      <input
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="Your password"
                      />
                    </div>
                    {deleteError && <p className="settings-field-error">{deleteError}</p>}
                    <div className="settings-btn-row">
                      <button
                        className="settings-cancel-btn"
                        onClick={() => {
                          setShowDelete(false)
                          setDeletePassword('')
                          setDeleteError('')
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="settings-delete-btn"
                        onClick={handleDeleteAccount}
                        disabled={deleting || !deletePassword}
                      >
                        {deleting ? 'Deleting...' : 'Delete my account'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'usage' && (
            <div className="settings-section">
              <h2>Current session</h2>
              <p className="settings-field-hint" style={{ marginTop: '-0.25rem' }}>
                Usage resets every 5 hours from your first message in a session.
              </p>

              {(() => {
                const tokens = usageCurrent?.total_tokens || 0
                const percent = usagePercent(tokens)
                const state = usageBarState(percent)
                const hasBucket = !!(usageCurrent && usageCurrent.bucket_end)
                return (
                  <div className="usage-meter">
                    <div className="usage-meter-header">
                      <div className="usage-meter-label">
                        <strong>Session limit</strong>
                        <span className="usage-meter-reset">
                          {hasBucket
                            ? `Resets in ${formatResetTime(usageCurrent!.resets_in_seconds)}`
                            : 'Not started'}
                        </span>
                      </div>
                      <div className={`usage-meter-percent state-${state}`}>
                        {Math.min(100, Math.round(percent))}% used
                      </div>
                    </div>
                    <div className="usage-bar">
                      <div
                        className={`usage-bar-fill state-${state}`}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                    <div className="usage-meter-footer">
                      <span>
                        {formatNumber(tokens)} / {formatNumber(LIMIT_TOKENS)} tokens
                      </span>
                      <span className="usage-meter-note">Resets every 5 hours</span>
                    </div>
                  </div>
                )
              })()}

              <div className="usage-grid">
                <div className="usage-card">
                  <div className="usage-card-label">Messages</div>
                  <div className="usage-card-value">
                    {formatNumber(usageCurrent?.message_count || 0)}
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">Tokens</div>
                  <div className="usage-card-value">
                    {formatNumber(usageCurrent?.total_tokens || 0)}
                  </div>
                  <div className="usage-card-sub">
                    {formatNumber(usageCurrent?.input_tokens || 0)} in ·{' '}
                    {formatNumber(usageCurrent?.output_tokens || 0)} out
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">Artifacts</div>
                  <div className="usage-card-value">
                    {formatNumber(usageCurrent?.artifact_count || 0)}
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">Files</div>
                  <div className="usage-card-value">
                    {formatNumber(usageCurrent?.file_upload_count || 0)}
                  </div>
                </div>
              </div>

              <div className="settings-divider" />

              <h2>Last 30 days</h2>
              <p className="settings-field-hint" style={{ marginTop: '-0.25rem' }}>
                A rolling summary of your activity across all sessions.
              </p>
              <div className="usage-grid">
                <div className="usage-card">
                  <div className="usage-card-label">Messages</div>
                  <div className="usage-card-value">
                    {formatNumber(usageHistory?.message_count || 0)}
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">Tokens</div>
                  <div className="usage-card-value">
                    {formatNumber(usageHistory?.total_tokens || 0)}
                  </div>
                  <div className="usage-card-sub">
                    {formatNumber(usageHistory?.input_tokens || 0)} in ·{' '}
                    {formatNumber(usageHistory?.output_tokens || 0)} out
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">Artifacts</div>
                  <div className="usage-card-value">
                    {formatNumber(usageHistory?.artifact_count || 0)}
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">Files uploaded</div>
                  <div className="usage-card-value">
                    {formatNumber(usageHistory?.file_upload_count || 0)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="settings-section">
              <h2>Data Management</h2>
              <div className="settings-option">
                <div className="settings-option-info">
                  <h3>Auto-Delete Old Chats</h3>
                  <p>Automatically remove sessions after a set period</p>
                </div>
                <select
                  className="settings-select"
                  value={settings.auto_delete_days || 'never'}
                  onChange={(e) => {
                    const v = e.target.value === 'never' ? null : parseInt(e.target.value)
                    saveSettings({ auto_delete_days: v })
                  }}
                >
                  <option value="never">Never</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
              <div className="settings-action">
                <div className="settings-action-info">
                  <h3>Export Data</h3>
                  <p>Download all your chat sessions</p>
                </div>
                <button
                  className="settings-action-btn"
                  onClick={() => setExportModal({ open: true, format: 'json', loading: false })}
                >
                  Export
                </button>
              </div>
              <div className="settings-action danger">
                <div className="settings-action-info">
                  <h3>Clear All History</h3>
                  <p>Permanently delete all chat sessions</p>
                </div>
                <button
                  className="settings-action-btn danger"
                  onClick={() => setClearHistoryModal({ open: true, includePinned: false })}
                >
                  Clear All
                </button>
              </div>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="settings-section">
              <div className="about-brand">
                <img src="/IMG_6935.png" alt="" className="about-logo" />
                <h2 className="about-title">Cortex</h2>
              </div>
              <p className="about-desc">
                A clean, fast AI chat platform powered by Anthropic's Claude Sonnet 4.6. Designed to
                help students write, research, and build their thesis — simply, securely, and
                affordably.{' '}
                <a
                  href="https://cortex-al.vercel.app"
                  className="auth-learn-more"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn more &rarr;
                </a>
              </p>
              <div className="about-cards-stack">
                <div className="about-links-row">
                  <a
                    href="https://github.com/samueldervishii/cortex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-link-card"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                    </svg>
                    <div>
                      <strong>Source Code - v{FRONTEND_VERSION}</strong>
                      <span>View on GitHub</span>
                    </div>
                  </a>
                  <a
                    href="https://www.anthropic.com/news/claude-sonnet-4-6"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-link-card"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                    <div>
                      <strong>Powered by Anthropic</strong>
                      <span>Claude Sonnet 4.6</span>
                    </div>
                  </a>
                </div>
                <div className="about-links-row">
                  <Link to="/status" className="about-link-card">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 12h4l2-6 4 12 2-6h6" />
                    </svg>
                    <div>
                      <strong>Status page</strong>
                      <span>Check service health</span>
                    </div>
                  </Link>
                  <a
                    href="https://cortex-al.vercel.app/support.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-link-card"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div>
                      <strong>Support</strong>
                      <span>Open help center</span>
                    </div>
                  </a>
                </div>

                <div
                  className="about-link-card about-keyboard-shortcuts-card"
                  role="region"
                  aria-label="Keyboard shortcuts"
                >
                  <div className="about-keyboard-card-inner">
                    <strong>Keyboard shortcuts</strong>
                    <span>On macOS, use Cmd where you see Ctrl.</span>
                    <div className="about-shortcuts-grid">
                      {KEYBOARD_SHORTCUTS.map((s, i) => (
                        <div key={i} className="about-shortcut">
                          <span>{s.description}</span>
                          <span className="about-shortcut-keys">
                            {s.keys.map((key, j) => (
                              <span key={j}>
                                <kbd>{key}</kbd>
                                {j < s.keys.length - 1 && <span>+</span>}
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {clearHistoryModal.open && (
        <div
          className="modal-overlay"
          onClick={() => setClearHistoryModal({ open: false, includePinned: false })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Clear All History?</h3>
            <p>
              This will permanently delete all chat sessions.
              {!clearHistoryModal.includePinned && ' Pinned chats will be preserved.'}
            </p>
            <div className="modal-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={clearHistoryModal.includePinned}
                  onChange={(e) =>
                    setClearHistoryModal({ ...clearHistoryModal, includePinned: e.target.checked })
                  }
                />
                <span>Also delete pinned chats</span>
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setClearHistoryModal({ open: false, includePinned: false })}
              >
                Cancel
              </button>
              <button className="modal-btn danger" onClick={handleClearHistory}>
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {exportModal.open && (
        <div
          className="modal-overlay"
          onClick={() => setExportModal({ open: false, format: 'json', loading: false })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export All Data</h3>
            <p>Choose a format to download all your chat sessions</p>
            <div className="export-format-options">
              <label
                className={`export-format-option ${exportModal.format === 'json' ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="format"
                  value="json"
                  checked={exportModal.format === 'json'}
                  onChange={(e) => setExportModal({ ...exportModal, format: e.target.value })}
                />
                <div>
                  <strong>JSON</strong>
                  <small>Machine-readable, includes all data</small>
                </div>
              </label>
              <label
                className={`export-format-option ${exportModal.format === 'markdown' ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="format"
                  value="markdown"
                  checked={exportModal.format === 'markdown'}
                  onChange={(e) => setExportModal({ ...exportModal, format: e.target.value })}
                />
                <div>
                  <strong>Markdown</strong>
                  <small>Human-readable, easy to share</small>
                </div>
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setExportModal({ open: false, format: 'json', loading: false })}
                disabled={exportModal.loading}
              >
                Cancel
              </button>
              <button
                className="modal-btn primary"
                onClick={handleExport}
                disabled={exportModal.loading}
              >
                {exportModal.loading ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Settings
