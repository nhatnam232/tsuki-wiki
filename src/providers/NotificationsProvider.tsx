import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { API_READY, connectRealtime, notifications as notificationsApi } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'

export type NotificationKind = 'new_episode' | 'system' | 'reply'

export type NotificationItem = {
  id: string
  user_id: string
  kind: NotificationKind
  anime_id: number | null
  anime_title: string | null
  anime_cover: string | null
  episode: number | null
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

type Ctx = {
  items: NotificationItem[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markAllRead: () => Promise<void>
  markRead: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
}

const NotificationsContext = createContext<Ctx | null>(null)

/**
 * Centralised notifications feed for the signed-in user.
 *
 * - Loads the most-recent 30 entries from the backend on mount / user change.
 * - Subscribes to the `notifications:<uid>` WebSocket room so the bell badge
 *   updates as soon as the server creates a row.
 * - Keeps a 60s polling fallback in case the socket is unavailable.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !API_READY) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const res = await notificationsApi.list({ limit: 30 })
      setItems((res.items ?? []) as NotificationItem[])
    } catch (err) {
      console.warn('[notifications] load failed', err instanceof Error ? err.message : err)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Realtime room + polling fallback.
  useEffect(() => {
    if (!user || !API_READY) return
    const dispose = connectRealtime([`notifications:${user.id}`], (event) => {
      if (event.type === 'notification:new') void refresh()
    })
    const interval = window.setInterval(() => void refresh(), 60_000)
    return () => {
      dispose()
      window.clearInterval(interval)
    }
  }, [user, refresh])

  const markRead = useCallback(
    async (id: string) => {
      if (!user || !API_READY) return
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      )
      try {
        await notificationsApi.markRead(id)
      } catch (err) {
        console.warn('[notifications] markRead failed', err instanceof Error ? err.message : err)
      }
    },
    [user],
  )

  const markAllRead = useCallback(async () => {
    if (!user || !API_READY) return
    const now = new Date().toISOString()
    const unread = items.filter((n) => !n.read_at).map((n) => n.id)
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    await Promise.all(
      unread.map((id) =>
        notificationsApi.markRead(id).catch((err: unknown) => {
          console.warn('[notifications] markAllRead failed', err)
        }),
      ),
    )
  }, [user, items])

  const dismiss = useCallback(
    async (id: string) => {
      if (!user || !API_READY) return
      setItems((prev) => prev.filter((n) => n.id !== id))
      try {
        await notificationsApi.remove(id)
      } catch (err) {
        console.warn('[notifications] dismiss failed', err instanceof Error ? err.message : err)
      }
    },
    [user],
  )

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items])

  const value = useMemo<Ctx>(
    () => ({ items, unreadCount, loading, refresh, markAllRead, markRead, dismiss }),
    [items, unreadCount, loading, refresh, markAllRead, markRead, dismiss],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    return {
      items: [],
      unreadCount: 0,
      loading: false,
      refresh: async () => {},
      markAllRead: async () => {},
      markRead: async () => {},
      dismiss: async () => {},
    }
  }
  return ctx
}
