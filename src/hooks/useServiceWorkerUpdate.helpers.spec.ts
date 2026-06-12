import { describe, expect, it } from 'vitest'
import { shouldCheckForUpdate } from './useServiceWorkerUpdate.helpers'

describe('shouldCheckForUpdate', () => {
  it('allows a check when none has happened yet', () => {
    expect(shouldCheckForUpdate(0, 100_000, 60_000)).toBe(true)
  })
  it('suppresses a check inside the throttle window', () => {
    expect(shouldCheckForUpdate(100_000, 130_000, 60_000)).toBe(false)
  })
  it('allows a check once the throttle window has elapsed', () => {
    expect(shouldCheckForUpdate(100_000, 161_000, 60_000)).toBe(true)
  })
})
