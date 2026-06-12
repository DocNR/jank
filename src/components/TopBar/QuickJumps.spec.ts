import { describe, expect, it } from 'vitest'
import { deriveActiveQuickJump } from './QuickJumps'

describe('deriveActiveQuickJump', () => {
  const ACTIVE_PUBKEY = 'aaaaaaaa'
  const COLUMNS = [
    { id: 'c1', type: 'home', viewContext: ACTIVE_PUBKEY },
    { id: 'c2', type: 'notifications', viewContext: ACTIVE_PUBKEY },
    { id: 'c3', type: 'profile', viewContext: 'bbbbbbbb' } // foreign profile
  ] as any

  it('returns the matching type when focused column matches active pubkey', () => {
    expect(deriveActiveQuickJump('c2', COLUMNS, ACTIVE_PUBKEY)).toBe('notifications')
  })

  it('returns null when focused column is a foreign profile (not the user own)', () => {
    expect(deriveActiveQuickJump('c3', COLUMNS, ACTIVE_PUBKEY)).toBe(null)
  })

  it('returns null when no column is active', () => {
    expect(deriveActiveQuickJump(null, COLUMNS, ACTIVE_PUBKEY)).toBe(null)
  })

  it('returns null when activePubkey is null', () => {
    expect(deriveActiveQuickJump('c2', COLUMNS, null)).toBe(null)
  })

  it('returns home for the focused Home column', () => {
    expect(deriveActiveQuickJump('c1', COLUMNS, ACTIVE_PUBKEY)).toBe('home')
  })
})
