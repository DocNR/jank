import { describe, expect, it } from 'vitest'
import { trustChipState } from './trust-chip-state'

describe('trustChipState', () => {
  it('shows the score when ranked (number)', () => {
    expect(trustChipState(82)).toBe('score')
    expect(trustChipState(0)).toBe('score')
  })

  it('offers compute for any unranked person, follow or stranger', () => {
    // The compute button is no longer follow-gated — anyone Relatr has no rank
    // for (rank === null after a fetch) gets the on-demand "Calculate trust" CTA.
    expect(trustChipState(null)).toBe('calculate')
  })

  it('shows nothing while the rank is still unknown (not fetched / cache expired)', () => {
    expect(trustChipState(undefined)).toBe('none')
  })
})
