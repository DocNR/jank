import { afterEach, describe, expect, it } from 'vitest'
import {
  isIntentionalReload,
  markIntentionalReload,
  resetIntentionalReload
} from './reload-coordinator'

describe('reload-coordinator', () => {
  afterEach(() => {
    resetIntentionalReload()
  })

  it('reports not-intentional by default', () => {
    expect(isIntentionalReload()).toBe(false)
  })

  it('reports intentional after marking', () => {
    markIntentionalReload()
    expect(isIntentionalReload()).toBe(true)
  })

  it('reset clears the intentional flag', () => {
    markIntentionalReload()
    resetIntentionalReload()
    expect(isIntentionalReload()).toBe(false)
  })
})
