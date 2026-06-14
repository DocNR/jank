import { describe, it, expect } from 'vitest'
import { migrateColumns } from '@/services/local-storage.service'

// `migrateColumns` is the hydration-time migration for the localStorage
// `columns` key. These tests pin the two Phase-2 additions — the `bookmarks`
// column type and the `config.notificationListStyle` → `config.listStyle`
// rename — plus regression guards for the pre-existing migration behavior.

describe('migrateColumns', () => {
  describe('bookmarks column type', () => {
    it('keeps columns with type "bookmarks"', () => {
      const result = migrateColumns([
        { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'bookmarks' }
      ])
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('bookmarks')
    })
  })

  describe('hashtag column type', () => {
    it('keeps columns with type "hashtag"', () => {
      const result = migrateColumns([
        { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'hashtag' }
      ])
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('hashtag')
    })

    it('preserves config.hashtags', () => {
      const result = migrateColumns([
        {
          id: 'c1',
          viewContext: 'pk1',
          signingIdentity: 'pk1',
          type: 'hashtag',
          config: { hashtags: ['nostr', 'bitcoin'] }
        }
      ])
      expect(result[0].config).toEqual({ hashtags: ['nostr', 'bitcoin'] })
    })
  })

  describe('profile column type', () => {
    it('keeps columns with type "profile"', () => {
      const result = migrateColumns([
        { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'profile' }
      ])
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('profile')
    })
  })

  describe('config.notificationListStyle → config.listStyle', () => {
    it('renames a legacy config.notificationListStyle to config.listStyle', () => {
      const result = migrateColumns([
        {
          id: 'c1',
          viewContext: 'pk1',
          signingIdentity: 'pk1',
          type: 'notifications',
          config: { notificationListStyle: 'compact' }
        }
      ])
      expect(result[0].config).toEqual({ listStyle: 'compact' })
      expect(result[0].config).not.toHaveProperty('notificationListStyle')
    })

    it('leaves an already-migrated config.listStyle untouched', () => {
      const result = migrateColumns([
        {
          id: 'c1',
          viewContext: 'pk1',
          signingIdentity: 'pk1',
          type: 'notifications',
          config: { listStyle: 'detailed' }
        }
      ])
      expect(result[0].config).toEqual({ listStyle: 'detailed' })
    })

    it('does not clobber an existing listStyle when the legacy key is also present', () => {
      const result = migrateColumns([
        {
          id: 'c1',
          viewContext: 'pk1',
          signingIdentity: 'pk1',
          type: 'notifications',
          config: { listStyle: 'detailed', notificationListStyle: 'compact' }
        }
      ])
      expect(result[0].config).toEqual({ listStyle: 'detailed' })
    })
  })

  describe('articles column type', () => {
    it('preserves an articles column entry', () => {
      const raw = [
        {
          id: 'col-articles-1',
          type: 'articles',
          viewContext: 'pubkey-hex',
          signingIdentity: 'pubkey-hex',
          config: { wotOnly: false }
        }
      ]
      const result = migrateColumns(raw)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'col-articles-1',
        type: 'articles',
        config: { wotOnly: false }
      })
    })
  })

  describe('favorites column type', () => {
    it('preserves a favorites column entry', () => {
      const raw = [
        {
          id: 'col-fav-1',
          type: 'favorites',
          viewContext: 'pubkey-hex',
          signingIdentity: 'pubkey-hex'
        }
      ]
      const result = migrateColumns(raw)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'col-fav-1',
        type: 'favorites',
        viewContext: 'pubkey-hex',
        signingIdentity: 'pubkey-hex'
      })
    })
  })

  describe('mute-list column type', () => {
    it('keeps columns with type "mute-list"', () => {
      const result = migrateColumns([
        { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'mute-list' }
      ])
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('mute-list')
    })
  })

  describe('regression — pre-existing migration behavior', () => {
    it('preserves relayUrl config', () => {
      const result = migrateColumns([
        {
          id: 'c1',
          viewContext: 'pk1',
          signingIdentity: 'pk1',
          type: 'relay',
          config: { relayUrl: 'wss://relay.example' }
        }
      ])
      expect(result[0].config).toEqual({ relayUrl: 'wss://relay.example' })
    })

    it('renames the legacy "mentions" type to "notifications"', () => {
      const result = migrateColumns([
        { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'mentions' }
      ])
      expect(result[0].type).toBe('notifications')
    })

    it('splits a legacy single accountId into viewContext + signingIdentity', () => {
      const result = migrateColumns([{ id: 'c1', accountId: 'pk1', type: 'home' }])
      expect(result[0].viewContext).toBe('pk1')
      expect(result[0].signingIdentity).toBe('pk1')
    })

    it('returns an empty array for non-array input', () => {
      expect(migrateColumns(null)).toEqual([])
      expect(migrateColumns(undefined)).toEqual([])
      expect(migrateColumns('nope')).toEqual([])
    })

    it('drops entries with no usable pubkey', () => {
      expect(migrateColumns([{ id: 'c1', type: 'home' }])).toEqual([])
    })

    it('drops entries with an unknown column type', () => {
      expect(
        migrateColumns([{ id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'wat' }])
      ).toEqual([])
    })
  })
})
