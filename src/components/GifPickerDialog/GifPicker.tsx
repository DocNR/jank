import { LoaderCircle, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import klipyService, { KlipyNotConfiguredError, TGif } from '@/services/klipy.service'

type Status = 'idle' | 'loading' | 'error' | 'not_configured'

export default function GifPicker({ onSelect }: { onSelect: (gif: TGif) => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<TGif[]>([])
  const [nextPage, setNextPage] = useState<number | null>(1)
  const [status, setStatus] = useState<Status>('loading')
  const inputRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)
  const loadingMore = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-focus the search field on open (matches the Search column behavior).
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced query → reset and load page 1. reqId guards against out-of-order
  // responses when the query changes mid-flight.
  useEffect(() => {
    const id = ++reqId.current
    setStatus('loading')
    const handle = setTimeout(() => {
      klipyService
        .searchGifs(query, 1)
        .then((page) => {
          if (reqId.current !== id) return
          setGifs(page.gifs)
          setNextPage(page.nextPage)
          setStatus('idle')
        })
        .catch((e) => {
          if (reqId.current !== id) return
          setStatus(e instanceof KlipyNotConfiguredError ? 'not_configured' : 'error')
        })
    }, 300)
    return () => clearTimeout(handle)
  }, [query])

  const loadMore = useCallback(() => {
    if (nextPage == null || loadingMore.current) return
    loadingMore.current = true
    const id = reqId.current
    klipyService
      .searchGifs(query, nextPage)
      .then((page) => {
        if (reqId.current !== id) return
        // De-dupe by id: guards against an overlapping fetch and against Klipy
        // legitimately returning the same GIF across page boundaries (which
        // would otherwise produce duplicate React keys).
        setGifs((prev) => {
          const seen = new Set(prev.map((g) => g.id))
          return [...prev, ...page.gifs.filter((g) => !seen.has(g.id))]
        })
        setNextPage(page.nextPage)
      })
      .catch(() => {
        /* keep existing results on pagination error */
      })
      .finally(() => {
        loadingMore.current = false
      })
  }, [nextPage, query])

  useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return
    const io = new IntersectionObserver(
      (entries) => {
        // Only paginate once the initial/search load has settled, so the
        // sentinel can't race the page-1 fetch.
        if (entries[0]?.isIntersecting && status === 'idle') loadMore()
      },
      // root = the dialog's internal scroll container, not the viewport.
      { root, rootMargin: '200px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, status])

  // Greedy 2-column masonry: place each GIF in whichever column is currently
  // shorter (estimated via accumulated aspect-ratio height). Deterministic and
  // append-stable — loading another page never reshuffles existing items.
  const columns = useMemo(() => {
    const cols: TGif[][] = [[], []]
    const heights = [0, 0]
    for (const gif of gifs) {
      const i = heights[0] <= heights[1] ? 0 : 1
      cols[i].push(gif)
      heights[i] += gif.width ? gif.height / gif.width : 1
    }
    return cols
  }, [gifs])

  const renderGif = (gif: TGif) => (
    <button
      key={gif.id}
      type="button"
      onClick={() => onSelect(gif)}
      className="bg-muted/40 block w-full overflow-hidden rounded-md bg-cover bg-center"
      style={{ backgroundImage: gif.blurPreview ? `url("${gif.blurPreview}")` : undefined }}
      title={gif.alt}
    >
      <img
        src={gif.previewUrl}
        alt={gif.alt ?? ''}
        loading="lazy"
        className="block w-full object-cover"
        style={{ aspectRatio: gif.width && gif.height ? `${gif.width}/${gif.height}` : '1' }}
      />
    </button>
  )

  return (
    <div className="flex h-[60vh] max-h-[420px] w-[320px] flex-col gap-2 p-2 sm:w-[360px]">
      <div className="relative">
        <Search className="text-muted-foreground absolute start-2 top-1/2 size-4 -translate-y-1/2" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search GIFs')}
          className="bg-muted/40 focus-visible:ring-ring w-full rounded-md py-2 ps-8 pe-2 text-sm focus-visible:ring-1 focus-visible:outline-hidden"
        />
      </div>

      {status === 'not_configured' ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-sm">
          {t("GIF search isn't set up yet")}
        </div>
      ) : status === 'error' ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-sm">
          {t('Failed to load GIFs')}
        </div>
      ) : gifs.length === 0 && status !== 'loading' ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          {t('No GIFs found')}
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="flex items-start gap-1">
            <div className="flex min-w-0 flex-1 flex-col gap-1">{columns[0].map(renderGif)}</div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">{columns[1].map(renderGif)}</div>
          </div>
          <div ref={sentinelRef} className="h-1" />
          {status === 'loading' && (
            <div className="flex justify-center py-3">
              <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}
        </div>
      )}

      <div className="text-muted-foreground pt-1 text-center text-[10px]">
        {t('Powered by KLIPY')}
      </div>
    </div>
  )
}
