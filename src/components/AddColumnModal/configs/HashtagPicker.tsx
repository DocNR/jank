import { normalizeHashtag } from '@/lib/hashtag'
import { X } from 'lucide-react'
import { KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigFormProps } from '../column-types'

/**
 * Config form for the Hashtag column: a chip input. Typing a tag and pressing
 * Enter / comma / space commits it (normalized + deduped via `normalizeHashtag`);
 * each chip has an × to remove it, and Backspace on an empty input removes the
 * last chip. Writes `draft.config.hashtags`.
 */
export default function HashtagPicker({ draft, onChange }: ConfigFormProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const hashtags = draft.config?.hashtags ?? []

  const commit = (raw: string) => {
    const normalized = normalizeHashtag(raw)
    setInput('')
    if (!normalized || hashtags.includes(normalized)) return
    onChange({ ...draft, config: { ...draft.config, hashtags: [...hashtags, normalized] } })
  }

  const removeAt = (idx: number) => {
    onChange({
      ...draft,
      config: { ...draft.config, hashtags: hashtags.filter((_, i) => i !== idx) }
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      commit(input)
      return
    }
    if (e.key === 'Backspace' && input === '' && hashtags.length > 0) {
      e.preventDefault()
      removeAt(hashtags.length - 1)
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div className="text-muted-foreground w-20 shrink-0 pt-1.5 text-xs font-medium">
        {t('Hashtags')}
      </div>
      <div className="border-border bg-background flex flex-1 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
        {hashtags.map((tag, idx) => (
          <span
            key={tag}
            dir="auto"
            className="bg-muted text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm"
          >
            #{tag}
            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('Remove')}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          dir="auto"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(input)}
          placeholder={hashtags.length === 0 ? t('Add hashtags…') : ''}
          className="min-w-24 flex-1 bg-transparent text-sm outline-hidden"
          autoFocus
        />
      </div>
    </div>
  )
}
