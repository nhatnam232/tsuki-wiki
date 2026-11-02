import express, { Request, Response } from 'express'
import { translateText } from './translate-lib.js'

const router = express.Router()

/**
 * Wikipedia importer route.
 *
 * Endpoints:
 *   GET /api/wiki-import/summary?slug=Frieren&lang=en
 *      → Returns the lead paragraph + thumbnail + Wikipedia URL.
 *   GET /api/wiki-import/sections?slug=Frieren&lang=en&translate=vi
 *      → Returns multiple structured sections (Concept, Personality, Reception, ...).
 *      → Optional `translate=vi` runs every section through DeepL/MyMemory
 *         (using the existing translate.ts pipeline). Useful when only EN exists.
 *
 * Strategy:
 *   1. Always TRY the requested language first (e.g. /vi.wikipedia/page/X).
 *   2. If 404, fall back to en.wikipedia.
 *   3. Cache responses in-memory for 24h to avoid hitting Wikipedia per request.
 *
 * Wikipedia REST API docs: https://en.wikipedia.org/api/rest_v1/
 * Attribution: content is CC BY-SA — the client renders a "Source: Wikipedia"
 * notice with a link to the original article.
 */

const ONE_DAY = 24 * 60 * 60 * 1000

type Cached<T> = { ts: number; value: T }
const summaryCache = new Map<string, Cached<unknown>>()
const sectionsCache = new Map<string, Cached<unknown>>()

function cached<T>(map: Map<string, Cached<unknown>>, key: string): T | null {
  const v = map.get(key)
  if (v && Date.now() - v.ts < ONE_DAY) return v.value as T
  return null
}

function memoize<T>(map: Map<string, Cached<unknown>>, key: string, value: T): T {
  map.set(key, { ts: Date.now(), value })
  return value
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, {
      headers: {
        accept: 'application/json',
        // Wikipedia asks for a descriptive User-Agent; a plain fetch UA
        // sometimes triggers 403.
        'user-agent': 'AnimeWikiBot/1.0 (https://animewiki.vercel.app; contact: support)',
      },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Try VI first, fall back to EN.
async function fetchSummary(slug: string, lang: 'vi' | 'en'): Promise<any | null> {
  const tryLangs: Array<'vi' | 'en'> = lang === 'vi' ? ['vi', 'en'] : ['en']
  for (const l of tryLangs) {
    const url = `https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`
    const data = await fetchJson(url)
    if (data && data.type !== 'disambiguation') {
      return { ...data, _resolvedLang: l }
    }
  }
  return null
}

async function fetchSections(slug: string, lang: 'vi' | 'en'): Promise<any | null> {
  const tryLangs: Array<'vi' | 'en'> = lang === 'vi' ? ['vi', 'en'] : ['en']
  for (const l of tryLangs) {
    const url = `https://${l}.wikipedia.org/api/rest_v1/page/mobile-sections/${encodeURIComponent(slug)}`
    const data = await fetchJson(url)
    if (data) return { ...data, _resolvedLang: l }
  }
  return null
}

// ─── /summary ──────────────────────────────────────────────────────────────
router.get('/summary', async (req: Request, res: Response) => {
  const slug = String(req.query.slug || '').trim()
  const lang = req.query.lang === 'vi' ? 'vi' : 'en'
  if (!slug) return res.status(400).json({ success: false, error: 'Missing slug' })

  const key = `${slug}|${lang}`
  const hit = cached<any>(summaryCache, key)
  if (hit) return res.json({ success: true, data: hit, cached: true })

  const data = await fetchSummary(slug, lang)
  if (!data) {
    return res.status(404).json({ success: false, error: 'Wikipedia article not found' })
  }

  const out = {
    title: data.title,
    description: data.description,
    extract: data.extract,
    extractHtml: data.extract_html,
    thumbnail: data.thumbnail?.source ?? null,
    originalImage: data.originalimage?.source ?? null,
    pageUrl: data.content_urls?.desktop?.page ?? null,
    lang: data._resolvedLang,
  }
  memoize(summaryCache, key, out)
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400')
  res.json({ success: true, data: out })
})

// ─── /sections ─────────────────────────────────────────────────────────────
//
// Returns an array of `{ id, title, html }` objects covering ALL Wikipedia
// sections except boilerplate (References, External links, etc).
// If `translate=vi` is set AND the resolved Wikipedia is English, run each
// section's plaintext through translate.ts and return both EN + translated VI.
router.get('/sections', async (req: Request, res: Response) => {
  const slug = String(req.query.slug || '').trim()
  const lang = req.query.lang === 'vi' ? 'vi' : 'en'
  const translate = req.query.translate === 'vi' || req.query.translate === 'en'
  const translateTo = req.query.translate === 'vi' ? 'vi' : 'en'
  if (!slug) return res.status(400).json({ success: false, error: 'Missing slug' })

  const cacheKey = `${slug}|${lang}|${translate ? translateTo : 'no'}`
  const hit = cached<any>(sectionsCache, cacheKey)
  if (hit) return res.json({ success: true, data: hit, cached: true })

  const data = await fetchSections(slug, lang)
  if (!data) {
    return res.status(404).json({ success: false, error: 'Wikipedia article not found' })
  }

  const SKIP = /^(references?|external links?|see also|notes|bibliography|further reading|nguồn|tham khảo|liên kết ngoài|xem thêm)$/i

  // mobile-sections returns lead + remaining.sections array
  const allSections: Array<{ id: number; title: string; text: string }> = []
  if (data.lead) {
    allSections.push({
      id: 0,
      title: data.lead.displaytitle ?? data.lead.normalizedtitle ?? 'Overview',
      text: data.lead.sections?.[0]?.text ?? '',
    })
  }
  const remaining = data.remaining?.sections ?? []
  for (const s of remaining) {
    const title = (s.line ?? '').replace(/<[^>]*>/g, '').trim()
    if (!title || SKIP.test(title)) continue
    if ((s.toclevel ?? 1) > 2) continue // skip deeply nested h3+ for compactness
    allSections.push({ id: s.id, title, text: s.text ?? '' })
  }

  // Strip HTML to plaintext + collapse whitespace.
  const stripped = allSections.map((s) => ({
    id: s.id,
    title: s.title,
    html: s.text,
    text: htmlToText(s.text),
  }))

  // Run each through translate if requested AND we ended up with the wrong lang.
  // Use a small character cap per section to avoid hitting translate quotas.
  if (translate && data._resolvedLang !== translateTo) {
    for (const s of stripped) {
      if (!s.text) continue
      const capped = s.text.slice(0, 1500)
      try {
        const result = await translateText(capped, translateTo as 'vi' | 'en')
        if (result.available) {
          ;(s as any).translated = result.translatedText
        }
      } catch {
        // swallow — section just won't have a translated version
      }
    }
  }

  const out = {
    title: data.lead?.displaytitle ?? data.lead?.normalizedtitle ?? slug,
    pageUrl: `https://${data._resolvedLang}.wikipedia.org/wiki/${encodeURIComponent(slug)}`,
    lang: data._resolvedLang,
    translatedTo: translate && data._resolvedLang !== translateTo ? translateTo : null,
    sections: stripped,
  }
  memoize(sectionsCache, cacheKey, out)
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400')
  res.json({ success: true, data: out })
})

/** Naive HTML → plaintext converter for Wikipedia content. */
function htmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<sup[^>]*class="reference"[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/?(p|div|span|a|ul|ol|li|i|em|b|strong|h[1-6]|figure|figcaption|cite)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default router
