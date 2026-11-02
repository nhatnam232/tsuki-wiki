import { Router, type Request, type Response } from 'express'

const router = Router()

const ALLOWED_HOSTS = new Set([
  'media.kitsu.io',
  'cdn.myanimelist.net',
  's4.anilist.co',
  'img.anili.st',
  'imgs.search.brave.com',
  'cdn.jsdelivr.net',
])

/**
 * GET /api/image?url=https://...&w=480
 *
 * Lightweight image proxy:
 *   • Whitelists trusted CDNs (no SSRF surface).
 *   • Streams the upstream bytes back with CDN-friendly Cache-Control.
 *   • The optional `w=` param appends AniList/Jikan-compatible resize hints
 *     (AniList sizes via `?w=`, Jikan via `?w=` doesn't apply but we keep it
 *     for AniList).
 *
 * Why not Cloudflare Images? Because we already paid for Vercel bandwidth and
 * this avoids signing up for an external account just to resize anime covers.
 *
 * For real production use, switch this to a redirect to wsrv.nl or
 * /_vercel/image (Next.js style) once the project moves off the SPA template.
 */
router.get('/', async (req: Request, res: Response) => {
  const raw = String(req.query.url ?? '').trim()
  const width = Math.min(1024, Math.max(48, Number(req.query.w) || 0)) || null

  if (!raw) return res.status(400).json({ error: 'Missing url parameter' })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return res.status(400).json({ error: 'Invalid url' })
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return res.status(403).json({ error: 'Host not allowed' })
  }

  // AniList supports `?w=` natively; for others we just pass through.
  if (width && target.hostname === 's4.anilist.co' && !target.searchParams.has('w')) {
    target.searchParams.set('w', String(width))
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': 'AnimeWiki/1.0 (+https://animewiki.vercel.app)' },
    })

    if (!upstream.ok) {
      return res.status(upstream.status).end()
    }

    const ct = upstream.headers.get('content-type') ?? 'image/jpeg'
    const buf = Buffer.from(await upstream.arrayBuffer())

    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable')
    res.setHeader('X-Image-Source', target.hostname)
    return res.status(200).send(buf)
  } catch (err) {
    console.error('image proxy error', err)
    return res.status(502).json({ error: 'Upstream fetch failed' })
  }
})

export default router
