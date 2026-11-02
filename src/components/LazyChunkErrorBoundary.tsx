import { Component, type ReactNode, type ErrorInfo } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

const RELOAD_FLAG = 'anm-chunk-reload-attempted'

/**
 * Catches "Failed to fetch dynamically imported module" / "Loading chunk
 * failed" errors that happen when the user has an outdated tab open after a
 * deploy (the old chunk hash no longer exists on the server).
 *
 * Strategy:
 *   1. First time we see the error: hard-reload the page so the user gets
 *      the latest index.html which references the latest chunk hashes.
 *   2. If reloading didn't fix it (sessionStorage flag tells us we already
 *      tried), show a friendly retry UI instead of looping forever.
 *
 * This is critical for our lazy-loaded routes — without this, opening
 * /admin after a deploy = blank screen.
 */
export default class LazyChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    if (isChunkLoadError(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1')
          // Wipe any cached service-worker chunks that might be stale.
          void clearChunkCaches().finally(() => {
            window.location.reload()
          })
        }
      } catch {
        window.location.reload()
      }
    }
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep error visible in console.error (which we don't drop in prod).
    console.error('LazyChunkErrorBoundary caught', error, info)
  }

  reset = () => {
    try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* storage blocked */ }
    this.setState({ hasError: false })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-bold text-text">⚠️ Trang chưa tải xong</h2>
            <p className="text-sm text-text-muted">
              Có vẻ phiên bản trang đã thay đổi sau khi tab này mở. Hãy bấm nút bên dưới để tải lại.
            </p>
            <button
              type="button"
              onClick={this.reset}
              className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary-hover"
            >
              🔄 Tải lại trang
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function isChunkLoadError(error: Error): boolean {
  const msg = String(error?.message ?? '')
  return (
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Expected a JavaScript-or-Wasm module script but the server responded with a MIME type/i.test(msg) ||
    msg.includes('ChunkLoadError')
  )
}

/**
 * Wipe all caches managed by our service worker so the next page load fetches
 * fresh chunks. Safe to call even if the SW isn't registered.
 */
async function clearChunkCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    // best-effort, ignore
  }
}
