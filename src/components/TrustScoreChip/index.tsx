import RankExplanationPopover from '@/components/RankExplanationPopover'
import { relatrComputeStateAtomFamily } from '@/atoms/relatr-compute'
import { cn } from '@/lib/utils'
import relatrTrust from '@/services/relatr-trust.service'
import { useAtomValue } from 'jotai'
import { ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trustChipState } from './trust-chip-state'

export default function TrustScoreChip({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const [rank, setRank] = useState<number | null | undefined>(() => relatrTrust.peekRank(pubkey))
  // Subscribe to this pubkey's compute state so the chip re-reads its rank when
  // an on-demand "Calculate trust" finishes. triggerCompute writes the fresh
  // rank into relatrTrust's cache before flipping this atom to 'idle', so adding
  // computeState to the effect deps below makes the chip flip from the ?-shield
  // to the score without a remount. Mirrors RankExplanationPopover's pattern.
  const computeState = useAtomValue(relatrComputeStateAtomFamily(pubkey))

  useEffect(() => {
    let mounted = true
    setRank(relatrTrust.peekRank(pubkey))
    if (relatrTrust.peekRank(pubkey) === undefined) {
      relatrTrust.getRank(pubkey).then((r) => {
        if (mounted) setRank(r)
      })
    }
    return () => {
      mounted = false
    }
  }, [pubkey, computeState])

  const state = trustChipState(rank)
  if (state === 'none') return null

  if (state === 'score') {
    return (
      <RankExplanationPopover pubkey={pubkey}>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold"
          aria-label={`${t('Trust rank')}: ${rank}`}
          onClick={(e) => e.stopPropagation()}
        >
          <ShieldCheck className="size-3" />
          {rank}
        </button>
      </RankExplanationPopover>
    )
  }

  // state === 'calculate' — unranked (offer on-demand compute for anyone)
  return (
    <RankExplanationPopover pubkey={pubkey}>
      <button
        type="button"
        className={cn(
          'text-muted-foreground/60 hover:text-foreground inline-flex shrink-0 items-center rounded-full px-1 py-0.5'
        )}
        aria-label={t('Calculate trust')}
        onClick={(e) => e.stopPropagation()}
      >
        <ShieldQuestion className="size-3.5" />
      </button>
    </RankExplanationPopover>
  )
}
