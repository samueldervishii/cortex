import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import useTitle from '../hooks/useTitle'
import { useToast } from '../contexts/ToastContext'
import { FRONTEND_VERSION, apiClient } from '../config/api'
import './Settings.css'

interface SettingsData {
  auto_delete_days: number | null
}

function Settings() {
  useTitle('Settings')
  const { user, updateProfile, regenerateAvatar, changePassword, deleteAccount } = useAuth() as any
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('general')

  // Settings state
  const [settings, setSettings] = useState<SettingsData>({ auto_delete_days: null })
  const [settingsLoading, setSettingsLoading] = useState(true)

  // Profile state
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [fieldOfWork, setFieldOfWork] = useState('')
  const [personalPrefs, setPersonalPrefs] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [regenerating, setRegenerating] = useState(false)

  // Password state
  const [showPassword, setShowPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  // Delete account state
  const [showDelete, setShowDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Modals
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
    if (tab && ['general', 'data', 'about'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const loadSettings = async () => {
    try {
      setSettingsLoading(true)
      const res = await apiClient.get('/settings')
      setSettings(res.data.settings)
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveSettings = async (updates: Partial<SettingsData>) => {
    try {
      const res = await apiClient.patch('/settings', updates)
      setSettings(res.data.settings)
      showToast('Settings saved')
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  const handleProfileSave = async () => {
    setProfileSaving(true)
    setProfileError('')
    try {
      await updateProfile({
        display_name: displayName.trim(),
        username: username.trim(),
        field_of_work: fieldOfWork,
        personal_preferences: personalPrefs,
      })
      showToast('Profile updated')
    } catch (err: any) {
      const msg = err?.response?.data?.detail
      setProfileError(msg || 'Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleProfileCancel = () => {
    if (user) {
      setDisplayName(user.display_name || '')
      setUsername(user.username || '')
      setFieldOfWork(user.field_of_work || '')
      setPersonalPrefs(user.personal_preferences || '')
      setProfileError('')
    }
  }

  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      await regenerateAvatar()
    } catch {
      // silently fail
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
      const msg = err?.response?.data?.detail
      setPasswordError(msg || 'Failed to change password')
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
      const msg = err?.response?.data?.detail
      setDeleteError(msg || 'Failed to delete account')
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
    } catch (error) {
      console.error('Failed to clear history:', error)
    }
  }

  const handleExport = async () => {
    try {
      setExportModal((prev) => ({ ...prev, loading: true }))
      const res = await apiClient.get(`/sessions/export?format=${exportModal.format}`, {
        responseType: 'blob',
      })
      const blob = new Blob([res.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = exportModal.format === 'json' ? 'json' : 'md'
      a.download = `chat_export.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportModal({ open: false, format: 'json', loading: false })
    } catch (error) {
      console.error('Failed to export:', error)
      setExportModal((prev) => ({ ...prev, loading: false }))
    }
  }

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  const WORK_OPTIONS = [
    '',
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
    { id: 'general', label: 'General' },
    { id: 'data', label: 'Data' },
    { id: 'about', label: 'About' },
  ]

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

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
              {/* Profile */}
              <div className="settings-section">
                <h2>Profile</h2>

                <div className="settings-field-row">
                  <div className="settings-field" style={{ flex: 2 }}>
                    <label>Full name</label>
                    <div className="settings-avatar-input-row">
                      <button
                        className="settings-avatar-btn"
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        title="Generate new avatar"
                      >
                        {user?.avatar ? (
                          <img src={user.avatar} alt="" className="settings-avatar-img" />
                        ) : (
                          <span className="settings-avatar-fallback">?</span>
                        )}
                        <span className="settings-avatar-overlay">
                          <svg
                            width="16"
                            height="16"
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
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        maxLength={100}
                      />
                    </div>
                  </div>
                  <div className="settings-field" style={{ flex: 1 }}>
                    <label>What should Cortex call you?</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="username"
                      maxLength={50}
                    />
                  </div>
                </div>

                <div className="settings-field">
                  <label>What best describes your work?</label>
                  <select
                    className="settings-select full-width"
                    value={fieldOfWork}
                    onChange={(e) => setFieldOfWork(e.target.value)}
                  >
                    <option value="">Select...</option>
                    {WORK_OPTIONS.filter(Boolean).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field">
                  <label>
                    What{' '}
                    <a href="https://cortex-al.vercel.app/personalization.html" target="_blank" rel="noopener noreferrer" className="settings-label-link">
                      personal preferences
                    </a>{' '}
                    should Cortex consider in responses?
                  </label>
                  <p className="settings-field-hint">
                    Your preferences will apply to all conversations, within{' '}
                    <a href="https://cortex-al.vercel.app/usage-policy.html" target="_blank" rel="noopener noreferrer" className="settings-label-link">
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

                {profileError && <p className="settings-field-error">{profileError}</p>}

                <div className="settings-btn-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="settings-cancel-btn" onClick={handleProfileCancel}>
                    Cancel
                  </button>
                  <button
                    className="settings-save-btn dark"
                    onClick={handleProfileSave}
                    disabled={profileSaving}
                  >
                    {profileSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </div>

              <div className="settings-divider" />

              {/* Password */}
              <div className="settings-section">
                <h2>Password</h2>
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

              {/* Delete Account */}
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
                    const val = e.target.value === 'never' ? null : parseInt(e.target.value)
                    saveSettings({ auto_delete_days: val })
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
                <img src="/logo.svg" alt="" className="about-logo" />
                <h2 className="about-title">Cortex</h2>
                <span className="about-version">v{FRONTEND_VERSION}</span>
              </div>

              <p className="about-desc">
                A clean, fast AI chat platform powered by Anthropic's Claude Sonnet 4.6. Designed to
                help students write, research, and build their thesis — simply, securely, and
                affordably.
              </p>

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
                    <strong>Source Code</strong>
                    <span>View on GitHub</span>
                  </div>
                </a>
                <a
                  href="https://anthropic.com"
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

              <div className="about-shortcuts-section">
                <h3>Keyboard Shortcuts</h3>
                <div className="about-shortcuts-grid">
                  <div className="about-shortcut">
                    <span className="about-shortcut-keys">
                      <kbd>Ctrl</kbd>
                      <span>+</span>
                      <kbd>K</kbd>
                    </span>
                    <span>Command palette</span>
                  </div>
                  <div className="about-shortcut">
                    <span className="about-shortcut-keys">
                      <kbd>Alt</kbd>
                      <span>+</span>
                      <kbd>N</kbd>
                    </span>
                    <span>New chat</span>
                  </div>
                  <div className="about-shortcut">
                    <span className="about-shortcut-keys">
                      <kbd>Enter</kbd>
                    </span>
                    <span>Send message</span>
                  </div>
                  <div className="about-shortcut">
                    <span className="about-shortcut-keys">
                      <kbd>Shift</kbd>
                      <span>+</span>
                      <kbd>Enter</kbd>
                    </span>
                    <span>New line</span>
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
