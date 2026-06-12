import { isInsecureUrl } from '@/lib/url'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import webService from '@/services/web.service'
import { TWebMetadata } from '@/types'
import { useEffect, useState } from 'react'

// Session-level metadata cache. Lets remounted <WebPreview> instances skip
// the empty→card transition on scroll-back: state initializes synchronously
// from the cache, so the first render already has title/image populated.
// webService's DataLoader dedups network requests but resolves on the next
// microtask even on cache hit, so we still need a synchronous read here.
const metadataCache = new Map<string, TWebMetadata>()

export function useFetchWebMetadata(url: string) {
  const { allowInsecureConnection } = useUserPreferences()
  const proxyServer = import.meta.env.VITE_PROXY_SERVER
  const finalUrl = proxyServer ? `${proxyServer}/sites/${encodeURIComponent(url)}` : url

  const cached = metadataCache.get(finalUrl)
  const [metadata, setMetadata] = useState<TWebMetadata>(() => cached ?? {})
  // Pending only on a real first fetch — not when served from cache or skipped
  // (insecure). Callers reserve layout space while pending so the card doesn't
  // pop in and shove the virtualized feed when the fetch resolves.
  const [isPending, setIsPending] = useState(
    () => !cached && (allowInsecureConnection || !isInsecureUrl(finalUrl))
  )

  useEffect(() => {
    if (!allowInsecureConnection && isInsecureUrl(finalUrl)) {
      setIsPending(false)
      return
    }

    const hit = metadataCache.get(finalUrl)
    if (hit) {
      setMetadata(hit)
      setIsPending(false)
      return
    }

    setIsPending(true)
    webService.fetchWebMetadata(finalUrl).then((result) => {
      metadataCache.set(finalUrl, result)
      setMetadata(result)
      setIsPending(false)
    })
  }, [finalUrl, allowInsecureConnection])

  return { ...metadata, isPending }
}
