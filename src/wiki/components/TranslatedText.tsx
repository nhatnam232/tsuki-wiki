import { useEffect, useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useLangContext } from '@/providers/LangProvider'
import { Fragment } from 'react'
import { parseWikiText } from '@/wiki/utils/parser'
import WikiLink from './WikiLink'

type Props = {
  /** Source text — assumed to be Vietnamese (canonical wiki language). */
  text: string
  className?: string
  /** When true, the dual-format `... — English — ...` separator is stripped
      from the source even before translation, so we never show duplicate copy. */
  stripDualFormat?: boolean
}

/**
 * Renders wiki body text with on-the-fly translation.
 *
 * Strategy:
 *   - Source is canonical Vietnamese.
 *   - When lang === 'en', call `/api/translate` (the same DeepL/MyMemory pipe
 *     the main app already uses) and show the translated text instead.
 *   - Translation cached in localStorage so we don't hit the API repeatedly.
 *   - `[[Name|slug]]` tags survive translation (we split → translate plain
 *     parts → re-render links).
 *
 * This replaces the old "VI / EN" dual-formatted strings in registry.ts —
 * the registry is now Vietnamese-only and the UI translates on demand,
 * exactly like every other page in the main app.
 */
export default function TranslatedText({ text, className = '', stripDualFormat = true }: Props) {
  const { lang } = useLangContext()

  // Strip the "— English —" block from legacy bilingual entries so we only
  // ever feed VIETNAMESE source to the translator.
  const cleanedSource = useMemo(() => {
    if (!stripDualFormat) return text
    // Old entries used "— English —" as a divider. Cut everything from there.
    const idx = text.indexOf('— English —')
    return idx >= 0 ? text.slice(0, idx).trim() : text
  }, [text, stripDualFormat])

  const segments = useMemo(() => parseWikiText(cleanedSource), [cleanedSource])

  if (lang === 'vi') {
    // Render directly — no network needed.
    return <Renderer segments={segments} className={className} />
  }

  return <EnglishRenderer text={cleanedSource} segments={segments} className={className} />
}

// ─── EN renderer with translation cache ────────────────────────────────────

const TR_CACHE_KEY = 'wiki-translate-cache-v1'
function readCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(TR_CACHE_KEY) || '{}') }
  catch { return {} }
}
function writeCache(cache: Record<string, string>) {
  try { localStorage.setItem(TR_CACHE_KEY, JSON.stringify(cache)) }
  catch { /* storage blocked */ }
}

function EnglishRenderer({
  text,
  segments,
  className,
}: { text: string; segments: ReturnType<typeof parseWikiText>; className: string }) {
  const [translated, setTranslated] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!text.trim()) return
    const cache = readCache()
    if (cache[text]) {
      setTranslated(cache[text])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, targetLang: 'en' }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        if (res?.success && res.data?.text) {
          const next = res.data.text as string
          setTranslated(next)
          const c = readCache()
          c[text] = next
          writeCache(c)
        } else {
          setTranslated(text) // fallback to source
        }
      })
      .catch(() => { if (!cancelled) setTranslated(text) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [text])

  if (loading && !translated) {
    return (
      <div className={`flex items-center gap-2 text-sm text-text-muted ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Translating…
      </div>
    )
  }

  // Once translated we lose the [[link|slug]] markers (they're plain text).
  // Re-parse the translated string to re-extract any link markers DeepL
  // accidentally preserved (it usually does).
  const finalSegments = translated ? parseWikiText(translated) : segments

  return <Renderer segments={finalSegments} className={className} />
}

function Renderer({
  segments,
  className,
}: { segments: ReturnType<typeof parseWikiText>; className: string }) {
  return (
    <div className={`whitespace-pre-line text-sm leading-relaxed text-text ${className}`}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <Fragment key={i}>{seg.text}</Fragment>
        return <WikiLink key={i} label={seg.label} targetId={seg.targetId} />
      })}
    </div>
  )
}
