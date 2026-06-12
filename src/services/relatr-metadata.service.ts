// src/services/relatr-metadata.service.ts
//
// Caches Relatr's self-describing data (stats + plugins_list) for the
// RankExplanationPopover MAXIMAL tier. IndexedDB-persisted with 3-day TTL.
// Each call costs ONE Clave sign_event prompt on cache miss; cached
// across reloads to amortize that cost over ~3 days.
//
// Spec: docs/superpowers/specs/2026-05-25-path-b-fayan-to-relatr-trust-swap-design.md §6.3

import { RELATR_PUBKEY } from '@/lib/relatr'
import contextVmClient from './context-vm-client.service'
import indexedDb from './indexed-db.service'

const STATS_KEY = 'stats'
const PLUGINS_KEY = 'plugins'
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 days, matches relatrTrust

export type TRelatrStats = {
  timestamp: number
  sourcePubkey: string
  relatrVersion: string
  isAdmin: boolean
  database: { metrics: { totalEntries: number }; metadata: { totalEntries: number } }
  socialGraph: {
    stats: { users: number; follows: number }
    rootPubkey: string
  }
}

export type TRelatrPlugin = {
  pluginKey: string
  name: string
  title?: string | null
  description?: string | null
  enabled: boolean
  effectiveWeight: number
  pubkey?: string
  versionInfo?: string
  defaultWeight?: number | null
  installedEventId?: string
  createdAt?: number
}

type TCacheEnvelope<T> = {
  cachedAt: number // milliseconds (Date.now())
  value: T
}

export interface IRelatrMetadataService {
  getStats(signerPubkey: string): Promise<TRelatrStats | null>
  getPlugins(signerPubkey: string): Promise<TRelatrPlugin[] | null>
  _resetForTests(): void
}

class RelatrMetadataService implements IRelatrMetadataService {
  private statsInFlight: Promise<TRelatrStats | null> | null = null
  private pluginsInFlight: Promise<TRelatrPlugin[] | null> | null = null

  async getStats(signerPubkey: string): Promise<TRelatrStats | null> {
    const cached = await indexedDb.getRelatrMetadata<TCacheEnvelope<TRelatrStats>>(STATS_KEY)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value
    }
    if (this.statsInFlight) return this.statsInFlight
    this.statsInFlight = (async () => {
      const result = await contextVmClient.callTool<TRelatrStats>(
        RELATR_PUBKEY,
        'stats',
        {},
        { signerPubkey }
      )
      if (!result.ok) return null
      const envelope: TCacheEnvelope<TRelatrStats> = {
        cachedAt: Date.now(),
        value: result.structuredContent
      }
      indexedDb.putRelatrMetadata(STATS_KEY, envelope).catch(() => {})
      return result.structuredContent
    })()
    try {
      return await this.statsInFlight
    } finally {
      this.statsInFlight = null
    }
  }

  async getPlugins(signerPubkey: string): Promise<TRelatrPlugin[] | null> {
    const cached = await indexedDb.getRelatrMetadata<TCacheEnvelope<TRelatrPlugin[]>>(PLUGINS_KEY)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value
    }
    if (this.pluginsInFlight) return this.pluginsInFlight
    this.pluginsInFlight = (async () => {
      const result = await contextVmClient.callTool<{ plugins: TRelatrPlugin[] }>(
        RELATR_PUBKEY,
        'plugins_list',
        { verbose: true },
        { signerPubkey }
      )
      if (!result.ok) return null
      const envelope: TCacheEnvelope<TRelatrPlugin[]> = {
        cachedAt: Date.now(),
        value: result.structuredContent.plugins
      }
      indexedDb.putRelatrMetadata(PLUGINS_KEY, envelope).catch(() => {})
      return result.structuredContent.plugins
    })()
    try {
      return await this.pluginsInFlight
    } finally {
      this.pluginsInFlight = null
    }
  }

  _resetForTests(): void {
    this.statsInFlight = null
    this.pluginsInFlight = null
  }
}

const instance = new RelatrMetadataService()
export default instance
