const DEFAULT_TIMEOUT_MS = 15_000

export type ProxyFetchOptions = {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export type ProxyFetchResponse = {
  ok: boolean
  status: number
  statusText: string
  url: string
  headers: Record<string, string>
  body: string
}

export async function proxyFetch(
  url: string,
  options: ProxyFetchOptions = {}
): Promise<ProxyFetchResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal
    })
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      headers,
      body
    }
  } finally {
    clearTimeout(timer)
  }
}
