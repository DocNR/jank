import { describe, expect, it } from 'vitest'
import type { TAccountWorkspace, TColumn, TDeck, TPairedAgent } from '@/types/column'
import { DECK_TOMBSTONE_TTL_MS, mergePairedAgents, mergeRemoteWorkspace } from '@/services/deck-sync-merge'

const col = (id = 'c'): TColumn => ({ id, viewContext: 'pk', signingIdentity: 'pk', type: 'home' })
const deck = (over: Partial<TDeck> & { id: string }): TDeck => ({
  name: over.id,
  columns: [col()],
  savedColumns: [col()],
  createdAt: 1,
  updatedAt: 1,
  lastSavedAt: 1,
  ...over
})
const ws = (activeDeckId: string, decks: TDeck[]): TAccountWorkspace => ({ activeDeckId, decks })

describe('mergeRemoteWorkspace', () => {
  it('no local workspace → takes remote wholesale (fresh device)', () => {
    const remote = ws('a', [deck({ id: 'a' })])
    expect(mergeRemoteWorkspace(undefined, remote)).toEqual({ merged: remote, conflicts: [] })
  })

  it('adds a deck that exists only remotely', () => {
    const local = ws('a', [deck({ id: 'a' })])
    const remote = ws('a', [deck({ id: 'a' }), deck({ id: 'b' })])
    const { merged, conflicts } = mergeRemoteWorkspace(local, remote)
    expect(merged.decks.map((d) => d.id)).toEqual(['a', 'b'])
    expect(conflicts).toEqual([])
  })

  it('updates an untouched local deck when remote is newer (lastSavedAt)', () => {
    const local = ws('a', [deck({ id: 'a', name: 'old', lastSavedAt: 1 })])
    const remote = ws('a', [deck({ id: 'a', name: 'new', lastSavedAt: 2 })])
    expect(mergeRemoteWorkspace(local, remote).merged.decks[0].name).toBe('new')
  })

  it('keeps an untouched local deck when local is newer/equal', () => {
    const local = ws('a', [deck({ id: 'a', name: 'mine', lastSavedAt: 5 })])
    const remote = ws('a', [deck({ id: 'a', name: 'theirs', lastSavedAt: 2 })])
    expect(mergeRemoteWorkspace(local, remote).merged.decks[0].name).toBe('mine')
  })

  it('keeps a locally-dirty deck and reports it as a conflict', () => {
    const dirty = deck({ id: 'a', columns: [col('x'), col('y')], savedColumns: [col('x')], lastSavedAt: 1 })
    const local = ws('a', [dirty])
    const remote = ws('a', [deck({ id: 'a', name: 'theirs', lastSavedAt: 9 })])
    const { merged, conflicts } = mergeRemoteWorkspace(local, remote)
    expect(merged.decks[0].columns.map((c) => c.id)).toEqual(['x', 'y']) // local edits preserved
    expect(conflicts.map((d) => d.id)).toEqual(['a'])
  })

  it('keeps a local-only deck with no tombstone (newly created, not yet synced)', () => {
    const local = ws('a', [deck({ id: 'a' }), deck({ id: 'local-only' })])
    const remote = ws('a', [deck({ id: 'a' })])
    expect(mergeRemoteWorkspace(local, remote).merged.decks.map((d) => d.id)).toContain('local-only')
  })

  it('repairs a dangling activeDeckId via fallback', () => {
    const local: TAccountWorkspace = { activeDeckId: 'ghost', decks: [deck({ id: 'a' })] }
    const remote = ws('a', [deck({ id: 'a' })])
    expect(mergeRemoteWorkspace(local, remote).merged.activeDeckId).toBe('a')
  })

  const NOW = 1_700_000_000_000 // fixed "now" for deterministic GC

  it('drops a tombstoned deck that was deleted after its last save (delete propagates)', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' })],
      deletedDecks: { b: NOW - 1000 }
    }
    const remote = ws('a', [deck({ id: 'a' }), deck({ id: 'b', lastSavedAt: NOW - 5000 })])
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toEqual(['a'])
    expect(merged.deletedDecks).toEqual({ b: NOW - 1000 })
  })

  it('does not resurrect: remote re-introduces a deck the local tombstone covers', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' }), deck({ id: 'b', lastSavedAt: NOW - 5000 })],
      deletedDecks: { b: NOW - 1000 }
    }
    const remote = ws('a', [deck({ id: 'a' })])
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toEqual(['a'])
  })

  it('resurrects a tombstoned deck saved AFTER the delete (LWW) and clears its tombstone', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' })],
      deletedDecks: { b: NOW - 1000 }
    }
    const remote = ws('a', [deck({ id: 'a' }), deck({ id: 'b', lastSavedAt: NOW })])
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toEqual(['a', 'b'])
    expect(merged.deletedDecks).toBeUndefined()
  })

  it('keeps a tombstoned-but-dirty local deck and reports it as a conflict', () => {
    const dirty = deck({
      id: 'b',
      columns: [col('x'), col('y')],
      savedColumns: [col('x')],
      lastSavedAt: NOW - 5000
    })
    const local: TAccountWorkspace = {
      activeDeckId: 'b',
      decks: [deck({ id: 'a' }), dirty],
      deletedDecks: { b: NOW - 1000 }
    }
    const remote = ws('a', [deck({ id: 'a' })])
    const { merged, conflicts } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toContain('b')
    expect(conflicts.map((d) => d.id)).toContain('b')
    expect(merged.deletedDecks).toBeUndefined()
  })

  it('keeps a local-only deck that is tombstoned but dirty, reporting it as a conflict', () => {
    const dirty = deck({
      id: 'b',
      columns: [col('x'), col('y')],
      savedColumns: [col('x')],
      lastSavedAt: NOW - 5000
    })
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' }), dirty], // 'b' is local-only (absent from remote) + tombstoned
      deletedDecks: { b: NOW - 1000 }
    }
    const remote = ws('a', [deck({ id: 'a' })])
    const { merged, conflicts } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toContain('b')
    expect(conflicts.map((d) => d.id)).toContain('b')
    expect(merged.deletedDecks).toBeUndefined()
  })

  it('unions tombstones taking the max timestamp', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' })],
      deletedDecks: { x: NOW - 100, y: NOW - 9000 }
    }
    const remote: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' })],
      deletedDecks: { x: NOW - 5000, z: NOW - 7000 }
    }
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.deletedDecks).toEqual({ x: NOW - 100, y: NOW - 9000, z: NOW - 7000 })
  })

  it('garbage-collects tombstones older than the TTL (using injected now)', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a' })],
      deletedDecks: { fresh: NOW - 1000, stale: NOW - DECK_TOMBSTONE_TTL_MS - 1000 }
    }
    const remote = ws('a', [deck({ id: 'a' })])
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.deletedDecks).toEqual({ fresh: NOW - 1000 })
  })

  it('never returns zero decks: keeps the newest candidate even if all are tombstoned', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [deck({ id: 'a', lastSavedAt: 1 }), deck({ id: 'b', lastSavedAt: 9 })],
      deletedDecks: { a: NOW, b: NOW }
    }
    const remote = ws('a', [])
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toEqual(['b'])
  })

  it('treats a remote workspace with no deletedDecks as no tombstones (back-compat)', () => {
    const local: TAccountWorkspace = { activeDeckId: 'a', decks: [deck({ id: 'a' })] }
    const remote = ws('a', [deck({ id: 'a' }), deck({ id: 'b' })])
    const { merged } = mergeRemoteWorkspace(local, remote, NOW)
    expect(merged.decks.map((d) => d.id)).toEqual(['a', 'b'])
    expect(merged.deletedDecks).toBeUndefined()
  })
})

