import { cn } from '@/lib/utils'
import { FileQuestion, Heart, LucideIcon, Zap } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import ClientSelect from '../ClientSelect'

type KindMeta = {
  icon: LucideIcon
  label: (event: Event, t: TFunction) => string
}

const KIND_LABELS: Record<number, KindMeta> = {
  [kinds.Zap]: {
    icon: Zap,
    label: (event, t) => {
      const sats = extractZapSats(event)
      return sats
        ? t('zap receipt · {{sats}} sats', { sats: sats.toLocaleString() })
        : t('zap receipt')
    }
  },
  [kinds.Reaction]: {
    icon: Heart,
    label: (event, t) =>
      event.content && event.content !== '+'
        ? t('reaction · {{content}}', { content: event.content })
        : t('reaction')
  }
}

// bolt11 amount multipliers → sats per unit
// 1 BTC = 100,000,000 sats; m = mBTC, u = µBTC, n = nBTC, p = pBTC
const BOLT11_MULTIPLIER: Record<string, number> = {
  '': 100_000_000,
  m: 100_000,
  u: 100,
  n: 0.1,
  p: 0.0001
}

function extractZapSats(event: Event): number | undefined {
  const bolt11 = event.tags.find(([tag]) => tag === 'bolt11')?.[1]
  if (!bolt11) return undefined
  const match = bolt11.match(/^lnbc(\d+)([munp]?)/i)
  if (!match) return undefined
  const amount = parseInt(match[1], 10)
  if (isNaN(amount)) return undefined
  const mul = BOLT11_MULTIPLIER[(match[2] ?? '').toLowerCase()]
  if (mul === undefined) return undefined
  return Math.round(amount * mul)
}

export default function UnknownNote({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const meta = KIND_LABELS[event.kind] ?? {
    icon: FileQuestion,
    label: (_event: Event, tt: TFunction) => tt('kind {{kind}}', { kind: event.kind })
  }
  const Icon = meta.icon
  const label = meta.label(event, t)

  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center gap-2 text-sm',
        className
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <div className="ms-auto shrink-0">
        <ClientSelect
          event={event}
          trigger={
            <button type="button" className="text-xs hover:underline">
              {t('open')}
            </button>
          }
        />
      </div>
    </div>
  )
}
