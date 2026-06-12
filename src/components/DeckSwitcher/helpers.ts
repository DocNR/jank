// src/components/DeckSwitcher/helpers.ts
//
// Pure helpers extracted from the DeckSwitcher chip + dropdown so they can be
// unit-tested without React rendering. Match the MobileWarningBanner.spec.ts
// pattern: behavior lives here; tsx file imports + renders.

import type { TColumn, TDeck } from '@/types/column'

export type ChipState = {
  name: string
  showDirtyPip: boolean
  showSavePill: boolean
}

/** Derive chip display state from active-deck + dirty signal. */
export function computeChipState(input: {
  activeDeck: TDeck | null
  isActiveDeckDirty: boolean
}): ChipState {
  if (!input.activeDeck) {
    return { name: 'No deck', showDirtyPip: false, showSavePill: false }
  }
  return {
    name: input.activeDeck.name,
    showDirtyPip: input.isActiveDeckDirty,
    showSavePill: input.isActiveDeckDirty
  }
}

export type DropdownRow = {
  id: string
  name: string
  isActive: boolean
  isDirty: boolean
}

/** Derive dropdown row data from the current workspace's decks. */
export function computeDropdownRows(input: {
  decks: TDeck[]
  activeDeckId: string
}): DropdownRow[] {
  return input.decks.map((d) => ({
    id: d.id,
    name: d.name,
    isActive: d.id === input.activeDeckId,
    isDirty: isDeckDirty(d)
  }))
}

/** Deep-equal of live columns vs saved snapshot, transients excluded. */
function isDeckDirty(deck: TDeck): boolean {
  const live = deck.columns.filter((c: TColumn) => !c.transient)
  const saved = deck.savedColumns.filter((c: TColumn) => !c.transient)
  return JSON.stringify(live) !== JSON.stringify(saved)
}

/** Validate + normalize a deck name (Save As / New Deck / Rename input). */
export function normalizeDeckName(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? 'Untitled deck' : trimmed
}