const agent = (
  npub: string,
  pairedAt: number,
  name?: string,
  lastCalledAt?: number
): TPairedAgent => ({
  pubkey: 'hex_' + npub,
  npub,
  name,
  scope: 'read-only',
  pairedAt,
  lastCalledAt
})

describe('mergePairedAgents', () => {
  it('returns empty array when both inputs undefined', () => {
    expect(mergePairedAgents(undefined, undefined)).toEqual([])
  })

  it('returns local list when remote is undefined', () => {
    const local = [agent('npub1aaa', 100)]
    expect(mergePairedAgents(local, undefined)).toEqual(local)
  })

  it('returns remote list when local is undefined', () => {
    const remote = [agent('npub1bbb', 200)]
    expect(mergePairedAgents(undefined, remote)).toEqual(remote)
  })

  it('unions distinct npubs', () => {
    const local = [agent('npub1aaa', 100)]
    const remote = [agent('npub1bbb', 200)]
    const merged = mergePairedAgents(local, remote)
    expect(merged.map((x) => x.npub).sort()).toEqual(['npub1aaa', 'npub1bbb'])
  })

  it('last-pairedAt-wins on same npub conflict', () => {
    const local = [agent('npub1aaa', 100, 'old-name')]
    const remote = [agent('npub1aaa', 200, 'new-name')]
    const merged = mergePairedAgents(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ npub: 'npub1aaa', pairedAt: 200, name: 'new-name' })
  })

  it('local wins on same-npub when pairedAt is newer', () => {
    const local = [agent('npub1aaa', 300, 'local-name')]
    const remote = [agent('npub1aaa', 200, 'remote-name')]
    const merged = mergePairedAgents(local, remote)
    expect(merged[0]).toMatchObject({ pairedAt: 300, name: 'local-name' })
  })

  it('max-of-both for lastCalledAt regardless of pairedAt order', () => {
    const local = [agent('npub1aaa', 100, undefined, 5000)]
    const remote = [agent('npub1aaa', 200, undefined, 4000)]
    const merged = mergePairedAgents(local, remote)
    expect(merged[0].lastCalledAt).toBe(5000)
  })

  it('handles missing lastCalledAt on one side', () => {
    const local = [agent('npub1aaa', 100)]
    const remote = [agent('npub1aaa', 200, undefined, 4000)]
    const merged = mergePairedAgents(local, remote)
    expect(merged[0].lastCalledAt).toBe(4000)
  })
})

