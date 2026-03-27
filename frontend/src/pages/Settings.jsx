import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FRONTEND_VERSION, apiClient } from '../config/api'
import './Settings.css'

function Settings({
  theme,
  onToggleTheme,
  mode,
  onModeChange,
  availableModels,
  selectedModels,
  onToggleModel,
  onSelectAllModels,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('general')

  // Backend settings state
  const [settings, setSettings] = useState({
    auto_delete_days: null,
    enabled_beta_features: [],
    branching_enabled: true,
    custom_prompts_enabled: true,
  })
  const [availableBetaFeatures, setAvailableBetaFeatures] = useState([])
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Confirmation modals
  const [clearHistoryModal, setClearHistoryModal] = useState({ open: false, includePinned: false })
  const [exportModal, setExportModal] = useState({ open: false, format: 'json', loading: false })

  // Load settings and available beta features from backend
  useEffect(() => {
    loadSettings()
    loadBetaFeatures()
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

  const loadBetaFeatures = async () => {
    try {
      const res = await apiClient.get('/settings/beta-features')
      setAvailableBetaFeatures(res.data)
    } catch (error) {
      console.error('Failed to load beta features:', error)
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
      alert('Failed to save settings. Please try again.')
    }
  }

  const toggleBetaFeature = (featureId) => {
    const currentFeatures = settings.enabled_beta_features || []
    const isEnabled = currentFeatures.includes(featureId)
    const newFeatures = isEnabled
      ? currentFeatures.filter((id) => id !== featureId)
      : [...currentFeatures, featureId]
    saveSettings({ enabled_beta_features: newFeatures })
  }

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam && ['general', 'models', 'data', 'advanced', 'about'].includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  // Update URL when tab changes
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  const allSelected =
    availableModels.length > 0 && availableModels.every((m) => selectedModels.includes(m.id))

  // Clear all history handler
  const handleClearHistory = async () => {
    try {
      const res = await apiClient.delete('/sessions/all', {
        params: {
          confirm: true,
          include_pinned: clearHistoryModal.includePinned,
        },
      })
      alert(res.data.message)
      setClearHistoryModal({ open: false, includePinned: false })
    } catch (error) {
      console.error('Failed to clear history:', error)
      alert('Failed to clear history. Please try again.')
    }
  }

  // Export data handler
  const handleExport = async () => {
    try {
      setExportModal({ ...exportModal, loading: true })
      const response = await apiClient.get('/sessions/export', {
        params: { format: exportModal.format },
        responseType: 'blob',
      })

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const extension = exportModal.format === 'markdown' ? 'md' : 'json'
      link.setAttribute('download', `llm_council_export_${Date.now()}.${extension}`)
      document.body.appendChild(link)
      link.click()
      link.remove()

      setExportModal({ open: false, format: 'json', loading: false })
    } catch (error) {
      console.error('Failed to export data:', error)
      alert('Failed to export data. Please try again.')
      setExportModal({ ...exportModal, loading: false })
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p className="settings-subtitle">Customize your LLM Council experience</p>
      </div>

      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => handleTabChange('general')}
        >
          General
        </button>
        <button
          className={`settings-tab ${activeTab === 'models' ? 'active' : ''}`}
          onClick={() => handleTabChange('models')}
        >
          Models
        </button>
        <button
          className={`settings-tab ${activeTab === 'data' ? 'active' : ''}`}
          onClick={() => handleTabChange('data')}
        >
          Data
        </button>
        <button
          className={`settings-tab ${activeTab === 'advanced' ? 'active' : ''}`}
          onClick={() => handleTabChange('advanced')}
        >
          Advanced
        </button>
        <button
          className={`settings-tab ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => handleTabChange('about')}
        >
          About
        </button>
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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                  Light
                </button>
                <button
                  className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => theme !== 'dark' && onToggleTheme()}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                  Dark
                </button>
              </div>
            </div>

            <h2>Council Mode</h2>
            <div className="settings-option">
              <div className="settings-option-info">
                <h3>Default Mode</h3>
                <p>Choose how the AI models interact</p>
              </div>
              <div className="settings-option-control mode-options">
                <button
                  className={`mode-option ${mode === 'formal' ? 'active' : ''}`}
                  onClick={() => onModeChange('formal')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 14l2 2 4-4" />
                  </svg>
                  <div className="mode-option-text">
                    <span>Formal Council</span>
                    <small>Structured debate with voting</small>
                  </div>
                </button>
                <button
                  className={`mode-option ${mode === 'chat' ? 'active' : ''}`}
                  onClick={() => onModeChange('chat')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <div className="mode-option-text">
                    <span>Group Chat</span>
                    <small>Free-flowing conversation</small>
                  </div>
                </button>
                {settings.enabled_beta_features?.includes('eli5_ladder') && (
                  <button
                    className={`mode-option ${mode === 'eli5_ladder' ? 'active' : ''}`}
                    onClick={() => onModeChange('eli5_ladder')}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="4" y1="21" x2="4" y2="14" />
                      <line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" />
                      <line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" />
                      <line x1="9" y1="8" x2="15" y2="8" />
                      <line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                    <div className="mode-option-text">
                      <span>ELI5 Ladder</span>
                      <small>3 complexity levels</small>
                    </div>
                  </button>
                )}
              </div>
            </div>

            <h2>Features</h2>
            <div className="settings-option">
              <div className="settings-option-info">
                <h3>
                  Conversation Branching <span className="new-badge">New</span>
                </h3>
                <p>
                  Create branches from any point in a conversation to explore different directions
                </p>
              </div>
              <div className="settings-option-control">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.branching_enabled !== false}
                    onChange={() =>
                      saveSettings({ branching_enabled: !settings.branching_enabled })
                    }
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div className="settings-option">
              <div className="settings-option-info">
                <h3>
                  Custom System Prompts <span className="new-badge">New</span>
                </h3>
                <p>
                  Define custom instructions and model personas to control how council members
                  respond
                </p>
              </div>
              <div className="settings-option-control">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.custom_prompts_enabled !== false}
                    onChange={() =>
                      saveSettings({ custom_prompts_enabled: !settings.custom_prompts_enabled })
                    }
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'models' && (
          <div className="settings-section">
            <div className="section-header">
              <div>
                <h2>Models</h2>
                <p className="section-description">
                  Select which models participate in discussions
                </p>
              </div>
              <button className="select-all-btn" onClick={onSelectAllModels}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="models-table-container">
              <table className="models-table">
                <thead>
                  <tr>
                    <th>Model Name</th>
                    <th>Role</th>
                    <th>Enable</th>
                  </tr>
                </thead>
                <tbody>
                  {availableModels.map((model) => (
                    <tr
                      key={model.id}
                      className={selectedModels.includes(model.id) ? 'selected' : ''}
                    >
                      <td className="model-name-cell">{model.name}</td>
                      <td className="model-role-cell">
                        {model.is_chairman ? (
                          <span className="chairman-badge">Head</span>
                        ) : (
                          <span className="member-text">Member</span>
                        )}
                      </td>
                      <td className="model-toggle-cell">
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={selectedModels.includes(model.id)}
                            onChange={() => onToggleModel(model.id)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {settings.custom_prompts_enabled !== false && (
              <>
                <h2>
                  Model Personas <span className="new-badge">New</span>
                </h2>
                <p className="section-description">
                  Give each model a unique personality or role. These instructions are added to each
                  model's system prompt.
                </p>
                <div className="personas-list">
                  {availableModels.map((model) => (
                    <div key={model.id} className="persona-item">
                      <div className="persona-header">
                        <span className="persona-model-name">{model.name}</span>
                        {model.is_chairman && <span className="chairman-badge">Head</span>}
                        {(settings.model_personas?.[model.id] || '').trim() && (
                          <span className="persona-active-badge">Active</span>
                        )}
                      </div>
                      <textarea
                        className="persona-textarea"
                        value={settings.model_personas?.[model.id] || ''}
                        onChange={(e) => {
                          const newPersonas = {
                            ...(settings.model_personas || {}),
                            [model.id]: e.target.value,
                          }
                          // Remove empty entries
                          Object.keys(newPersonas).forEach((k) => {
                            if (!newPersonas[k].trim()) delete newPersonas[k]
                          })
                          saveSettings({ model_personas: newPersonas })
                        }}
                        placeholder={`e.g., "You are a skeptic who questions everything" or "Always use analogies to explain"`}
                        rows={2}
                        maxLength={500}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'data' && (
          <div className="settings-section">
            <h2>Data & Privacy</h2>

            <div className="settings-option">
              <div className="settings-option-info">
                <h3>Auto-delete Old Chats</h3>
                <p>
                  Automatically delete inactive chat sessions after a certain period. Pinned chats
                  and recently-active sessions are always preserved.
                </p>
              </div>
              <div className="settings-option-control">
                <select
                  value={settings.auto_delete_days || 'never'}
                  className="settings-select"
                  onChange={(e) => {
                    const value = e.target.value === 'never' ? null : parseInt(e.target.value)
                    saveSettings({ auto_delete_days: value })
                  }}
                >
                  <option value="never">Never</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
            </div>

            <h2>Data Management</h2>

            <div className="settings-action">
              <div className="settings-action-info">
                <h3>Export All Data</h3>
                <p>Download all your chat sessions and conversations</p>
              </div>
              <button
                className="settings-action-btn"
                onClick={() => setExportModal({ open: true, format: 'json', loading: false })}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export Data
              </button>
            </div>

            <div className="settings-action danger">
              <div className="settings-action-info">
                <h3>Clear All History</h3>
                <p>Permanently delete all chat sessions (pinned chats preserved by default)</p>
              </div>
              <button
                className="settings-action-btn danger"
                onClick={() => setClearHistoryModal({ open: true, includePinned: false })}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Clear All History
              </button>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="settings-section">
            <h2>Beta Features</h2>
            <p className="section-description">
              Opt into specific experimental features. Each feature can be enabled independently.
            </p>

            {availableBetaFeatures.length === 0 ? (
              <p className="no-beta-features">Loading beta features...</p>
            ) : (
              availableBetaFeatures.map((feature) => {
                const isEnabled = settings.enabled_beta_features?.includes(feature.id) || false
                const isComingSoon = feature.status === 'coming_soon'
                const isAvailable = feature.status === 'available'

                return (
                  <div
                    key={feature.id}
                    className={`settings-option ${isComingSoon ? 'disabled' : ''}`}
                  >
                    <div className="settings-option-info">
                      <h3>
                        {feature.name}
                        {isComingSoon && <span className="coming-soon-badge">Coming Soon</span>}
                        {feature.status === 'deprecated' && (
                          <span className="deprecated-badge">Deprecated</span>
                        )}
                      </h3>
                      <p>{feature.description}</p>
                    </div>
                    <div className="settings-option-control">
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          disabled={isComingSoon}
                          onChange={() => toggleBetaFeature(feature.id)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {activeTab === 'about' && (
          <div className="settings-section about-section">
            <div className="about-logo">
              <h2>LLM Council</h2>
            </div>
            <p className="about-version">Version {FRONTEND_VERSION}</p>
            <p className="about-description">
              A platform for orchestrating discussions between multiple AI models, allowing them to
              debate, collaborate, and reach consensus on complex questions.
            </p>

            <div className="about-links">
              <a
                href="https://github.com/samueldervishii/llm-council"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </a>
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
                    <kbd>Ctrl</kbd> + <kbd>/</kbd>
                  </span>
                  <span className="shortcut-desc">Command palette (alt)</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>Alt</kbd> + <kbd>N</kbd>
                  </span>
                  <span className="shortcut-desc">New chat</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
                  </span>
                  <span className="shortcut-desc">Send message</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Settings Saved Toast */}
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

      {/* Clear History Confirmation Modal */}
      {clearHistoryModal.open && (
        <div
          className="modal-overlay"
          onClick={() => setClearHistoryModal({ open: false, includePinned: false })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon danger">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
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

      {/* Export Data Modal */}
      {exportModal.open && (
        <div
          className="modal-overlay"
          onClick={() => setExportModal({ open: false, format: 'json', loading: false })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
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
                  <small>Machine-readable format, includes all data</small>
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
                  <small>Human-readable format, easy to read and share</small>
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
