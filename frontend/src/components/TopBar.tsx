import { Link, useLocation } from 'react-router-dom'
import { GhostIcon as Ghost } from '@phosphor-icons/react/Ghost'
import { NotePencilIcon as NotePencil } from '@phosphor-icons/react/NotePencil'
import { SidebarIcon as Sidebar } from '@phosphor-icons/react/Sidebar'
import { ListIcon as List } from '@phosphor-icons/react/List'
import { ShareNetworkIcon as ShareNetwork } from '@phosphor-icons/react/ShareNetwork'
import ModelSelector, { useSelectedModel } from './ModelSelector'

interface TopBarProps {
  onNewChat: () => void
  onToggleSidebar?: () => void
  onToggleRightPanel?: () => void
  rightPanelOpen?: boolean
  hasSession?: boolean
  sessionTitle?: string
  messageCount?: number
  ghostMode?: boolean
  onToggleGhost?: () => void
  onShare?: () => void
}

function TopBar({
  onNewChat,
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelOpen,
  hasSession,
  sessionTitle,
  messageCount = 0,
  ghostMode,
  onToggleGhost,
  onShare,
}: TopBarProps) {
  const { pathname } = useLocation()
  const selectedModel = useSelectedModel()
  // Model can only be picked on the home/root route, before a session exists.
  // On session pages, settings, etc. we lock to whatever model is in use and
  // show it as a static pill (no dropdown).
  const isHomeRoute = pathname === '/' || pathname === '/home'
  const canChooseModel = isHomeRoute && !hasSession && !ghostMode
  const showLockedModelPill = !ghostMode && !canChooseModel && hasSession

  return (
    <div className={`top-bar ${ghostMode ? 'ghost-mode' : ''}`}>
      <div className="top-bar-left">
        {onToggleSidebar && (
          <button
            className="menu-btn top-bar-mobile-only"
            onClick={onToggleSidebar}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <List size={18} weight="regular" />
          </button>
        )}
        {hasSession && (
          <button
            className="menu-btn top-bar-new-chat"
            onClick={onNewChat}
            title="New chat"
            aria-label="Start a new chat"
          >
            <NotePencil size={18} weight="regular" />
          </button>
        )}
      </div>

      <div className="top-bar-right">
        {canChooseModel && <ModelSelector variant="topbar" />}
        {showLockedModelPill && (
          <div
            className="top-bar-model-locked"
            title={`This chat is using ${selectedModel.name}. Start a new chat to switch models.`}
            aria-label={`Model in use: ${selectedModel.name}`}
          >
            <img className="model-selector-img" src={selectedModel.icon} alt="" />
            <span className="model-selector-name">{selectedModel.name}</span>
          </div>
        )}

        {hasSession && onShare && (
          <button
            type="button"
            className="top-bar-share-btn"
            onClick={onShare}
            title="Share this chat"
          >
            <ShareNetwork size={14} weight="regular" />
            <span>Share</span>
          </button>
        )}

        {/* {onToggleGhost && (
          <button
            className={`top-bar-icon-btn ${ghostMode ? 'active' : ''}`}
            onClick={onToggleGhost}
            title={ghostMode ? 'Exit temporary chat' : 'Start temporary chat'}
            aria-pressed={ghostMode}
          >
            <Ghost size={16} weight={ghostMode ? 'fill' : 'regular'} />
          </button>
        )} */}
        {onToggleRightPanel && (
          <button
            className={`top-bar-icon-btn ${rightPanelOpen ? 'active' : ''}`}
            onClick={onToggleRightPanel}
            title="Context panel"
          >
            <Sidebar size={16} weight="regular" mirrored />
          </button>
        )}
      </div>
    </div>
  )
}

export default TopBar
