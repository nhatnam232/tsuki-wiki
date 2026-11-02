import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useLangContext } from '@/providers/LangProvider'
import { isBotEnvironment } from '@/lib/bot'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'anm-pwa-install-dismissed'
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14 // 14 days

/**
 * Mounts the service-worker AND captures the deferred `beforeinstallprompt`
 * event so we can render a friendly "Install Anime Wiki" toast.
 *
 * Honors a 14-day dismissal cookie so we don't pester users.
 */
export default function PWAInstaller() {
  const { lang } = useLangContext()
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  // ── Register service worker ──
  useEffect(() => {
    if (isBotEnvironment()) return
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    if (import.meta.env.DEV) return // never run in dev — Vite HMR conflicts

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.warn('SW registration failed', err))
    }
    window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  // ── Capture install prompt ──
  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      // Don't show again if dismissed recently
      try {
        const raw = localStorage.getItem(DISMISS_KEY)
        if (raw) {
          const ts = Number(raw)
          if (ts && Date.now() - ts < DISMISS_TTL_MS) return
        }
      } catch { /* storage blocked */ }
      setDeferredPrompt(e as InstallPromptEvent)
    }
    const onAppInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall as EventListener)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall as EventListener)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  if (!deferredPrompt || installed) return null

  const handleInstall = async () => {
    try {
      await deferredPrompt.prompt()
      const result = await deferredPrompt.userChoice
      if (result.outcome === 'dismissed') {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* storage blocked */ }
      }
      setDeferredPrompt(null)
    } catch (e) {
      console.warn('PWA install prompt failed', e)
    }
  }

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* storage blocked */ }
    setDeferredPrompt(null)
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur md:bottom-6 md:right-6 md:left-auto md:w-96">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-hover text-white">
        <Download className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">
          {lang === 'vi' ? 'Cài Anime Wiki vào điện thoại' : 'Install Anime Wiki'}
        </p>
        <p className="truncate text-xs text-text-muted">
          {lang === 'vi'
            ? 'Mượt hơn, có icon riêng, dùng được offline.'
            : 'Smoother, own icon, works offline.'}
        </p>
      </div>
      <button
        onClick={handleInstall}
        className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-primary-hover"
      >
        {lang === 'vi' ? 'Cài' : 'Install'}
      </button>
      <button
        onClick={handleDismiss}
        aria-label={lang === 'vi' ? 'Đóng' : 'Dismiss'}
        className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-surface hover:text-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
