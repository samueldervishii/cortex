import { useState, useEffect, useCallback, useRef } from 'react'
import { XIcon as X } from '@phosphor-icons/react/X'
import { CopyIcon as Copy } from '@phosphor-icons/react/Copy'
import { CheckIcon as Check } from '@phosphor-icons/react/Check'
import { DownloadSimpleIcon as Download } from '@phosphor-icons/react/DownloadSimple'
import { FileTextIcon as FileText } from '@phosphor-icons/react/FileText'
import { CaretLeftIcon as ChevronLeft } from '@phosphor-icons/react/CaretLeft'
import { BookOpenIcon as BookOpen } from '@phosphor-icons/react/BookOpen'
import { MagnifyingGlassIcon as Search } from '@phosphor-icons/react/MagnifyingGlass'
import { LinkIcon as Link2 } from '@phosphor-icons/react/Link'
import { GlobeIcon as Globe } from '@phosphor-icons/react/Globe'
import { FileIcon as File } from '@phosphor-icons/react/File'
import { QuotesIcon as Quote } from '@phosphor-icons/react/Quotes'
import { CircleNotchIcon as Loader2 } from '@phosphor-icons/react/CircleNotch'
import { EyeIcon as Eye } from '@phosphor-icons/react/Eye'
import { ArrowLeftIcon as ArrowLeft } from '@phosphor-icons/react/ArrowLeft'
import { apiClient, API_BASE, getAccessToken } from '../config/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

// ─── Types ───

interface ArtifactData {
  id: string
  session_id: string
  message_index: number
  title: string
  content: string
  created_at: string | null
}

interface SourceData {
  id: string
  kind: 'file' | 'url'
  title: string
  url?: string | null
  domain?: string | null
  filename?: string | null
  content_type?: string | null
  size?: number | null
  author?: string | null
  publisher?: string | null
  published_at?: string | null
  created_at?: string | null
  chunk_count: number
}

interface SourcePreview {
  id: string
  kind: string
  title: string
  url?: string | null
  domain?: string | null
  filename?: string | null
  author?: string | null
  publisher?: string | null
  published_at?: string | null
  size?: number | null
  chunk_count: number
  created_at?: string | null
  text_preview: string
  text_length: number
}

interface QuoteResultData {
  text: string
  source_id: string
  source_title: string
  source_kind: string
  chunk_id: string
  page?: string | null
  score: number
}

interface ArtifactPanelProps {
  sessionId: string | null
  isOpen: boolean
  onClose: () => void
}

type PanelTab = 'artifacts' | 'sources' | 'research'

// ─── Component ───

