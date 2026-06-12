import { Skeleton } from '@/components/ui/skeleton'
import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { isInsecureUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useMemo } from 'react'
import ExternalLink from '../ExternalLink'
import Image from '../Image'

export default function WebPreview({
  url,
  className,
  mustLoad
}: {
  url: string
  className?: string
  mustLoad?: boolean
}) {
  const { autoLoadMedia } = useContentPolicy()
  const { allowInsecureConnection } = useUserPreferences()
  const { title, description, image, isPending } = useFetchWebMetadata(url)

  const hostname = useMemo(() => {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  }, [url])

  if (!allowInsecureConnection && isInsecureUrl(url)) {
    return null
  }

  if (!autoLoadMedia && !mustLoad) {
    return null
  }

  if (!title) {
    // While the metadata fetch is in flight, reserve roughly the card's height
    // with a skeleton so the row doesn't grow and shove the virtualized feed when
    // the card pops in. Most previews carry an og:image, so we reserve the image
    // band plus a few text lines.
    if (isPending) {
      return (
        <div className={cn('overflow-hidden rounded-xl border', className)}>
          <Skeleton className="h-44 w-full rounded-none" />
          <div className="bg-muted w-full space-y-2 p-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      )
    }
    if (mustLoad) {
      return <ExternalLink url={url} justOpenLink />
    } else {
      return null
    }
  }

  return (
    <div
      className={cn('clickable overflow-hidden rounded-xl border', className)}
      onClick={(e) => {
        e.stopPropagation()
        window.open(url, '_blank')
      }}
    >
      {image && (
        <Image
          image={{ url: image }}
          className="h-44 w-full"
          classNames={{
            wrapper: 'rounded-none'
          }}
          hideIfError
        />
      )}
      <div className="bg-muted w-full p-2">
        <div className="text-muted-foreground truncate text-xs">{hostname}</div>
        <div className="line-clamp-2 font-semibold">{title}</div>
        {description && (
          <div className="text-muted-foreground line-clamp-3 text-xs">{description}</div>
        )}
      </div>
    </div>
  )
}
