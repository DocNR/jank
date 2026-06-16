import { describe, expect, it } from 'vitest'
import type { TAccountWorkspace, TColumn, TDeck } from '@/types/column'
import { decodeWorkspace, encodeWorkspace } from '@/services/deck-sync-codec'

const col = (over: Partial<TColumn> = {}): TColumn => ({
  id: 'c1',
  viewContext: 'pk1',
  signingIdentity: 'pk1',
  type: 'home',
  ...over
})

const deck = (over: Partial<TDeck> = {}): TDeck => ({
  id: 'd1',
  name: 'My Deck',
  columns: [col()],
  savedColumns: [col()],
  createdAt: 1000,
  updatedAt: 1000,
  lastSavedAt: 1000,
  ...over
})

const workspace = (over: Partial<TAccountWorkspace> = {}): TAccountWorkspace => ({
  activeDeckId: 'd1',
  decks: [deck()],
  ...over
})

describe('deck-sync-codec', () => {
  it('round-trips a workspace (decoded columns == savedColumns)', () => {
    const decoded = decodeWorkspace(encodeWorkspace(workspace()))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.activeDeckId).toBe('d1')
    expect(decoded.workspace.decks).toHaveLength(1)
    expect(decoded.workspace.decks[0].columns).toEqual([col()])
    expect(decoded.workspace.decks[0].savedColumns).toEqual([col()])
  })

  it('syncs SAVED columns, not live unsaved edits', () => {
    const dirty = workspace({
      decks: [deck({ columns: [col({ id: 'a' }), col({ id: 'b' })], savedColumns: [col({ id: 'a' })] })]
    })
    const decoded = decodeWorkspace(encodeWorkspace(dirty))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.decks[0].columns.map((c) => c.id)).toEqual(['a'])
  })

  it('drops transient columns', () => {
    const withTransient = workspace({
      decks: [deck({ savedColumns: [col({ id: 'a' }), col({ id: 't', transient: true })] })]
    })
    const decoded = decodeWorkspace(encodeWorkspace(withTransient))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.decks[0].columns.map((c) => c.id)).toEqual(['a'])
  })

  it('rejects invalid JSON with reason "parse"', () => {
    expect(decodeWorkspace('{not json')).toEqual({ ok: false, reason: 'parse' })
  })

  it('rejects wrong shape with reason "shape"', () => {
    expect(decodeWorkspace(JSON.stringify({ version: 1 }))).toEqual({ ok: false, reason: 'shape' })
  })

  it('rejects an unsupported future version', () => {
    const future = JSON.stringify({ version: 2, activeDeckId: 'd1', decks: [] })
    expect(decodeWorkspace(future)).toEqual({ ok: false, reason: 'unsupported-version' })
  })

  it('rejects a column entry that is not an object', () => {
    const bad = JSON.stringify({
      version: 1,
      activeDeckId: 'd1',
      decks: [{ id: 'd1', name: 'X', createdAt: 1, updatedAt: 1, lastSavedAt: 1, columns: [null] }]
    })
    expect(decodeWorkspace(bad)).toEqual({ ok: false, reason: 'shape' })
  })

  it('round-trips a persisted feedTab on a home column config', () => {
    const s = workspace({
      decks: [deck({ savedColumns: [col({ config: { feedTab: 'postsAndReplies' } })] })]
    })
    const decoded = decodeWorkspace(encodeWorkspace(s))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.decks[0].columns[0].config?.feedTab).toBe('postsAndReplies')
  })

  it('decode isolates columns and savedColumns config objects', () => {
    const s = workspace({
      decks: [deck({ savedColumns: [col({ id: 'a', type: 'hashtag', config: { hashtags: ['x'] } })] })]
    })
    const decoded = decodeWorkspace(encodeWorkspace(s))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const d = decoded.workspace.decks[0]
    expect(d.columns[0].config).not.toBe(d.savedColumns[0].config)
    expect(d.columns[0].config).toEqual(d.savedColumns[0].config)
  })
})

describe('deck-sync-codec — deletedDecks tombstones', () => {
  it('round-trips deletedDecks', () => {
    const decoded = decodeWorkspace(encodeWorkspace(workspace({ deletedDecks: { x: 111, y: 222 } })))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.deletedDecks).toEqual({ x: 111, y: 222 })
  })

  it('omits deletedDecks from the wire when empty', () => {
    const json = encodeWorkspace(workspace({ deletedDecks: {} }))
    expect(json).not.toContain('deletedDecks')
    const decoded = decodeWorkspace(json)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.deletedDecks).toBeUndefined()
  })

  it('decodes a blob without deletedDecks (back-compat) and keeps version 1', () => {
    const json = encodeWorkspace(workspace())
    expect(JSON.parse(json).version).toBe(1)
    const decoded = decodeWorkspace(json)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.deletedDecks).toBeUndefined()
  })

  it('ignores a non-object deletedDecks (array) rather than producing index keys', () => {
    const json = JSON.stringify({
      version: 1,
      activeDeckId: 'd1',
      decks: [{ id: 'd1', name: 'My Deck', createdAt: 1, updatedAt: 1, lastSavedAt: 1, columns: [] }],
      deletedDecks: [123, 456]
    })
    const decoded = decodeWorkspace(json)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.deletedDecks).toBeUndefined()
  })

  it('sanitizes malformed deletedDecks (non-number values dropped) rather than failing', () => {
    const json = JSON.stringify({
      version: 1,
      activeDeckId: 'd1',
      decks: [{ id: 'd1', name: 'My Deck', createdAt: 1, updatedAt: 1, lastSavedAt: 1, columns: [] }],
      deletedDecks: { good: 123, bad: 'oops', alsoBad: null }
    })
    const decoded = decodeWorkspace(json)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.workspace.deletedDecks).toEqual({ good: 123 })
  })
})
