import { cn } from '@/lib/utils'
import JankMark from '@/components/JankMark'

/**
 * Wordmark used in the expanded sidebar. Uppercase "JANK" with tight
 * tracking. Paired with a placeholder `<JankMark>` glyph. The mark's
 * stroke inherits `currentColor` and the wordmark inherits text color,
 * so theme switching continues to drive presentation.
 *
 * To be paired with the commissioned mark when the branding study lands.
 */
export default function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 select-none', className)}>
      <JankMark size={32} />
      {/* Literal — intentionally not `BRAND.name`. The wordmark's visual
          identity is the uppercase form; if the brand name ever changes,
          update this explicitly rather than auto-recasing BRAND.name. */}
      <span className="text-2xl leading-none font-bold tracking-[0.02em]">JANK</span>
    </span>
  )
}
