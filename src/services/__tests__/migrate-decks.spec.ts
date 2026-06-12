import { describe, it, expect } from 'vitest'
import { migrateDecks } from '@/services/local-storage.service'
import type { TColumn } from '@/types/column'

const COL = (id: string, pk: string): TColumn => ({
  id,
  viewContext: pk,
  signingIdentity: pk,
  type: 'home'
})

describe('migrateDecks', () => {
  describe('fresh-install paths', () => {
    it('returns one empty default deck when no DECKS, no legacy COLUMNS, no accounts', () => {
      const result = migrateDecks(null, null, [], [])
      expect(result.decks).toHaveLength(1)
      expect(result.decks[0].columns).toEqual([])
      expect(result.decks[0].name).toBe('My Deck')
      expect(result.decks[0].ownerPubkey).toBeNull()
      expect(result.activeDeckId).toBe(result.decks[0].id)
      expect(result.migrated).toBe(true)
    })

    it('assigns ownerPubkey = first paired pubkey when accounts exist', () => {
      const result = migrateDecks(null, null, [], ['pk1', 'pk2'])
      expect(result.decks[0].ownerPubkey).toBe('pk1')
    })
  })

  describe('upgrade-from-COLUMNS paths', () => {
    it('wraps legacy columns into the default deck, accounts present', () => {
      const cols = [COL('c1', 'pk1'), COL('c2', 'pk1')]
      const result = migrateDecks(null, null, cols, ['pk1'])
      expect(result.decks).toHaveLength(1)
      expect(result.decks[0].columns).toEqual(cols)
      expect(result.decks[0].ownerPubkey).toBe('pk1')
      expect(result.activeDeckId).toBe(result.decks[0].id)
      expect(result.migrated).toBe(true)
    })

    it('wraps legacy columns with ownerPubkey: null when no accounts paired yet', () => {
      const cols = [COL('c1', 'pk1')]
      const result = migrateDecks(null, null, cols, [])
      expect(result.decks[0].columns).toEqual(cols)
      expect(result.decks[0].ownerPubkey).toBeNull()
    })

    it('sets createdAt and updatedAt to the same value on a fresh migration', () => {
      const result = migrateDecks(null, null, [], [])
      expect(result.decks[0].createdAt).toBe(result.decks[0].updatedAt)
      expect(result.decks[0].createdAt).toBeGreaterThan(0)
    })
  })

  describe('idempotent paths (DECKS already present)', () => {
    it('returns existing decks unchanged when DECKS is valid', () => {
      const existing = [
        {
          id: 'd1',
          name: 'Work',
          ownerPubkey: 'pk1',
          columns: [COL('c1', 'pk1')],
          createdAt: 1000,
          updatedAt: 1000
        }
      ]
      const result = migrateDecks(existing, 'd1', [], ['pk1'])
      expect(result.decks).toEqual(existing)
      expect(result.activeDeckId).toBe('d1')
      expect(result.migrated).toBe(false)
    })

    it('recovers activeDeckId when present-but-stale (points at deleted deck)', () => {
      const existing = [
        {
          id: 'd1',
          name: 'Work',
          ownerPubkey: 'pk1',
          columns: [],
          createdAt: 1000,
          updatedAt: 1000
        }
      ]
      const result = migrateDecks(existing, 'ghost-id', [], ['pk1'])
      expect(result.activeDeckId).toBe('d1')
      expect(result.migrated).toBe(true) // we rewrote ACTIVE_DECK_ID
    })

    it('recovers activeDeckId when missing entirely', () => {
      const existing = [
        {
          id: 'd1',
          name: 'Work',
          ownerPubkey: 'pk1',
          columns: [],
          createdAt: 1000,
          updatedAt: 1000
        }
      ]
      const result = migrateDecks(existing, null, [], ['pk1'])
      expect(result.activeDeckId).toBe('d1')
      expect(result.migrated).toBe(true)
    })
  })

  describe('malformed input', () => {
    it('treats a non-array DECKS value as fresh install', () => {
      const result = migrateDecks('not an array', null, [], [])
      expect(result.decks).toHaveLength(1)
      expect(result.migrated).toBe(true)
    })

    it('drops deck entries with no id or no columns array', () => {
      const malformed = [
        { id: 'd1', columns: [] }, // missing other fields — fixable
        { columns: [] }, // missing id — drop
        { id: 'd2', columns: 'nope' } // columns not an array — drop
      ]
      const result = migrateDecks(malformed, null, [], [])
      // Either one valid deck recovered, or fresh empty deck if all are unfixable.
      // Implementation may choose to fill defaults for partially-malformed entries
      // (preferred) or drop them. The contract: no thrown errors, at least one
      // deck returned, no half-populated decks.
      expect(result.decks.length).toBeGreaterThanOrEqual(1)
      for (const d of result.decks) {
        expect(typeof d.id).toBe('string')
        expect(Array.isArray(d.columns)).toBe(true)
        expect(typeof d.createdAt).toBe('number')
        expect(typeof d.updatedAt).toBe('number')
      }
    })
  })
})
