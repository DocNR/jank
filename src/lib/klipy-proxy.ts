// Server-only helpers for the Klipy GIF proxy. Imported by the Cloudflare
// Pages Function (functions/api/klipy/[[path]].ts) and the Vite dev middleware
// (vite.config.ts). MUST NOT be imported from client code — that would expose
// proxy internals in the browser bundle. Pure: only URL / URLSearchParams and
// an injected fetch.

const KLIPY_BASE = 'https://api.klipy.com/api/v1'

// Endpoints the proxy may forward, mapped to their required HTTP method.
const ALLOWED: Record<string, 'GET' | 'POST'> = {
  'gifs/search': 'GET',
  'gifs/trending': 'GET',
  'gifs/share': 'POST'
}

const MAX_PER_PAGE = 30
const DEFAULT_PER_PAGE = 24
// Safe-for-work default. NOTE: confirm Klipy's accepted content_filter values
// against the live API during Task 10 smoke; adjust the constant if needed.
const DEFAULT_CONTENT_FILTER = 'high'

export function isAllowedKlipyEndpoint(endpoint: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED, endpoint)
}

export function buildKlipyUpstreamUrl(
  apiKey: string,
  endpoint: string,
  search: URLSearchParams
): string {
  if (!isAllowedKlipyEndpoint(endpoint)) {
    throw new Error(`klipy: endpoint not allowed: ${endpoint}`)
  }
  const out = new URLSearchParams()
  const q = search.get('q')
  if (q) out.set('q', q)
  const pageRaw = Number(search.get('page') ?? '1')
  out.set('page', String(Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1))
  const perRaw = Number(search.get('per_page') ?? DEFAULT_PER_PAGE)
  const per = Number.isFinite(perRaw)
    ? Math.min(Math.max(1, Math.floor(perRaw)), MAX_PER_PAGE)
    : DEFAULT_PER_PAGE
  out.set('per_page', String(per))
  out.set('content_filter', search.get('content_filter') ?? DEFAULT_CONTENT_FILTER)
  const customerId = search.get('customer_id')
  if (customerId) out.set('customer_id', customerId)
  return `${KLIPY_BASE}/${apiKey}/${endpoint}?${out.toString()}`
}

export type ProxyResult = { status: number; body: string; contentType: string }

const json = (status: number, obj: unknown): ProxyResult => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(obj)
})

export async function proxyKlipyRequest(
  args: {
    endpoint: string
    search: URLSearchParams
    method: string
    body?: string
    apiKey?: string
  },
  fetchImpl: typeof fetch
): Promise<ProxyResult> {
  const { endpoint, search, method, body, apiKey } = args
  if (!apiKey) return json(503, { error: 'not_configured' })
  if (!isAllowedKlipyEndpoint(endpoint)) return json(404, { error: 'unknown_endpoint' })
  if (ALLOWED[endpoint] !== method) return json(405, { error: 'method_not_allowed' })

  let upstream: string
  try {
    upstream = buildKlipyUpstreamUrl(apiKey, endpoint, search)
  } catch {
    return json(404, { error: 'unknown_endpoint' })
  }

  const res = await fetchImpl(upstream, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? (body ?? '{}') : undefined
  })
  const text = await res.text()
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? 'application/json',
    body: text
  }
}
