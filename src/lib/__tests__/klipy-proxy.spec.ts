import { describe, expect, it } from 'vitest'
import { buildKlipyUpstreamUrl, proxyKlipyRequest } from '@/lib/klipy-proxy'

const KEY = 'test-key-123'

describe('buildKlipyUpstreamUrl', () => {
  it('builds a search URL with the key in the path and q/page passed through', () => {
    const url = buildKlipyUpstreamUrl(KEY, 'gifs/search', new URLSearchParams({ q: 'cats', page: '2' }))
    expect(url).toContain('https://api.klipy.com/api/v1/test-key-123/gifs/search?')
    expect(url).toContain('q=cats')
    expect(url).toContain('page=2')
    expect(url).toContain('content_filter=high') // safe default
  })

  it('defaults page to 1 and per_page to 24', () => {
    const url = buildKlipyUpstreamUrl(KEY, 'gifs/trending', new URLSearchParams())
    expect(url).toContain('page=1')
    expect(url).toContain('per_page=24')
  })

  it('caps per_page at 30', () => {
    const url = buildKlipyUpstreamUrl(KEY, 'gifs/trending', new URLSearchParams({ per_page: '500' }))
    expect(url).toContain('per_page=30')
  })

  it('coerces page=0 and negative pages to 1', () => {
    expect(
      buildKlipyUpstreamUrl(KEY, 'gifs/trending', new URLSearchParams({ page: '0' }))
    ).toContain('page=1')
    expect(
      buildKlipyUpstreamUrl(KEY, 'gifs/trending', new URLSearchParams({ page: '-3' }))
    ).toContain('page=1')
  })

  it('clamps per_page=0 and negative per_page up to 1', () => {
    expect(
      buildKlipyUpstreamUrl(KEY, 'gifs/trending', new URLSearchParams({ per_page: '0' }))
    ).toContain('per_page=1')
    expect(
      buildKlipyUpstreamUrl(KEY, 'gifs/trending', new URLSearchParams({ per_page: '-5' }))
    ).toContain('per_page=1')
  })

  it('throws on a non-allowlisted endpoint', () => {
    expect(() => buildKlipyUpstreamUrl(KEY, 'gifs/../secrets', new URLSearchParams())).toThrow()
  })
})

describe('proxyKlipyRequest', () => {
  const okFetch = (async () =>
    new Response(JSON.stringify({ result: true, data: { data: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch

  it('returns 503 not_configured when no apiKey is set', async () => {
    const r = await proxyKlipyRequest(
      { endpoint: 'gifs/trending', search: new URLSearchParams(), method: 'GET' },
      okFetch
    )
    expect(r.status).toBe(503)
    expect(JSON.parse(r.body).error).toBe('not_configured')
  })

  it('returns 404 for an unknown endpoint', async () => {
    const r = await proxyKlipyRequest(
      { endpoint: 'gifs/evil', search: new URLSearchParams(), method: 'GET', apiKey: 'k' },
      okFetch
    )
    expect(r.status).toBe(404)
  })

  it('returns 405 when the method does not match the endpoint', async () => {
    const r = await proxyKlipyRequest(
      { endpoint: 'gifs/search', search: new URLSearchParams(), method: 'POST', apiKey: 'k' },
      okFetch
    )
    expect(r.status).toBe(405)
  })

  it('forwards a valid GET and passes the upstream body + status through', async () => {
    let calledUrl = ''
    const spyFetch = (async (input: string) => {
      calledUrl = String(input)
      return new Response(JSON.stringify({ result: true, data: { data: [{ slug: 'a' }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const r = await proxyKlipyRequest(
      { endpoint: 'gifs/search', search: new URLSearchParams({ q: 'dog' }), method: 'GET', apiKey: 'k' },
      spyFetch
    )
    expect(calledUrl).toContain('/api/v1/k/gifs/search?')
    expect(calledUrl).toContain('q=dog')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).data.data[0].slug).toBe('a')
  })
})
