import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from 'react-i18next'
import type { ConfigFormProps } from '../column-types'

/**
 * Config form for a Profile Search column. Single text input writing
 * `draft.config.relatrQuery`. Auto-focuses on mount; `isReadyToPreview` gates
 * the LivePreview until the trimmed query is non-empty.
 */
export default function RelatrQueryPicker({ draft, onChange }: ConfigFormProps) {
  const { t } = useTranslation()
  const query = draft.config?.relatrQuery ?? ''
  return (
    <div className="flex items-start gap-3">
      <Label
        htmlFor="relatr-query"
        className="text-muted-foreground w-20 shrink-0 pt-1.5 text-xs font-medium"
      >
        {t('Search keyword')}
      </Label>
      <div className="flex flex-1 flex-col gap-1.5">
        <Input
          id="relatr-query"
          autoFocus
          dir="auto"
          placeholder={t('Search profile names, bios, NIP-05…')}
          value={query}
          onChange={(e) =>
            onChange({
              ...draft,
              config: { ...draft.config, relatrQuery: e.target.value }
            })
          }
        />
        <p className="text-muted-foreground text-xs">
          {t('Searches profile metadata via Relatr. Results are ranked by trust score.')}
        </p>
      </div>
    </div>
  )
}
