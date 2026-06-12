// src/components/RankExplanationPopover/NoRankContent.tsx
//
// Shown when the user inspected has no Relatr rank yet (rank === null) OR
// when Relatr returned socialDistance === 1000 (no path found from root).
// Both treated as "stranger to Relatr" in v1.1 — UI distinguishes via copy.

import { Button } from '@/components/ui/button'
import { relatrComputeStateAtomFamily } from '@/atoms/relatr-compute'
import relatrTrust from '@/services/relatr-trust.service'
import { useAtomValue } from 'jotai'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  pubkey: string
  signerPubkey: string | null // null when view-only — disables compute CTA
}

export default function NoRankContent({ pubkey, signerPubkey }: Props) {
  const { t } = useTranslation()
  const computeState = useAtomValue(relatrComputeStateAtomFamily(pubkey))

  if (computeState === 'pending') {
    return (
      <div className="text-muted-foreground flex flex-col gap-2 p-4 text-xs">
        <div className="text-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-3.5 animate-spin" />
          {t('Calculating trust score…')}
        </div>
        <p>{t('Cold computes can take 30-60 seconds. Feel free to keep browsing.')}</p>
      </div>
    )
  }

  if (computeState === 'failed') {
    return (
      <div className="flex flex-col gap-2 p-4 text-xs">
        <p className="text-destructive">{t('Trust calculation failed.')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signerPubkey && relatrTrust.triggerCompute(pubkey, signerPubkey)}
          disabled={!signerPubkey}
          className="self-start"
        >
          {t('Try again')}
        </Button>
      </div>
    )
  }

  // Default: idle, no compute yet
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm">{t('Relatr has no trust data for this user.')}</p>
      {signerPubkey ? (
        <Button
          variant="default"
          size="sm"
          onClick={() => relatrTrust.triggerCompute(pubkey, signerPubkey)}
          className="self-start"
        >
          {t('Calculate trust')}
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">{t('Sign in to look up trust data.')}</p>
      )}
      <p className="text-muted-foreground text-[10px]">
        {t("Adds to Relatr's public index.")}
      </p>
    </div>
  )
}
