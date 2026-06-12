import { describe, expect, it } from 'vitest'
import type { TColumn, TDeck } from '@/types/column'
import { computeChipState, computeDropdownRows, normalizeDeckName } from './helpers'

const deck = (overrides: Partial<TDeck> = {}): TDeck => ({
  id: 'd1',
  name: 'My Deck',
  columns: [],
  savedColumns: [],
  createdAt: 1000,
  updatedAt: 1000,
  lastSavedAt: 1000,
  ...overrides
})

const col = (overrides: Partial<TColumn> = {}): TColumn =>
  ({
    id: 'c-' + Math.random().toString(36).slice(2, 8),
    type: 'home',
    viewContext: 'pk1',
    signingIdentity: 'pk1',
    ...overrides
  }) as TColumn

describe('computeChipState', () => {
  it('clean state: no dirty pip, no save pill', () => {
    expect(computeChipState({ activeDeck: deck(), isActiveDeckDirty: false })).toEqual({
      name: 'My Deck',
      showDirtyPip: false,
      showSavePill: false
    })
  })

  it('dirty state: pip + save pill', () => {
    expect(computeChipState({ activeDeck: deck(), isActiveDeckDirty: true })).toEqual({
      name: 'My Deck',
      showDirtyPip: true,
      showSavePill: true
    })
  })

  it('no active deck: placeholder', () => {
    expect(computeChipState({ activeDeck: null, isActiveDeckDirty: false })).toEqual({
      name: 'No deck',
      showDirtyPip: false,
      showSavePill: false
    })
  })
})

describe('computeDropdownRows', () => {
  it('marks active deck + per-deck dirty pip', () => {
    const d1 = deck({ id: 'd1', name: 'My Deck' })
    const d2 = deck({
      id: 'd2',
      name: 'Catchup',
      columns: [col({ id: 'c1' })],
      savedColumns: []
    })
    const rows = computeDropdownRows({ decks: [d1, d2], activeDeckId: 'd1' })
    expect(rows).toEqual([
      { id: 'd1', name: 'My Deck', isActive: true, isDirty: false },
      { id: 'd2', name: 'Catchup', isActive: false, isDirty: true }
    ])
  })

  it('empty deck list returns empty rows', () => {
    expect(computeDropdownRows({ decks: [], activeDeckId: '' })).toEqual([])
  })

  it('transient columns excluded from dirty computation', () => {
    const d = deck({
      id: 'd1',
      columns: [col({ id: 'c1' }), col({ id: 't1', transient: true })],
      savedColumns: [col({ id: 'c1' })]
    })
    const rows = computeDropdownRows({ decks: [d], activeDeckId: 'd1' })
    expect(rows[0].isDirty).toBe(false)
  })
})

describe('normalizeDeckName', () => {
  it('trims whitespace', () => {
    expect(normalizeDeckName('  My Deck  ')).toBe('My Deck')
  })

  it('falls back to "Untitled deck" on empty / whitespace-only', () => {
    expect(normalizeDeckName('')).toBe('Untitled deck')
    expect(normalizeDeckName('   ')).toBe('Untitled deck')
  })

  it('passes valid names through unchanged', () => {
    expect(normalizeDeckName('Work feed')).toBe('Work feed')
  })
})
