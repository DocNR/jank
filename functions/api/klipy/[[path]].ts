// Cloudflare Pages Function — proxies /api/klipy/* to the Klipy GIF API,
// injecting the server-side KLIPY_API_KEY so it never enters the client
// bundle. All logic lives in the unit-tested src/lib/klipy-proxy module; this
// is a thin runtime adapter. (No @/ alias in Functions — use a relative path.)
import { proxyKlipyRequest } from '../../../src/lib/klipy-proxy'

export async function onRequest(context: {
  request: Request
  env: { KLIPY_API_KEY?: string }
  params: { path?: string | string[] }
}): Promise<Response> {
  const { request, env, params } = context
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : []
  const endpoint = segments.join('/') // e.g. "gifs/search"
  const url = new URL(request.url)
  const body = request.method === 'POST' ? await request.text() : undefined

  const result = await proxyKlipyRequest(
    {
      endpoint,
      search: url.searchParams,
      method: request.method,
      body,
      apiKey: env.KLIPY_API_KEY
    },
    fetch
  )

  return new Response(result.body, {
    status: result.status,
    headers: { 'content-type': result.contentType }
  })
}
