import { describe, it, expect } from 'vitest'
import { signingState } from './signing-state'

describe('signingState', () => {
  it('returns "view-only" when there is no signing identity', () => {
    expect(signingState('pk_view', null)).toBe('view-only')
  })

  it('returns "quiet" when the column signs as its own account', () => {
    expect(signingState('pk_view', 'pk_view')).toBe('quiet')
  })

  it('returns "loud" when the column signs as a different account', () => {
    expect(signingState('pk_view', 'pk_other')).toBe('loud')
  })

  it('uses the provided baselinePubkey instead of viewContext when given', () => {
    // Signing as the baseline is "quiet" even though signingIdentity ≠ viewContext.
    expect(signingState('pk_view', 'pk_signer', 'pk_signer')).toBe('quiet')
    // Signing as something other than the baseline is "loud".
    expect(signingState('pk_view', 'pk_other', 'pk_signer')).toBe('loud')
  })

  it('falls back to viewContext when baselinePubkey is undefined', () => {
    expect(signingState('pk_view', 'pk_view', undefined)).toBe('quiet')
    expect(signingState('pk_view', 'pk_other', undefined)).toBe('loud')
  })
})
