import { useEffect, useState } from 'react'
import { useLangContext } from '@/providers/LangProvider'

export type WikipediaSummary = {
  title: string
  description: string | null
  extract: string
  thumbnail: string | null
  pageUrl: string | null
  lang: 'vi' | 'en'
}

export type WikipediaSection = {
  id: number
  title: string
  text: string
  html?: string
  /** When the resolved Wikipedia is in the wrong language, server runs the
      text through DeepL/MyMemory and returns the translated version here. */
  translated?: string
}

export type WikipediaSections = {
  title: string
  pageUrl: string
  lang: 'vi' | 'en'
  /** Set when we asked the server to translate the article into another lang. */
  translatedTo: 'vi' | 'en' | null
  sections: WikipediaSection[]
}

/**
 * Fetch a Wikipedia summary for a given character/anime, preferring the
 * current site language but falling back to English when needed.
 *
 * Server endpoint: GET /api/wiki-import/summary?slug=...&lang=...
 *   - VI tried first when site language is VI.
 *   - On 404, the server falls back to en.wikipedia and returns lang='en'.
 *   - Cached server-side for 24h to be polite to Wikipedia.
 */
export function useWikipediaSummary(
  slugVi?: string | null,
  slugEn?: string | null,
): { data: WikipediaSummary | null; loading: boolean; error: string | null } {
  const { lang } = useLangContext()
  const slug = lang === 'vi' && slugVi ? slugVi : slugEn ?? slugVi ?? ''
  const [state, setState] = useState<{
    data: WikipediaSummary | null
    loading: boolean
    error: string | null
  }>({ data: null, loading: !!slug, error: null })

  useEffect(() => {
    if (!slug) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(`/api/wiki-import/summary?slug=${encodeURIComponent(slug)}&lang=${lang}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        if (res?.success && res.data) {
          setState({ data: res.data as WikipediaSummary, loading: false, error: null })
        } else {
          setState({ data: null, loading: false, error: res?.error || 'Not found' })
        }
      })
      .catch((e) => {
        if (cancelled) return
        setState({ data: null, loading: false, error: e?.message || 'Fetch failed' })
      })
    return () => { cancelled = true }
  }, [slug, lang])

  return state
}

/**
 * Fetch the full sectioned Wikipedia article (lazy — only loaded when the
 * user expands the "Read on Wikipedia" panel).
 *
 * Server endpoint: GET /api/wiki-import/sections?slug=...&lang=vi&translate=vi
 *   - Tries the requested language first.
 *   - If only EN exists, server runs each section through DeepL via the
 *     existing /api/translate route and returns BOTH original + translated.
 */
export function useWikipediaSections(
  slugVi?: string | null,
  slugEn?: string | null,
  /** Pass `true` to actually trigger the network call. */
  enabled = false,
): { data: WikipediaSections | null; loading: boolean; error: string | null } {
  const { lang } = useLangContext()
  const slug = lang === 'vi' && slugVi ? slugVi : slugEn ?? slugVi ?? ''
  const [state, setState] = useState<{
    data: WikipediaSections | null
    loading: boolean
    error: string | null
  }>({ data: null, loading: false, error: null })

  useEffect(() => {
    if (!enabled || !slug) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    const url = `/api/wiki-import/sections?slug=${encodeURIComponent(slug)}&lang=${lang}&translate=${lang}`
    fetch(url)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        if (res?.success && res.data) {
          setState({ data: res.data as WikipediaSections, loading: false, error: null })
        } else {
          setState({ data: null, loading: false, error: res?.error || 'Not found' })
        }
      })
      .catch((e) => {
        if (cancelled) return
        setState({ data: null, loading: false, error: e?.message || 'Fetch failed' })
      })
    return () => { cancelled = true }
  }, [slug, lang, enabled])

  return state
}
