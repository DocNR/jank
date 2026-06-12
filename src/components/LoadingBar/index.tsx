import { cn } from '@/lib/utils'

export function LoadingBar({ className }: { className?: string }) {
  return (
    <div className={cn('h-0.5 w-full overflow-hidden', className)}>
      <div
        className="animate-shimmer from-primary/40 via-primary to-primary/40 h-full w-full bg-linear-to-r from-25% via-50% to-75%"
        style={{
          backgroundSize: '400% 100%'
        }}
      />
    </div>
  )
}