function ArtifactPanel({ sessionId, isOpen, onClose }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('artifacts')

  // Artifacts state
  const [artifacts, setArtifacts] = useState<ArtifactData[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [artifactCopied, setArtifactCopied] = useState(false)
  const [artifactLoading, setArtifactLoading] = useState(false)

  // Sources state
  const [sources, setSources] = useState<SourceData[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')

  // Source preview state
  const [previewData, setPreviewData] = useState<SourcePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Citation state
  const [citationSourceId, setCitationSourceId] = useState<string | null>(null)
  const [citationStyle, setCitationStyle] = useState('apa')
  const [citationText, setCitationText] = useState('')
  const [citationCopied, setCitationCopied] = useState(false)
  const [generatingCitation, setGeneratingCitation] = useState(false)

  // Quote search state
  const [quoteQuery, setQuoteQuery] = useState('')
  const [quoteResults, setQuoteResults] = useState<QuoteResultData[]>([])
  const [searching, setSearching] = useState(false)
  const [searchExecuted, setSearchExecuted] = useState(false)
  const [quoteCopiedId, setQuoteCopiedId] = useState<string | null>(null)

  // Track session changes to reset stale state
  const prevSessionRef = useRef<string | null>(null)

  // ─── Reset stale state on session change ───
  useEffect(() => {
    if (sessionId !== prevSessionRef.current) {
      prevSessionRef.current = sessionId
      setCitationSourceId(null)
      setCitationText('')
      setQuoteQuery('')
      setQuoteResults([])
      setSearchExecuted(false)
      setPreviewData(null)
      setImportError('')
      setImportSuccess('')
      setImportUrl('')
      setSelectedArtifactId(null)
    }
  }, [sessionId])

  // ─── Fetch artifacts ───

  const fetchArtifacts = useCallback(async () => {
    if (!sessionId) {
      setArtifacts([])
      return
    }
    setArtifactLoading(true)
    try {
      const res = await apiClient.get(`/session/${sessionId}/artifacts`)
      setArtifacts(res.data.artifacts || [])
    } catch {
      setArtifacts([])
    } finally {
      setArtifactLoading(false)
    }
  }, [sessionId])

  // ─── Fetch sources ───

  const fetchSources = useCallback(async () => {
    if (!sessionId) {
      setSources([])
      return
    }
    setSourcesLoading(true)
    try {
      const res = await apiClient.get(`/session/${sessionId}/sources`)
      setSources(res.data.sources || [])
    } catch {
      setSources([])
    } finally {
      setSourcesLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (isOpen && sessionId) {
      fetchArtifacts()
      fetchSources()
    }
  }, [isOpen, sessionId, fetchArtifacts, fetchSources])

  // ─── Artifact actions ───

  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId) || null

  const handleArtifactCopy = async () => {
    if (!selectedArtifact) return
    try {
      await navigator.clipboard.writeText(selectedArtifact.content)
      setArtifactCopied(true)
      setTimeout(() => setArtifactCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const handleExportDocx = async () => {
    if (!selectedArtifact || !sessionId) return
    try {
      const token = getAccessToken()
      const res = await fetch(
        `${API_BASE}/session/${sessionId}/message/${selectedArtifact.message_index}/export-docx`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      )
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedArtifact.title.slice(0, 30).replace(/[^a-z0-9]/gi, '-') || 'artifact'}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }

  const handleExportMd = () => {
    if (!selectedArtifact) return
    const blob = new Blob([selectedArtifact.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedArtifact.title.slice(0, 30).replace(/[^a-z0-9]/gi, '-') || 'artifact'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Import URL ───

  const handleImport = async () => {
    if (!sessionId || !importUrl.trim()) return
    setImporting(true)
    setImportError('')
    setImportSuccess('')
    try {
      const res = await apiClient.post(`/session/${sessionId}/sources/import-url`, {
        url: importUrl.trim(),
      })
      setImportUrl('')
      setImportSuccess(res.data.message || 'Source imported')
      setTimeout(() => setImportSuccess(''), 3000)
      fetchSources()
    } catch (err: any) {
      setImportError(err?.response?.data?.detail || 'Failed to import URL')
    } finally {
      setImporting(false)
    }
  }

  // ─── Source preview ───

  const handlePreview = async (sourceId: string) => {
    if (!sessionId) return
    setPreviewLoading(true)
    setPreviewData(null)
    try {
      const res = await apiClient.get(`/session/${sessionId}/sources/${sourceId}/preview`)
      setPreviewData(res.data)
    } catch {
      setPreviewData(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  // ─── Citation ───

  const fetchCitation = async (sourceId: string, style: string) => {
    if (!sessionId) return
    setCitationSourceId(sourceId)
    setCitationText('')
    setCitationCopied(false)
    setGeneratingCitation(true)
    try {
      const res = await apiClient.post(`/session/${sessionId}/sources/citation`, {
        source_id: sourceId,
        style,
      })
      setCitationText(res.data.citation)
    } catch {
      setCitationText('Could not generate citation.')
    } finally {
      setGeneratingCitation(false)
    }
  }

  const handleGenerateCitation = (sourceId: string) => {
    fetchCitation(sourceId, citationStyle)
  }

  const handleStyleChange = (newStyle: string) => {
    setCitationStyle(newStyle)
    if (citationSourceId) {
      fetchCitation(citationSourceId, newStyle)
    }
  }

  const handleCitationCopy = async () => {
    try {
      await navigator.clipboard.writeText(citationText)
      setCitationCopied(true)
      setTimeout(() => setCitationCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  // ─── Quote search ───

  const handleQuoteSearch = async () => {
    if (!sessionId || !quoteQuery.trim()) return
    setSearching(true)
    setSearchExecuted(true)
    try {
      const res = await apiClient.post(`/session/${sessionId}/sources/quote-search`, {
        query: quoteQuery.trim(),
        max_results: 8,
      })
      setQuoteResults(res.data.results || [])
    } catch {
      setQuoteResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleQuoteCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setQuoteCopiedId(id)
      setTimeout(() => setQuoteCopiedId(null), 2000)
    } catch {
      /* ignore */
    }
  }

  // ─── Helpers ───

  const formatSize = (bytes?: number | null) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (!isOpen) return null

  // ─── Source preview view ───
  if (previewData) {
    return (
      <div className="right-panel">
        <div className="right-panel-header">
          <button className="rp-preview-back" onClick={() => setPreviewData(null)}>
            <ArrowLeft size={15} />
            Sources
          </button>
          <button className="right-panel-close" onClick={onClose} title="Close panel">
            <X size={16} />
          </button>
        </div>
        <div className="right-panel-body">
          <div className="rp-section">
            <div className="rp-preview-title">{previewData.title}</div>
            <div className="rp-preview-meta-grid">
              <div className="rp-preview-meta-item">
                <span className="rp-preview-meta-label">Type</span>
                <span className={`rp-source-badge ${previewData.kind}`}>{previewData.kind}</span>
              </div>
              {previewData.domain && (
                <div className="rp-preview-meta-item">
                  <span className="rp-preview-meta-label">Domain</span>
                  <span>{previewData.domain}</span>
                </div>
              )}
              {previewData.author && (
                <div className="rp-preview-meta-item">
                  <span className="rp-preview-meta-label">Author</span>
                  <span>{previewData.author}</span>
                </div>
              )}
              {previewData.publisher && (
                <div className="rp-preview-meta-item">
                  <span className="rp-preview-meta-label">Publisher</span>
                  <span>{previewData.publisher}</span>
                </div>
              )}
              {previewData.published_at && (
                <div className="rp-preview-meta-item">
                  <span className="rp-preview-meta-label">Published</span>
                  <span>{previewData.published_at.slice(0, 10)}</span>
                </div>
              )}
              <div className="rp-preview-meta-item">
                <span className="rp-preview-meta-label">Chunks</span>
                <span>{previewData.chunk_count}</span>
              </div>
              {previewData.size && (
                <div className="rp-preview-meta-item">
                  <span className="rp-preview-meta-label">Size</span>
                  <span>{formatSize(previewData.size)}</span>
                </div>
              )}
              <div className="rp-preview-meta-item">
                <span className="rp-preview-meta-label">Text length</span>
                <span>{previewData.text_length.toLocaleString()} chars</span>
              </div>
            </div>
          </div>
          <div className="rp-section">
            <div className="rp-section-label">Content Preview</div>
            <div className="rp-preview-text">{previewData.text_preview}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="right-panel">
      <div className="right-panel-header">
        <div className="right-panel-tab-strip">
          <button
            className={`right-panel-tab ${activeTab === 'artifacts' ? 'active' : ''}`}
            onClick={() => setActiveTab('artifacts')}
          >
            <FileText size={13} />
            Artifacts
          </button>
          <button
            className={`right-panel-tab ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            <BookOpen size={13} />
            Sources
          </button>
          <button
            className={`right-panel-tab ${activeTab === 'research' ? 'active' : ''}`}
            onClick={() => setActiveTab('research')}
          >
            <Search size={13} />
            Research
          </button>
        </div>
        <button className="right-panel-close" onClick={onClose} title="Close panel">
          <X size={16} />
        </button>
      </div>

      {/* ═══ Artifacts Tab ═══ */}
      {activeTab === 'artifacts' && (
        <div className="right-panel-body">
          {artifactLoading ? (
            <div className="right-panel-empty">Loading...</div>
          ) : !sessionId ? (
            <div className="right-panel-empty">
              <FileText size={20} className="right-panel-empty-icon" />
              <p>No active session</p>
              <p className="right-panel-hint">
                Start a conversation and generated artifacts will appear here.
              </p>
            </div>
          ) : artifacts.length === 0 ? (
            <div className="right-panel-empty">
              <FileText size={20} className="right-panel-empty-icon" />
              <p>No artifacts yet</p>
              <p className="right-panel-hint">
                Ask Cortex to write, draft, or generate a document and it will appear here.
              </p>
            </div>
          ) : !selectedArtifact ? (
            <div className="right-panel-list">
              {artifacts.map((a) => (
                <button
                  key={a.id}
                  className="right-panel-item"
                  onClick={() => setSelectedArtifactId(a.id)}
                >
                  <FileText size={14} />
                  <span>{a.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="right-panel-artifact">
              {artifacts.length > 1 && (
                <button className="right-panel-back" onClick={() => setSelectedArtifactId(null)}>
                  <ChevronLeft size={14} /> All artifacts
                </button>
              )}
              <div className="right-panel-artifact-title">{selectedArtifact.title}</div>
              <div className="right-panel-toolbar">
                <button onClick={handleArtifactCopy} title="Copy text">
                  {artifactCopied ? <Check size={14} /> : <Copy size={14} />}
                  {artifactCopied ? 'Copied' : 'Copy'}
                </button>
                <button onClick={handleExportDocx} title="Export as DOCX">
                  <Download size={14} /> DOCX
                </button>
                <button onClick={handleExportMd} title="Export as Markdown">
                  <Download size={14} /> MD
                </button>
              </div>
              <div className="right-panel-artifact-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {selectedArtifact.content}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Sources Tab ═══ */}
      {activeTab === 'sources' && (
        <div className="right-panel-body">
          {/* Import URL */}
          {sessionId && (
            <div className="rp-section">
              <div className="rp-section-label">Import Source</div>
              <div className="rp-import-row">
                <div className="rp-import-input-wrap">
                  <Link2 size={14} />
                  <input
                    type="text"
                    placeholder="Paste a URL..."
                    value={importUrl}
                    onChange={(e) => {
                      setImportUrl(e.target.value)
                      setImportError('')
                      setImportSuccess('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleImport()
                    }}
                    disabled={importing}
                  />
                </div>
                <button
                  className="rp-import-btn"
                  onClick={handleImport}
                  disabled={importing || !importUrl.trim()}
                >
                  {importing ? <Loader2 size={14} className="rp-spin" /> : 'Import'}
                </button>
              </div>
              {importError && <div className="rp-error">{importError}</div>}
              {importSuccess && <div className="rp-success">{importSuccess}</div>}
            </div>
          )}

          {/* Source list */}
          <div className="rp-section">
            <div className="rp-section-label">
              Source Library{' '}
              {sources.length > 0 && <span className="rp-count">{sources.length}</span>}
            </div>
            {sourcesLoading ? (
              <div className="right-panel-empty">Loading...</div>
            ) : sources.length === 0 ? (
              <div className="right-panel-empty">
                <BookOpen size={20} className="right-panel-empty-icon" />
                <p>No sources yet</p>
                <p className="right-panel-hint">
                  Upload a file in the chat or import a URL above to add research sources.
                </p>
              </div>
            ) : (
              <div className="rp-source-list">
                {sources.map((src) => (
                  <div key={src.id} className="rp-source-card">
                    <div className="rp-source-icon">
                      {src.kind === 'url' ? <Globe size={15} /> : <File size={15} />}
                    </div>
                    <div className="rp-source-info">
                      <div className="rp-source-title">{src.title}</div>
                      <div className="rp-source-meta">
                        <span className={`rp-source-badge ${src.kind}`}>{src.kind}</span>
                        {src.domain && <span>{src.domain}</span>}
                        {src.filename && !src.domain && (
                          <span>{src.filename.split('.').pop()?.toUpperCase()}</span>
                        )}
                        {src.size ? <span>{formatSize(src.size)}</span> : null}
                      </div>
                    </div>
                    <div className="rp-source-actions">
                      <button
                        className="rp-source-action-btn"
                        onClick={() => handlePreview(src.id)}
                        title="Preview source"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className="rp-source-action-btn"
                        onClick={() => handleGenerateCitation(src.id)}
                        title="Generate citation"
                      >
                        <Quote size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Citation output */}
          {citationSourceId && (
            <div className="rp-section">
              <div className="rp-section-label">Citation</div>
              <div className="rp-citation-styles">
                {(['apa', 'mla', 'chicago'] as const).map((s) => (
                  <button
                    key={s}
                    className={`rp-style-btn ${citationStyle === s ? 'active' : ''}`}
                    onClick={() => handleStyleChange(s)}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              {generatingCitation ? (
                <div className="rp-citation-loading">
                  <Loader2 size={14} className="rp-spin" /> Generating...
                </div>
              ) : citationText ? (
                <div className="rp-citation-output">
                  <p>{citationText}</p>
                  <button className="rp-citation-copy" onClick={handleCitationCopy}>
                    {citationCopied ? <Check size={13} /> : <Copy size={13} />}
                    {citationCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ═══ Research Tab ═══ */}
      {activeTab === 'research' && (
        <div className="right-panel-body">
          <div className="rp-section">
            <div className="rp-section-label">Find Quotes</div>
            <p className="rp-section-desc">
              Search across your session sources for supporting passages.
            </p>
            <div className="rp-search-row">
              <div className="rp-search-input-wrap">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="e.g. privacy concerns, evidence for..."
                  value={quoteQuery}
                  onChange={(e) => setQuoteQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuoteSearch()
                  }}
                  disabled={searching}
                />
              </div>
              <button
                className="rp-search-btn"
                onClick={handleQuoteSearch}
                disabled={searching || !quoteQuery.trim() || !sessionId}
              >
                {searching ? <Loader2 size={14} className="rp-spin" /> : 'Search'}
              </button>
            </div>
          </div>

          {/* Results */}
          {quoteResults.length > 0 && (
            <div className="rp-section">
              <div className="rp-section-label">
                Results <span className="rp-count">{quoteResults.length}</span>
              </div>
              <div className="rp-quote-list">
                {quoteResults.map((q, idx) => (
                  <div key={`${q.source_id}-${q.chunk_id}-${idx}`} className="rp-quote-card">
                    <div className="rp-quote-text">{q.text}</div>
                    <div className="rp-quote-footer">
                      <span className="rp-quote-source">
                        {q.source_kind === 'url' ? <Globe size={11} /> : <File size={11} />}
                        {q.source_title}
                        {q.page && ` — p.${q.page}`}
                      </span>
                      <button
                        className="rp-quote-copy"
                        onClick={() => handleQuoteCopy(q.text, `${q.chunk_id}-${idx}`)}
                      >
                        {quoteCopiedId === `${q.chunk_id}-${idx}` ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {quoteResults.length === 0 && searchExecuted && !searching && (
            <div className="right-panel-empty">
              <Search size={20} className="right-panel-empty-icon" />
              <p>No matching quotes found</p>
              <p className="right-panel-hint">Try different search terms or add more sources.</p>
            </div>
          )}

          {!searchExecuted && !searching && (
            <div className="right-panel-empty">
              <Search size={20} className="right-panel-empty-icon" />
              <p>Search your sources</p>
              <p className="right-panel-hint">
                Enter a topic or phrase above to find exact supporting passages from your uploaded
                files and imported URLs.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ArtifactPanel
