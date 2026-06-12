import { cn } from '@/lib/utils'
import JankMark from '@/components/JankMark'

/**
 * Collapsed-sidebar mark — `<JankMark>` at icon size. The mark's triangle
 * stroke inherits `currentColor` so it themes with the surrounding icon color.
 *
 * To be replaced by the commissioned mark when the branding study lands.
 */
export default function Icon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex items-center justify-center select-none', className)}
    >
      <JankMark size={32} />
    </span>
  )
}
