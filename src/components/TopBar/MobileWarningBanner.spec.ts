import { describe, expect, it } from 'vitest'
import { isMobileBannerDismissed, MOBILE_BANNER_DISMISSED_KEY } from './MobileWarningBanner'

describe('isMobileBannerDismissed', () => {
  it('returns true when stored value is "1"', () => {
    const getItem = (key: string) => (key === MOBILE_BANNER_DISMISSED_KEY ? '1' : null)
    expect(isMobileBannerDismissed(getItem)).toBe(true)
  })

  it('returns false when key is absent', () => {
    const getItem = () => null
    expect(isMobileBannerDismissed(getItem)).toBe(false)
  })

  it('returns false when stored value is not "1"', () => {
    const getItem = () => 'true'
    expect(isMobileBannerDismissed(getItem)).toBe(false)
  })

  it('returns false when getter throws (e.g. localStorage disabled)', () => {
    const getItem = () => {
      throw new Error('localStorage disabled')
    }
    expect(isMobileBannerDismissed(getItem)).toBe(false)
  })
})
