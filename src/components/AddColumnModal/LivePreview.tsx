// src/components/AddColumnModal/LivePreview.tsx
import { SecondaryPageContext, useSecondaryPage } from '@/DeckManager'
import { AccountScope } from '@/providers/AccountScope'
import { TColumn, TColumnType } from '@/types/column'
import { ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { COLUMN_TYPES } from './column-types'

type Props = {
  type: TColumnType
  draft: Partial<TColumn>
}

export default function LivePreview({ type, draft }: Props) {
  const { t } = useTranslation()
  const desc = COLUMN_TYPES.find((d) => d.type === type)

  if (!desc) {
    return <PreviewEmpty hint={t('Unknown column type')} />
  }

  // The descriptor's predicate may be loose — guard the cast at this single
  // boundary so a buggy descriptor can't ship a malformed TColumn downstream.
  if (!desc.isReadyToPreview(draft) || !draft.id || !draft.viewContext || !draft.type) {
    return <PreviewEmpty hint={t(desc.previewHint)} />
  }

  const column = draft as TColumn

  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      {/* Mirror the deck-side <Column> width (400px) so the preview shows what
          the user will actually see, and so wide intrinsic content from media
          embeds clips at the column edge instead of escaping the modal.
          The `[&_.sticky]:!top-0` override re-anchors any descendant `sticky`
          tab bars (e.g. <Tabs>'s `sticky top-12` for the primary-page titlebar)
          to the top of the preview pane, since there's no titlebar here. */}
      <div className="mx-auto h-full w-[400px] max-w-full overflow-x-hidden overflow-y-auto [&_.sticky]:!top-0">
        {/* Read-only: PreviewSecondaryPage already swallows navigation, but
            Like / Zap / Reply / Repost / Pin / Mute / Bookmark / etc. publish
            via the signer directly without going through push(). Blocking
            pointer events on the preview subtree neutralizes ALL of those at
            once — the outer scroll container above stays interactive so the
            user can still scroll through the feed. `select-none` blocks the
            text-selection affordance too, which looks more clearly read-only.
            aria-disabled marks the subtree as non-interactive for AT users. */}
        <div className="pointer-events-none select-none" aria-disabled>
          {/* The preview is read-only — signingIdentity is null so it never
              registers a signer or attempts a publish. */}
          <AccountScope viewContext={column.viewContext} signingIdentity={null}>
            <PreviewSecondaryPage>
              <desc.PreviewBody column={column} />
            </PreviewSecondaryPage>
          </AccountScope>
        </div>
      </div>
    </div>
  )
}

function PreviewEmpty({ hint }: { hint: string }) {
  return (
    <div className="text-muted-foreground flex flex-1 items-center justify-center p-10 text-sm italic">
      {hint}
    </div>
  )
}

/**
 * Overrides the inherited SecondaryPageContext with no-op push/pop so clicks
 * on notes/profiles inside the preview don't trigger DeckManager's deck-home
 * interception (which would spawn transient columns). The preview is read-only.
 */
function PreviewSecondaryPage({ children }: { children: ReactNode }) {
  const parent = useSecondaryPage()
  const value = useMemo(() => ({ ...parent, push: () => {}, pop: () => {} }), [parent])
  return <SecondaryPageContext.Provider value={value}>{children}</SecondaryPageContext.Provider>
}
