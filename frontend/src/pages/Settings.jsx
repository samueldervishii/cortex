import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FRONTEND_VERSION, apiClient } from '../config/api'
import './Settings.css'

function Settings({ theme, onToggleTheme }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('general')

  const [settings, setSettings] = useState({ auto_delete_days: null })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaved, setSettingsSaved] = useState(false)

  const [clearHistoryModal, setClearHistoryModal] = useState({ open: false, includePinned: false })
  const [exportModal, setExportModal] = useState({ open: false, format: 'json', loading: false })

  useEffect(() => {
    loadSettings()
  }, [])

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

  const saveSettings = async (updates) => {
    try {
      const res = await apiClient.patch('/settings', updates)
      setSettings(res.data.settings)
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  const handleClearHistory = async () => {
    try {
      await apiClient.delete(
        `/sessions/all?confirm=true&include_pinned=${clearHistoryModal.includePinned}`
      )
      setClearHistoryModal({ open: false, includePinned: false })
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

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['general', 'data', 'about'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'data', label: 'Data' },
    { id: 'about', label: 'About' },
  ]

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p className="settings-subtitle">Customize your experience</p>
      </div>

      <div className="settings-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {activeTab === 'general' && (
          <div className="settings-section">
            <h2>Appearance</h2>
            <div className="settings-option">
              <div className="settings-option-info">
                <h3>Theme</h3>
                <p>Choose between light and dark mode</p>
              </div>
              <div className="settings-option-control">
                <button
                  className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => theme !== 'light' && onToggleTheme()}
                >
                  &#9788; Light
                </button>
                <button
                  className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => theme !== 'dark' && onToggleTheme()}
                >
                  &#9790; Dark
                </button>
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
          <div className="settings-section about-section">
            <div className="about-header">
              <h2>Cortex</h2>
              <p className="about-tagline">A clean AI chat experience powered by Claude Sonnet 4.6</p>
              <p className="about-meta">
                v{FRONTEND_VERSION}
                {' · '}
                <a href="https://github.com/samueldervishii/llm-council" target="_blank" rel="noopener noreferrer">GitHub</a>
              </p>
            </div>

            <div className="about-shortcuts">
              <h3>Keyboard Shortcuts</h3>
              <div className="shortcuts-list">
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>Ctrl</kbd> + <kbd>K</kbd>
                  </span>
                  <span className="shortcut-desc">Command palette</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>Alt</kbd> + <kbd>N</kbd>
                  </span>
                  <span className="shortcut-desc">New chat</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>Enter</kbd>
                  </span>
                  <span className="shortcut-desc">Send message</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>Shift</kbd> + <kbd>Enter</kbd>
                  </span>
                  <span className="shortcut-desc">New line</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {settingsSaved && (
        <div className="settings-toast">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Settings saved!
        </div>
      )}

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
