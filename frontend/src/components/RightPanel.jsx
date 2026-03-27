const LANGUAGES = [
  { code: 'Spanish', label: 'Spanish', flag: '🇪🇸' },
  { code: 'French', label: 'French', flag: '🇫🇷' },
  { code: 'German', label: 'German', flag: '🇩🇪' },
  { code: 'Portuguese', label: 'Portuguese', flag: '🇧🇷' },
  { code: 'Italian', label: 'Italian', flag: '🇮🇹' },
  { code: 'Japanese', label: 'Japanese', flag: '🇯🇵' },
  { code: 'Chinese', label: 'Chinese', flag: '🇨🇳' },
  { code: 'Arabic', label: 'Arabic', flag: '🇸🇦' },
  { code: 'Hindi', label: 'Hindi', flag: '🇮🇳' },
  { code: 'Korean', label: 'Korean', flag: '🇰🇷' },
  { code: 'Russian', label: 'Russian', flag: '🇷🇺' },
]

function RightPanel({
  isOpen,
  onClose,
  systemPrompt,
  onSystemPromptChange,
  selectedLanguage,
  onLanguageChange,
  customPromptsEnabled = false,
  multiLanguageEnabled = false,
}) {
  if (!isOpen) return null

  return (
    <>
      <div className="right-panel-overlay" onClick={onClose} />
      <div className="right-panel">
        <div className="right-panel-header">
          <h2>Session Context</h2>
          <button className="right-panel-close" onClick={onClose} title="Close">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="right-panel-body">
          {customPromptsEnabled && (
            <div className="right-panel-section">
              <label className="right-panel-label">
                System Prompt
                {systemPrompt?.trim() && <span className="right-panel-active-badge">Active</span>}
              </label>
              <p className="right-panel-hint">
                Custom instructions applied to all council members for new chats.
              </p>
              <textarea
                className="right-panel-textarea"
                value={systemPrompt || ''}
                onChange={(e) => onSystemPromptChange(e.target.value)}
                placeholder="e.g. Respond in Spanish, you are a senior engineer, always provide code examples..."
                rows={6}
                maxLength={2000}
              />
              <div className="right-panel-char-count">{(systemPrompt || '').length} / 2000</div>
            </div>
          )}

          {multiLanguageEnabled && (
            <div className="right-panel-section">
              <label className="right-panel-label">
                Response Language
                {selectedLanguage && <span className="right-panel-active-badge">Active</span>}
              </label>
              <p className="right-panel-hint">
                Applied to new chats. Existing sessions keep their original language.
              </p>
              <div className="language-pills">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    className={`language-pill ${selectedLanguage === lang.code ? 'selected' : ''}`}
                    onClick={() =>
                      onLanguageChange(selectedLanguage === lang.code ? '' : lang.code)
                    }
                    type="button"
                  >
                    <span className="language-pill-flag">{lang.flag}</span>
                    {lang.label}
                  </button>
                ))}
              </div>
              {selectedLanguage && (
                <button
                  className="language-clear-btn"
                  onClick={() => onLanguageChange('')}
                  type="button"
                >
                  Clear — use default language
                </button>
              )}
            </div>
          )}

          {!customPromptsEnabled && !multiLanguageEnabled && (
            <div className="right-panel-empty">
              <p>No context options available.</p>
              <p>Enable Custom Prompts or Multi-Language in Settings &rarr; Advanced.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default RightPanel
