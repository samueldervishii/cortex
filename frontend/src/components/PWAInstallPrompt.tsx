import { useState, useEffect } from 'react'
import { DownloadSimpleIcon as DownloadSimple } from '@phosphor-icons/react/DownloadSimple'
import { XIcon as X } from '@phosphor-icons/react/X'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    const dismissed = localStorage.getItem('pwa-install-dismissed')
    if (dismissed) {
      const dismissedTime = new Date(dismissed).getTime()
      const now = new Date().getTime()
      const daysSinceDismissed = (now - dismissedTime) / (1000 * 60 * 60 * 24)
      if (daysSinceDismissed < 7) {
        return
      }
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setTimeout(() => setShowPrompt(true), 2000)
    }

    const handleAppInstalled = () => {
      setIsInstalled(true)
      setShowPrompt(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShowPrompt(false)
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShowPrompt(false)
    localStorage.setItem('pwa-install-dismissed', new Date().toISOString())
  }

  if (isInstalled || !showPrompt) return null

  return (
    <div className="pwa-install-prompt">
      <div className="pwa-install-content">
        <DownloadSimple size={20} />
        <div className="pwa-install-text">
          <strong>Install Cortex</strong>
          <span>Add to your home screen for quick access</span>
        </div>
      </div>
      <div className="pwa-install-actions">
        <button className="pwa-install-btn" onClick={handleInstall}>
          Install
        </button>
        <button className="pwa-dismiss-btn" onClick={handleDismiss} aria-label="Dismiss">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
