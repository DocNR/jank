import { SimpleUsername } from '@/components/Username'
import { pubkeyToHsl } from '@/lib/pubkey'
import { Eye, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { signingState } from './signing-state'

/**
 * The always-on, differentiated signing indicator for a column header.
 *
 * - quiet: the column signs as its own account — a muted "✍ <name>" chip.
 * - loud: the column signs as a *different* account (the mis-sign safety
 *   case) — a signing-hue "● Acting as <name>" chip. This is the styling of
 *   the previous inline "Acting as" badge; the header now places it on its
 *   own full-width second row.
 * - view-only: no paired signing account on this device — a muted
 *   "👁 View-only" chip.
 *
 * Placement (inline on row 1 vs full-width row 2) is the header's decision;
 * this component only renders the chip for the current state.
 */
export default function SigningIndicator({
  viewContext,
  signingIdentity,
  baselinePubkey
}: {
  viewContext: string
  signingIdentity: string | null
  /** Optional override for the "quiet baseline" — defaults to viewContext.
   * Profile columns pass the viewer's active account so a normally-opened
   * profile column reads as quiet (signing as you), not as a definitional
   * mismatch. */
  baselinePubkey?: string
}) {
  const { t } = useTranslation()
  const state = signingState(viewContext, signingIdentity, baselinePubkey)

  if (state === 'view-only') {
    return (
      <span className="text-muted-foreground bg-muted flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none font-medium">
        <Eye className="size-3 shrink-0" />
        {t('View-only')}
      </span>
    )
  }

  if (state === 'quiet') {
    // signingIdentity is non-null in the quiet branch by definition. Render the
    // SIGNER, not viewContext — these are equal for paired-account Home /
    // Notifications / Bookmarks / Hashtag columns (no visible difference there),
    // but they diverge for a normally-opened profile column, where the subject
    // (viewContext) and the signer differ but the state is still quiet.
    return (
      <span className="text-muted-foreground bg-muted flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none font-medium">
        <PenLine className="size-3 shrink-0" />
        <SimpleUsername userId={signingIdentity!} className="max-w-20 truncate" withoutSkeleton />
      </span>
    )
  }

  // state === 'loud' — signs as a different account; signingIdentity is non-null here.
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none font-bold"
      style={{
        backgroundColor: pubkeyToHsl(signingIdentity!, 0.16),
        color: pubkeyToHsl(signingIdentity!)
      }}
      title={t('Actions in this column sign as a different account')}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: 'currentColor' }}
        aria-hidden
      />
      <span className="shrink-0">{t('Acting as')}</span>
      <SimpleUsername userId={signingIdentity!} className="max-w-20 truncate" withoutSkeleton />
    </span>
  )
}
