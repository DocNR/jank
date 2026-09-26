import { describe, expect, it } from 'vitest'
import { showsDataRecoveryLink } from './data-recovery-link'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('showsDataRecoveryLink', () => {
  it('shows on your own profile when the column signs as the active account', () => {
    expect(showsDataRecoveryLink({ profilePubkey: A, signingPubkey: A, activePubkey: A })).toBe(
      true
    )
  })

  it('hides on your own profile in a column for a paired account that is not active', () => {
    // Data recovery scans and restores the active account, so a link here
    // would open recovery for A while the user is looking at B
    expect(showsDataRecoveryLink({ profilePubkey: B, signingPubkey: B, activePubkey: A })).toBe(
      false
    )
  })

  it('hides on someone else’s profile', () => {
    expect(showsDataRecoveryLink({ profilePubkey: B, signingPubkey: A, activePubkey: A })).toBe(
      false
    )
  })

  it('hides when signed out', () => {
    expect(
      showsDataRecoveryLink({ profilePubkey: A, signingPubkey: null, activePubkey: null })
    ).toBe(false)
  })
})
