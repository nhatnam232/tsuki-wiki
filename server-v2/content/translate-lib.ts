
type TranslateResponse =
  | { translatedText: string; available: true }
  | { available: false; reason: string }

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL?.trim()
const LIBRETRANSLATE_API_KEY = process.env.LIBRETRANSLATE_API_KEY?.trim()
const DEEPL_API_KEY = process.env.DEEPL_API_KEY?.trim()

// ─── In-memory translation cache ─────────────────────────────────────────────
// server-v2 không còn Supabase; cache dịch giữ trong RAM của process (mất khi
// restart, chấp nhận được: tránh gọi DeepL lặp lại trong cùng phiên chạy).
const translationCache = new Map<string, string>()

async function getCachedTranslation(textHash: string, targetLang: string): Promise<string | null> {
  return translationCache.get(`${targetLang}:${textHash}`) ?? null
}

async function saveCachedTranslation(
  textHash: string,
  sourceText: string,
  translatedText: string,
  targetLang: string,
  provider: string,
): Promise<void> {
  void sourceText
  void provider
  if (translationCache.size > 5000) translationCache.clear()
  translationCache.set(`${targetLang}:${textHash}`, translatedText)
}

// Hash đơn giản dùng để làm key cache (không cần mật mã học)
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // chuyển về 32-bit int
  }
  // Trả về hex dương
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── DeepL API (free tier: 1,000,000 chars/month) ────────────────────────────
async function translateViaDeepL(
  text: string,
  targetLang: string,
  sourceLang = 'EN',
): Promise<string | null> {
  if (!DEEPL_API_KEY) return null
  try {
    // Key kết thúc :fx → free endpoint, còn lại → paid endpoint
    const baseUrl = DEEPL_API_KEY.endsWith(':fx')
      ? 'https://api-free.deepl.com'
      : 'https://api.deepl.com'

    const deepLTarget = targetLang.toUpperCase()
    const deepLSource = sourceLang === 'auto' ? null : sourceLang.toUpperCase()

    const body: Record<string, unknown> = {
      text: [text],
      target_lang: deepLTarget,
    }
    if (deepLSource) body.source_lang = deepLSource

    const response = await fetch(`${baseUrl}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return null
    const data = (await response.json()) as {
      translations?: { text: string }[]
    }
    return data.translations?.[0]?.text ?? null
  } catch {
    return null
  }
}

// ─── MyMemory free API (không cần key, 5000 ký tự/ngày/IP) ───────────────────
async function translateViaMyMemory(text: string, targetLang: string): Promise<string | null> {
  try {
    const langPair = `en|${targetLang}`
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = (await res.json()) as {
      responseStatus: number
      responseData?: { translatedText?: string }
    }
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText
    }
    return null
  } catch {
    return null
  }
}

// ─── LibreTranslate (self-hosted hoặc instance có cấu hình) ──────────────────
async function translateViaLibreTranslate(
  text: string,
  targetLang: string,
  sourceLang = 'auto',
): Promise<string | null> {
  if (!LIBRETRANSLATE_URL) return null
  try {
    const endpoint = `${LIBRETRANSLATE_URL.replace(/\/$/, '')}/translate`
    const payload: Record<string, string> = {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: 'text',
    }
    if (LIBRETRANSLATE_API_KEY) payload.api_key = LIBRETRANSLATE_API_KEY

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { translatedText?: string }
    return data.translatedText ?? null
  } catch {
    return null
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function translateText(
  text: string,
  targetLang: 'vi' | 'en',
  sourceLang = 'auto',
): Promise<TranslateResponse> {
  const normalized = text.trim()
  if (!normalized) {
    return { translatedText: '', available: true }
  }

  const hash = simpleHash(normalized)

  // 0. Kiểm tra cache Supabase trước — không tốn quota DeepL nếu đã dịch rồi
  const cached = await getCachedTranslation(hash, targetLang)
  if (cached) {
    return { translatedText: cached, available: true }
  }

  // 1. Thử DeepL (chất lượng tốt nhất, 1M ký tự/tháng)
  if (DEEPL_API_KEY) {
    const result = await translateViaDeepL(normalized, targetLang, sourceLang)
    if (result) {
      await saveCachedTranslation(hash, normalized, result, targetLang, 'deepl')
      return { translatedText: result, available: true }
    }
  }

  // 2. Thử LibreTranslate (nếu đã cấu hình)
  if (LIBRETRANSLATE_URL) {
    const result = await translateViaLibreTranslate(normalized, targetLang, sourceLang)
    if (result) {
      await saveCachedTranslation(hash, normalized, result, targetLang, 'libretranslate')
      return { translatedText: result, available: true }
    }
  }

  // 3. Fallback MyMemory (miễn phí, không cần cấu hình)
  const myMemoryResult = await translateViaMyMemory(normalized, targetLang)
  if (myMemoryResult) {
    await saveCachedTranslation(hash, normalized, myMemoryResult, targetLang, 'mymemory')
    return { translatedText: myMemoryResult, available: true }
  }

  return { available: false, reason: 'Tất cả dịch vụ dịch thuật hiện không khả dụng.' }
}
