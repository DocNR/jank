export type TGif = {
  id: string
  previewUrl: string // small animated rendition for the grid
  gifUrl: string // full .gif URL inserted into the note
  width: number
  height: number
  blurPreview?: string
  alt?: string
}

export type TGifPage = {
  gifs: TGif[]
  nextPage: number | null
}

// Raw Klipy shapes (best-effort; the docs wrap renditions under `file`, some
// summaries say `files` — we accept either). All fields optional: ads and
// malformed entries simply lack a media file and are skipped.
type KlipyRendition = { url?: string; width?: number; height?: number }
type KlipyFormats = { gif?: KlipyRendition; webp?: KlipyRendition; mp4?: KlipyRendition }
type KlipyFile = { hd?: KlipyFormats; md?: KlipyFormats; sm?: KlipyFormats; xs?: KlipyFormats }
type KlipyItem = {
  slug?: string
  id?: string | number
  title?: string
  blur_preview?: string
  file?: KlipyFile
  files?: KlipyFile
}
type KlipyResponse = {
  result?: boolean
  data?: { data?: KlipyItem[]; current_page?: number; per_page?: number; has_next?: boolean }
}

export function normalizeKlipyResponse(json: KlipyResponse): TGifPage {
  const data = json?.data
  const items = Array.isArray(data?.data) ? data.data : []
  const gifs: TGif[] = []
  for (const item of items) {
    const f = item?.file ?? item?.files
    if (!f) continue
    const gifUrl = f.md?.gif?.url ?? f.hd?.gif?.url ?? f.sm?.gif?.url
    if (!gifUrl) continue // require a usable .gif URL to render inline
    const gifDims = f.md?.gif ?? f.hd?.gif ?? f.sm?.gif ?? {}
    const previewUrl =
      f.xs?.webp?.url ?? f.sm?.webp?.url ?? f.xs?.gif?.url ?? f.sm?.gif?.url ?? gifUrl
    gifs.push({
      id: String(item.slug ?? item.id ?? gifUrl),
      previewUrl,
      gifUrl,
      width: Number(gifDims.width ?? 0),
      height: Number(gifDims.height ?? 0),
      blurPreview: item.blur_preview,
      alt: item.title
    })
  }
  const nextPage = data?.has_next ? Number(data.current_page ?? 1) + 1 : null
  return { gifs, nextPage }
}

export class KlipyNotConfiguredError extends Error {
  constructor() {
    super('Klipy API key not configured')
    this.name = 'KlipyNotConfiguredError'
  }
}

class KlipyService {
  static instance: KlipyService

  constructor() {
    if (!KlipyService.instance) {
      KlipyService.instance = this
    }
    return KlipyService.instance
  }

  private async fetchPage(
    endpoint: 'search' | 'trending',
    params: URLSearchParams
  ): Promise<TGifPage> {
    const res = await fetch(`/api/klipy/gifs/${endpoint}?${params.toString()}`)
    if (res.status === 503) throw new KlipyNotConfiguredError()
    if (!res.ok) throw new Error(`klipy ${endpoint} failed: ${res.status}`)
    return normalizeKlipyResponse((await res.json()) as KlipyResponse)
  }

  async trendingGifs(page = 1): Promise<TGifPage> {
    return this.fetchPage('trending', new URLSearchParams({ page: String(page) }))
  }

  async searchGifs(query: string, page = 1): Promise<TGifPage> {
    const q = query.trim()
    if (!q) return this.trendingGifs(page)
    return this.fetchPage('search', new URLSearchParams({ q, page: String(page) }))
  }

  // Fire-and-forget good-citizen analytics ping; never blocks or throws.
  registerShare(slug: string): void {
    if (!slug) return
    fetch('/api/klipy/gifs/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug })
    }).catch(() => {})
  }
}

const instance = new KlipyService()
export default instance