describe('mergeRemoteWorkspace with pairedAgents', () => {
  it('merges pairedAgents from both sides via mergePairedAgents', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'd1',
      decks: [deck({ id: 'd1' })],
      pairedAgents: [agent('npub1aaa', 100)]
    }
    const remote: TAccountWorkspace = {
      activeDeckId: 'd1',
      decks: [deck({ id: 'd1' })],
      pairedAgents: [agent('npub1bbb', 200)]
    }
    const { merged } = mergeRemoteWorkspace(local, remote)
    expect(merged.pairedAgents).toHaveLength(2)
  })

  it('returns undefined pairedAgents when union is empty', () => {
    const local: TAccountWorkspace = { activeDeckId: 'd1', decks: [deck({ id: 'd1' })] }
    const remote: TAccountWorkspace = { activeDeckId: 'd1', decks: [deck({ id: 'd1' })] }
    const { merged } = mergeRemoteWorkspace(local, remote)
    expect(merged.pairedAgents).toBeUndefined()
  })

  it('preserves allowSiblingExposure from remote when set', () => {
    const local: TAccountWorkspace = { activeDeckId: 'd1', decks: [deck({ id: 'd1' })] }
    const remote: TAccountWorkspace = {
      activeDeckId: 'd1',
      decks: [deck({ id: 'd1' })],
      allowSiblingExposure: true
    }
    const { merged } = mergeRemoteWorkspace(local, remote)
    expect(merged.allowSiblingExposure).toBe(true)
  })

  it('falls back to local allowSiblingExposure when remote lacks it', () => {
    const local: TAccountWorkspace = {
      activeDeckId: 'd1',
      decks: [deck({ id: 'd1' })],
      allowSiblingExposure: true
    }
    const remote: TAccountWorkspace = { activeDeckId: 'd1', decks: [deck({ id: 'd1' })] }
    const { merged } = mergeRemoteWorkspace(local, remote)
    expect(merged.allowSiblingExposure).toBe(true)
  })
})
