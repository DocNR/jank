import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export default function EmojiPickerSearch({
  value,
  onChange,
  autoFocus
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  return (
    <div className="relative flex-1">
      <Search className="text-muted-foreground pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('Search emojis')}
        className="h-10 ps-8 pe-8"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute end-2 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded"
          aria-label={t('Clear')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
