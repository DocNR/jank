import { TDvmStatusMessage } from '@/lib/dvm'
import { cn } from '@/lib/utils'
import { AlertTriangle, CircleDot, CircleCheck, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Inline banner above the feed surfacing the DVM's latest kind-7000 status.
 *
 * Per NIP-90 status semantics:
 *   - payment-required: the DVM wants payment before producing results
 *   - processing      : a result is coming
 *   - error           : the job failed
 *   - partial         : results streaming in
 *   - success         : result published (we treat 6300 as the success signal —
 *                       this banner mainly matters for the in-flight states)
 *
 * No in-app Lightning flow in v1 — `payment-required` just shows the message;
 * the user must pay out-of-band via whatever the DVM advertises.
 */
export default function DvmFeedStatusBanner({ status }: { status: TDvmStatusMessage }) {
  const { t } = useTranslation()
  const config = bannerConfig(status.status)
  return (
    <div className={cn('flex items-start gap-2 border-b px-3 py-2 text-xs', config.tone)}>
      <config.icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium leading-tight">{t(config.label)}</span>
        {status.message && (
          <span className="text-muted-foreground leading-snug" dir="auto">
            {status.message}
          </span>
        )}
      </div>
    </div>
  )
}

function bannerConfig(status: TDvmStatusMessage['status']) {
  switch (status) {
    case 'payment-required':
      return { icon: Wallet, label: 'Payment required', tone: 'bg-amber-500/10 text-amber-700' }
    case 'processing':
      return { icon: CircleDot, label: 'Processing…', tone: 'bg-muted/40 text-muted-foreground' }
    case 'partial':
      return { icon: CircleDot, label: 'Partial results', tone: 'bg-muted/40 text-muted-foreground' }
    case 'error':
      return {
        icon: AlertTriangle,
        label: 'DVM error',
        tone: 'bg-destructive/10 text-destructive'
      }
    case 'success':
      return {
        icon: CircleCheck,
        label: 'Done',
        tone: 'bg-muted/40 text-muted-foreground'
      }
  }
}
