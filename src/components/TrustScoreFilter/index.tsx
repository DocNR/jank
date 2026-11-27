import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Shield, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TRUST_LEVELS = [
  { value: 0, label: 'trust-filter.off' },
  { value: 60, label: 'trust-filter.low' },
  { value: 80, label: 'trust-filter.medium' },
  { value: 90, label: 'trust-filter.high' },
  { value: 100, label: 'trust-filter.wot' }
]

function getDescription(score: number, t: (key: string, options?: any) => string) {
  if (score === 0) {
    return t('trust-filter.show-all-content')
  } else if (score === 100) {
    return t('trust-filter.only-show-wot')
  } else {
    return t('trust-filter.hide-bottom-percent', { score })
  }
}

/**
 * Shield badge + popover controlling one trust-score filter threshold
 * (0-100 percentile). Off (0) shows everyone; WoT (100) shows only the 2-hop
 * Web of Trust; in between hides authors whose Relatr rank falls in the
 * bottom `score`% (accounts with no Relatr rank count as rank 0, so a
 * threshold on hides fresh throwaway spam). Matches upstream Jumble's
 * TrustScoreFilter behavior.
 *
 * Stateless by design: the caller owns the value — deck columns pass their
 * `config.trustScoreThreshold` (falling back to the global default), and
 * non-column views pass their TRUST_SCORE_FILTER_ID slot from the provider.
 */
export default function TrustScoreFilter({
  value,
  onChange,
  onOpenChange
}: {
  value: number
  onChange: (score: number) => void
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)
  const [temporaryScore, setTemporaryScore] = useState(value)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setTemporaryScore(value)
  }, [value])

  // Debounced so dragging the slider doesn't write state on every tick.
  const handleScoreChange = (newScore: number) => {
    setTemporaryScore(newScore)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      onChange(newScore)
    }, 300)
  }

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const description = getDescription(temporaryScore, t)

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'relative size-9 sm:size-7',
        temporaryScore === 0
          ? 'text-muted-foreground hover:text-foreground'
          : 'text-primary hover:text-primary-hover'
      )}
      aria-label={t('trust-filter.title')}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        setOpen(true)
      }}
    >
      {temporaryScore < 100 ? <Shield className="size-4" /> : <ShieldCheck className="size-4" />}
      {temporaryScore > 0 && temporaryScore < 100 && (
        <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center font-mono text-[0.5rem] font-bold">
          {temporaryScore}
        </div>
      )}
    </Button>
  )

  const content = (
    <>
      {/* Slider */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-sm">
            {t('trust-filter.filter-threshold')}
          </span>
          <span className="text-primary text-lg font-semibold">
            {temporaryScore === 0 ? t('trust-filter.off') : `${temporaryScore}%`}
          </span>
        </div>
        <Slider
          value={[temporaryScore]}
          onValueChange={([value]) => handleScoreChange(value)}
          min={0}
          max={100}
          step={5}
          className="w-full"
        />
      </div>

      {/* Quick presets */}
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs">{t('trust-filter.quick-presets')}</div>
        <div className="flex flex-wrap gap-1.5">
          {TRUST_LEVELS.map((level) => (
            <button
              key={level.value}
              onClick={() => handleScoreChange(level.value)}
              className={cn(
                'flex-1 rounded px-2 py-1.5 text-center text-xs transition-all duration-200',
                temporaryScore === level.value
                  ? 'bg-primary text-primary-foreground font-medium shadow-xs'
                  : 'bg-secondary hover:bg-secondary/80 hover:scale-[1.02] hover:shadow-xs'
              )}
            >
              {t(level.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1 border-t pt-2">
        <div className="text-foreground text-sm font-medium">{description}</div>
        <div className="text-muted-foreground text-xs">
          {t('trust-filter.trust-score-description')}
        </div>
      </div>
    </>
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-lg px-4">
            <DialogHeader>
              <DialogTitle className="text-base">{t('trust-filter.title')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pb-4">{content}</div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-96 space-y-4 p-4" collisionPadding={16} sideOffset={0}>
        {content}
      </PopoverContent>
    </Popover>
  )
}
