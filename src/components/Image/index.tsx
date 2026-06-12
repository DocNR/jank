import { Skeleton } from '@/components/ui/skeleton'
import { isInsecureUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import blossomService from '@/services/blossom.service'
import { TImetaInfo } from '@/types'
import { decode } from 'blurhash'
import { ImageOff } from 'lucide-react'
import { HTMLAttributes, useEffect, useMemo, useRef, useState } from 'react'
import { thumbHashToDataURL } from 'thumbhash'

// Session-level cache of URLs that have successfully loaded once: their natural
// pixel dimensions plus the exact src that worked (the original URL or a resolved
// Blossom mirror). On a remount (e.g. virtualizer scroll-back) we use this to
// paint the image immediately — visible, at its known size — instead of replaying
// the resolve-then-load dance, which left the <img> srcless (and the row
// collapsed) for a frame and then flickered the image in.
const loadedImageDims = new Map<string, { width: number; height: number; src: string }>()

export default function Image({
  image: { url, blurHash, thumbHash, pubkey, dim },
  alt,
  className = '',
  classNames = {},
  hideIfError = false,
  errorPlaceholder = <ImageOff />,
  lockAspectRatio = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  classNames?: {
    wrapper?: string
    errorPlaceholder?: string
    skeleton?: string
  }
  image: TImetaInfo
  alt?: string
  hideIfError?: boolean
  errorPlaceholder?: React.ReactNode
  /**
   * Honor the caller's fixed design aspect ratio (set via `className`, e.g. a
   * banner's `aspect-3/1`) instead of writing the source image's natural ratio
   * as an inline style. Off by default: variable-height note rows want the
   * natural ratio so the virtualizer reserves the right height. On for surfaces
   * with a deliberate crop (profile banner), so every image renders at a uniform
   * height regardless of the source dimensions.
   */
  lockAspectRatio?: boolean
}) {
  const { allowInsecureConnection } = useUserPreferences()
  // If this URL already loaded once this session, paint it immediately on (re)mount
  // from its known-good src at its known size: no loading state, no skeleton, no
  // srcless frame. That's what keeps a scrolled-back row from collapsing or
  // flickering. Cold (uncached) images fall through to the spacer + skeleton +
  // fade-in path below.
  const cached = loadedImageDims.get(url)
  const [isLoading, setIsLoading] = useState(!cached)
  const [displaySkeleton, setDisplaySkeleton] = useState(!cached)
  const [hasError, setHasError] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | undefined>(cached?.src)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setHasError(false)

    // Cached fast path: initial state already paints the image from its known-good
    // src at its known size. Don't touch isLoading/imageUrl or we'd re-trigger the
    // loading dance and reintroduce the flicker.
    const c = loadedImageDims.get(url)
    if (c) {
      setIsLoading(false)
      setDisplaySkeleton(false)
      setImageUrl(c.src)
      return
    }

    setIsLoading(true)
    setDisplaySkeleton(true)

    if (!allowInsecureConnection && isInsecureUrl(url)) {
      setHasError(true)
      setIsLoading(false)
      return
    }

    if (pubkey) {
      blossomService.getValidUrl(url, pubkey).then((validUrl) => {
        setImageUrl(validUrl)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      })
      timeoutRef.current = setTimeout(() => {
        setImageUrl(url)
      }, 5000)
    } else {
      setImageUrl(url)
    }
  }, [url, allowInsecureConnection])

  if (hideIfError && hasError) return null

  const handleError = async () => {
    const nextUrl = await blossomService.tryNextUrl(url)
    if (nextUrl) {
      setImageUrl(nextUrl)
    } else {
      setIsLoading(false)
      setHasError(true)
    }
  }

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false)
    setHasError(false)
    setTimeout(() => setDisplaySkeleton(false), 600)
    const loadedSrc = imageUrl || url
    blossomService.markAsSuccess(url, loadedSrc)
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth > 0 && naturalHeight > 0) {
      loadedImageDims.set(url, { width: naturalWidth, height: naturalHeight, src: loadedSrc })
    }
  }

  // True pixel dimensions when we know them: imeta dims for a cold image, or the
  // natural size measured on a prior load (scroll-back). Used to lock the wrapper's
  // aspect ratio so its height is deterministic before the <img> decodes. Guard
  // against malformed imeta dims (0 or negative) that would yield an invalid ratio.
  const candidateDim = dim ?? cached
  const knownDim =
    candidateDim && candidateDim.width > 0 && candidateDim.height > 0 ? candidateDim : undefined
  // Cold-load spacer fallback for an image we've never seen and that carries no dims.
  const reservedDim = knownDim ?? { width: 4, height: 3 }

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl', classNames.wrapper)}
      {...props}
      // Reserve the row's height deterministically from known dimensions so the
      // virtualizer measures the correct height on the very first frame. Without
      // this, a scrolled-back image row depends on the <img> establishing its own
      // height asynchronously (even from cache), which re-measures and lurches the
      // feed. The ratio is exact (real pixels), so object-cover never crops.
      style={
        knownDim && !lockAspectRatio
          ? { ...props.style, aspectRatio: `${knownDim.width} / ${knownDim.height}` }
          : props.style
      }
    >
      {/* Cold-load spacer: only needed when the wrapper has no aspect-ratio to hold
          its height open (i.e. a never-seen image with no imeta dims). Reserves 4:3
          so the row doesn't grow when the image first loads. */}
      {isLoading && !knownDim && (
        <img
          src={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${reservedDim.width}' height='${reservedDim.height}'%3E%3C/svg%3E`}
          className={cn(
            'pointer-events-none h-full w-full object-cover transition-opacity',
            className
          )}
          alt=""
        />
      )}
      {displaySkeleton && (
        <div className="absolute inset-0 z-10">
          {thumbHash ? (
            <ThumbHashPlaceholder
              thumbHash={thumbHash}
              className={cn(
                'h-full w-full transition-opacity',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          ) : blurHash ? (
            <BlurHashCanvas
              blurHash={blurHash}
              className={cn(
                'h-full w-full transition-opacity',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          ) : (
            <Skeleton
              className={cn(
                'h-full w-full transition-opacity',
                isLoading ? 'opacity-100' : 'opacity-0',
                classNames.skeleton
              )}
            />
          )}
        </div>
      )}
      {!hasError && (
        <img
          src={imageUrl}
          alt={alt}
          decoding="async"
          draggable={false}
          {...props}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'pointer-events-none h-full w-full object-cover transition-opacity',
            isLoading ? cn('absolute inset-0', cached ? '' : 'opacity-0') : '',
            className
          )}
        />
      )}
      {hasError &&
        (typeof errorPlaceholder === 'string' ? (
          <img
            src={errorPlaceholder}
            alt={alt}
            decoding="async"
            loading="lazy"
            className={cn('h-full w-full object-cover transition-opacity', className)}
          />
        ) : (
          <div
            className={cn(
              'bg-muted flex h-full w-full flex-col items-center justify-center object-cover',
              className,
              classNames.errorPlaceholder
            )}
          >
            {errorPlaceholder}
          </div>
        ))}
    </div>
  )
}

const blurHashWidth = 32
const blurHashHeight = 32
function BlurHashCanvas({ blurHash, className = '' }: { blurHash: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const pixels = useMemo(() => {
    if (!blurHash) return null
    try {
      return decode(blurHash, blurHashWidth, blurHashHeight)
    } catch (error) {
      console.warn('Failed to decode blurhash:', error)
      return null
    }
  }, [blurHash])

  useEffect(() => {
    if (!pixels || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(blurHashWidth, blurHashHeight)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
  }, [pixels])

  if (!blurHash) return null

  return (
    <canvas
      ref={canvasRef}
      width={blurHashWidth}
      height={blurHashHeight}
      className={cn('h-full w-full rounded-xl object-cover', className)}
      style={{
        imageRendering: 'auto',
        filter: 'blur(0.5px)'
      }}
    />
  )
}

function ThumbHashPlaceholder({
  thumbHash,
  className = ''
}: {
  thumbHash: Uint8Array
  className?: string
}) {
  const dataUrl = useMemo(() => {
    if (!thumbHash) return null
    try {
      return thumbHashToDataURL(thumbHash)
    } catch (error) {
      console.warn('failed to decode thumbhash:', error)
      return null
    }
  }, [thumbHash])

  if (!dataUrl) return null

  return (
    <div
      className={cn('h-full w-full rounded-lg object-cover', className)}
      style={{
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'blur(1px)'
      }}
    />
  )
}
