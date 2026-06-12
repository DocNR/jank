import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'
import { useMemo } from 'react'

export default function Stars({ stars, className }: { stars: number; className?: string }) {
  const roundedStars = useMemo(() => Math.round(stars), [stars])

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {Array.from({ length: 5 }).map((_, index) =>
        index < roundedStars ? (
          <Star key={index} className="fill-foreground text-foreground size-4" />
        ) : (
          <Star key={index} className="text-muted-foreground size-4" />
        )
      )}
    </div>
  )
}
