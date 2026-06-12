import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/context-vm-client.service', () => {
  return {
    default: {
      callTool: vi.fn()
    }
  }
})

vi.mock('@/services/indexed-db.service', () => {
  return {
    default: {
      getRelatrMetadata: vi.fn(),
      putRelatrMetadata: vi.fn()
    }
  }
})

import contextVmClient from '@/services/context-vm-client.service'
import indexedDb from '@/services/indexed-db.service'
import relatrMetadata from '../relatr-metadata.service'

const SIGNER = 'a'.repeat(64)

const STATS_RESPONSE = {
  ok: true as const,
  structuredContent: {
    timestamp: 1779600000,
    sourcePubkey: '750682303c9f0dda',
    relatrVersion: '0.11.2',
    isAdmin: false,
    database: { metrics: { totalEntries: 100 }, metadata: { totalEntries: 50 } },
    socialGraph: {
      stats: { users: 12847, follows: 1200000 },
      rootPubkey: 'root-pubkey-hex'
    }
  }
}

const PLUGINS_RESPONSE = {
  ok: true as const,
  structuredContent: {
    plugins: [
      {
        pluginKey: 'follower_count',
        name: 'follower_count',
        title: 'Follower Count',
        description: 'Score from trusted-graph follower count',
        enabled: true,
        effectiveWeight: 0.4,
        pubkey: 'plugin-pubkey',
        installedEventId: 'event-id',
        createdAt: 1779000000
      }
    ]
  }
}

describe('relatrMetadata.getStats', () => {
  beforeEach(() => {
    relatrMetadata._resetForTests()
    ;(indexedDb.getRelatrMetadata as any).mockResolvedValue(null)
    ;(indexedDb.putRelatrMetadata as any).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches via MCP when no cache exists', async () => {
    ;(contextVmClient.callTool as any).mockResolvedValue(STATS_RESPONSE)
    const result = await relatrMetadata.getStats(SIGNER)
    expect(result?.relatrVersion).toBe('0.11.2')
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      expect.any(String),
      'stats',
      {},
      { signerPubkey: SIGNER }
    )
  })

  it('returns IDB-cached stats when fresh (< 3 days old)', async () => {
    const fresh = {
      cachedAt: Date.now() - 1000 * 60 * 60,
      value: STATS_RESPONSE.structuredContent
    }
    ;(indexedDb.getRelatrMetadata as any).mockResolvedValue(fresh)
    const result = await relatrMetadata.getStats(SIGNER)
    expect(result?.relatrVersion).toBe('0.11.2')
    expect(contextVmClient.callTool).not.toHaveBeenCalled()
  })

  it('re-fetches when IDB cache is stale (> 3 days old)', async () => {
    const stale = {
      cachedAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
      value: STATS_RESPONSE.structuredContent
    }
    ;(indexedDb.getRelatrMetadata as any).mockResolvedValue(stale)
    ;(contextVmClient.callTool as any).mockResolvedValue(STATS_RESPONSE)
    await relatrMetadata.getStats(SIGNER)
    expect(contextVmClient.callTool).toHaveBeenCalled()
  })

  it('returns null when MCP call errors out', async () => {
    ;(contextVmClient.callTool as any).mockResolvedValue({
      ok: false,
      error: { code: -32603, message: 'fail' }
    })
    const result = await relatrMetadata.getStats(SIGNER)
    expect(result).toBe(null)
  })
})

describe('relatrMetadata.getPlugins', () => {
  beforeEach(() => {
    relatrMetadata._resetForTests()
    ;(indexedDb.getRelatrMetadata as any).mockResolvedValue(null)
    ;(indexedDb.putRelatrMetadata as any).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches plugins via MCP with verbose:true', async () => {
    ;(contextVmClient.callTool as any).mockResolvedValue(PLUGINS_RESPONSE)
    const result = await relatrMetadata.getPlugins(SIGNER)
    expect(result?.length).toBe(1)
    expect(result?.[0].pluginKey).toBe('follower_count')
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      expect.any(String),
      'plugins_list',
      { verbose: true },
      { signerPubkey: SIGNER }
    )
  })

  it('returns IDB-cached plugins when fresh', async () => {
    const fresh = {
      cachedAt: Date.now() - 1000 * 60 * 60,
      value: PLUGINS_RESPONSE.structuredContent.plugins
    }
    ;(indexedDb.getRelatrMetadata as any).mockResolvedValue(fresh)
    const result = await relatrMetadata.getPlugins(SIGNER)
    expect(result?.length).toBe(1)
    expect(contextVmClient.callTool).not.toHaveBeenCalled()
  })
})
