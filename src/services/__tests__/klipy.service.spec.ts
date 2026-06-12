import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeKlipyResponse } from '@/services/klipy.service'
import klipyService, { KlipyNotConfiguredError } from '@/services/klipy.service'

describe('normalizeKlipyResponse', () => {
  const sample = {
    result: true,
    data: {
      data: [
        {
          slug: 'abc123',
          title: 'happy cat',
          blur_preview: 'blurxx',
          file: {
            hd: { gif: { url: 'https://static.klipy.com/x/hd.gif', width: 480, height: 360 } },
            md: {
              gif: { url: 'https://static.klipy.com/x/md.gif', width: 360, height: 270 },
              webp: { url: 'https://static.klipy.com/x/md.webp', width: 360, height: 270 }
            },
            sm: { gif: { url: 'https://static.klipy.com/x/sm.gif', width: 220, height: 165 } },
            xs: { webp: { url: 'https://static.klipy.com/x/xs.webp', width: 120, height: 90 } }
          }
        },
        {}, // ad / malformed entry — no media file → must be skipped
        {
          id: 999,
          title: 'plural-key variant',
          files: { md: { gif: { url: 'https://static.klipy.com/y/md.gif', width: 200, height: 200 } } }
        }
      ],
      current_page: 1,
      per_page: 24,
      has_next: true
    }
  }

  it('extracts gif + preview URLs and dimensions, skipping entries with no media', () => {
    const page = normalizeKlipyResponse(sample)
    expect(page.gifs).toHaveLength(2)
    expect(page.gifs[0]).toMatchObject({
      id: 'abc123',
      gifUrl: 'https://static.klipy.com/x/md.gif',
      previewUrl: 'https://static.klipy.com/x/xs.webp',
      width: 360,
      height: 270,
      blurPreview: 'blurxx',
      alt: 'happy cat'
    })
  })

  it('accepts the `files` (plural) wrapper key as a fallback', () => {
    const page = normalizeKlipyResponse(sample)
    expect(page.gifs[1].gifUrl).toBe('https://static.klipy.com/y/md.gif')
  })

  it('computes nextPage from has_next + current_page', () => {
    expect(normalizeKlipyResponse(sample).nextPage).toBe(2)
  })

  it('returns nextPage null when has_next is false', () => {
    const page = normalizeKlipyResponse({ result: true, data: { data: [], current_page: 3, has_next: false } })
    expect(page).toEqual({ gifs: [], nextPage: null })
  })
})

const mkRes = (status: number, json: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json
  }) as unknown as Response

describe('klipyService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('searchGifs calls the proxy search endpoint with q + page and returns normalized gifs', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      mkRes(200, { result: true, data: { data: [{ slug: 's', file: { md: { gif: { url: 'https://static.klipy.com/z.gif', width: 1, height: 1 } } } }], current_page: 1, has_next: false } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const page = await klipyService.searchGifs('cats', 2)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('/api/klipy/gifs/search')
    expect(calledUrl).toContain('q=cats')
    expect(calledUrl).toContain('page=2')
    expect(page.gifs[0].gifUrl).toBe('https://static.klipy.com/z.gif')
  })

  it('empty query falls back to trending', async () => {
    const fetchMock = vi.fn(async (_url: string) => mkRes(200, { result: true, data: { data: [], has_next: false } }))
    vi.stubGlobal('fetch', fetchMock)
    await klipyService.searchGifs('   ', 1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/klipy/gifs/trending')
  })

  it('throws KlipyNotConfiguredError on a 503 from the proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mkRes(503, { error: 'not_configured' })))
    await expect(klipyService.trendingGifs()).rejects.toBeInstanceOf(KlipyNotConfiguredError)
  })
})
