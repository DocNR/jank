// src/components/RankExplanationPopover/MaximalContent.tsx
//
// MAXIMAL tier expand of the rank-explanation popover. Shows Relatr's
// scoring plugins (active list + weights) and the per-user plugin scores
// (re-displayed from the BALANCED tier's validators data, joined with
// the plugin metadata).
//
// Triggers 2 MCP calls (stats() + plugins_list({verbose:true})) if not
// already IndexedDB-cached. Both cached for 3 days.

import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TRelatrPlugin, TRelatrStats } from '@/services/relatr-metadata.service'
import type { TBalancedScore } from './BalancedContent'

type Props = {
  data: TBalancedScore | null // for per-user plugin scores (validators)
  stats: TRelatrStats | null
  plugins: TRelatrPlugin[] | null
  loading: boolean
  error: string | null
}

export default function MaximalContent({ data, stats, plugins, loading, error }: Props) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-4 pb-4 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t('Fetching Relatr details (2 prompts)…')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-destructive px-4 pb-4 text-xs">
        {t('Failed to load details — retry')}
      </div>
    )
  }

  if (!stats || !plugins) return null

  const activePlugins = plugins.filter((p) => p.enabled)

  return (
    <div className="flex flex-col gap-2 px-4 pb-4 text-xs">
      <div className="bg-border h-px" />

      {/* Relatr metadata */}
      <div>
        <span className="font-medium">Relatr v{stats.relatrVersion}</span>
      </div>
      <div className="text-muted-foreground">
        {t('Graph: {{users}} users · {{follows}} follows', {
          users: stats.socialGraph.stats.users.toLocaleString(),
          follows: stats.socialGraph.stats.follows.toLocaleString()
        })}
      </div>

      {/* Active plugins with weights */}
      <div className="mt-2 font-medium">
        {t('Active scoring plugins ({{count}}):', { count: activePlugins.length })}
      </div>
      <ul className="ms-3 flex flex-col gap-0.5">
        {activePlugins.map((p) => (
          <li key={p.pluginKey} className="flex items-center justify-between">
            <span>• {p.title ?? p.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {Math.round(p.effectiveWeight * 100)}% weight
            </span>
          </li>
        ))}
      </ul>

      {/* Per-user plugin scores (from BALANCED tier's validators data) */}
      {data && Object.keys(data.components.validators).length > 0 && (
        <>
          <div className="mt-2 font-medium">{t('Plugin scores for this user:')}</div>
          <ul className="ms-3 flex flex-col gap-0.5">
            {Object.entries(data.components.validators).map(([name, val]) => (
              <li key={name} className="flex items-center gap-2">
                <span className="font-medium">{name}:</span>
                <span className="text-muted-foreground tabular-nums">{val.score.toFixed(2)}</span>
                <span className="text-muted-foreground truncate">→ {val.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
