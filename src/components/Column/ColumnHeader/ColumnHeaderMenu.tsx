import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { AlignJustify, Ellipsis, LayoutList, PencilLine, Shield, ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The column header's "⋯" overflow menu — holds the secondary per-column
 * actions (compose, list-style toggle, WoT-only toggle) so the header bar
 * stays to label + signing indicator + 📌 + ⋯ + ✕.
 *
 * The header only renders this when at least one item would show (see
 * `showMenu` in ColumnHeader), so the menu is never empty.
 */
export default function ColumnHeaderMenu({
  showCompose,
  onCompose,
  effectiveListStyle,
  onToggleListStyle,
  wotOnly,
  onToggleWotOnly
}: {
  /** Whether the "New post" item is shown — false on view-only columns. */
  showCompose: boolean
  /** Opens the composer (already wrapped in checkLogin by the header). */
  onCompose: () => void
  /** List-style columns only: the effective list style + its toggle. When
   *  either is undefined the toggle item is not rendered. */
  effectiveListStyle?: 'compact' | 'detailed'
  onToggleListStyle?: () => void
  /** WoT-toggle columns only (hashtag/search/relay): current value + handler.
   *  When `onToggleWotOnly` is undefined the toggle item is not rendered. */
  wotOnly?: boolean
  onToggleWotOnly?: () => void
}) {
  const { t } = useTranslation()
  const showListStyleToggle = !!effectiveListStyle && !!onToggleListStyle
  const nextListStyleLabel =
    effectiveListStyle === 'compact' ? t('Detailed view') : t('Compact view')
  const showWotToggle = !!onToggleWotOnly
  const wotLabel = wotOnly ? t('Show everyone') : t('Show only WoT')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-9 sm:size-7"
          aria-label={t('More')}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showCompose && (
          <DropdownMenuItem onClick={onCompose}>
            <PencilLine />
            {t('New post')}
          </DropdownMenuItem>
        )}
        {showListStyleToggle && (
          <DropdownMenuItem onClick={onToggleListStyle}>
            {effectiveListStyle === 'compact' ? <LayoutList /> : <AlignJustify />}
            {nextListStyleLabel}
          </DropdownMenuItem>
        )}
        {showWotToggle && (
          <DropdownMenuItem onClick={onToggleWotOnly}>
            {wotOnly ? <ShieldOff /> : <Shield />}
            {wotLabel}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
